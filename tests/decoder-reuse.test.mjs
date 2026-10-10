import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorEngine } from '../engine.js';

// Deterministic decoder substitutes make activation (not wall-clock jitter) the
// thing under test. The real compositing and lane-selection code still runs.
globalThis.HTMLImageElement = class {};

function fixture() {
  const ctx = { save() {}, restore() {}, fillRect() {}, drawImage() {} };
  const engine = new EditorEngine({ width: 320, height: 180, getContext: () => ctx }, new Map());
  const positions = [];
  engine.element = async (assetId, key) => {
    if (!engine.media.has(key)) {
      const el = {
        videoWidth: 320, videoHeight: 180, currentTime: 0, paused: true,
        pause() { this.paused = true; },
        async play() { this.paused = false; }
      };
      engine.media.set(key, { assetId, el });
    }
    return engine.media.get(key).el;
  };
  engine.seek = async (el, position) => { positions.push(position); el.currentTime = position; };
  engine.node = () => ({ gain: { value: 1 } });
  engine.visualFrame = ({ visual }) => visual;
  engine.playing = true;
  return { engine, positions };
}

const clip = (id, sourceIn, seconds = 1, transition = { type: 'none' }) => ({
  id, assetId: 'shared-source', in: sourceIn, out: sourceIn + seconds,
  speed: 1, volume: 1, transition
});

test('a continuously active decoder lane seeks when a dissolve activates a different cut of the same source', async () => {
  const { engine, positions } = fixture();
  const dissolve = { type: 'dissolve', duration: .5 };
  const project = { clips: [clip('first', 0, 1, dissolve), clip('middle', 2, 1, dissolve), clip('last', 4)], music: [], texts: [] };
  await engine.render(project, .9);
  positions.length = 0;
  await engine.render(project, 1.1);
  assert.equal(positions.length, 1, 'only the newly activated cut seeks');
  assert.ok(Math.abs(positions[0] - 4.1) < 1e-9, 'the third cut uses its own in-point, not the first cut playback');
  assert.equal(engine.media.size, 2, 'the fix does not allocate one decoder per cut');
  assert.equal(engine.media.get('clip:lane:0').el.paused, false);
});

test('skipping short cuts still aligns a reused playing lane to the newly active cut', async () => {
  const { engine, positions } = fixture();
  const project = { clips: [clip('first', 0, .1), clip('middle', 2, .1), clip('last', 4, .1)], music: [], texts: [] };
  await engine.render(project, .02);
  positions.length = 0;
  await engine.render(project, .22);
  assert.equal(positions.length, 1);
  assert.ok(Math.abs(positions[0] - 4.02) < 1e-9);
});

test('a normally playing cut is not repeatedly sought, while paused scrubbing remains precise', async () => {
  const { engine, positions } = fixture();
  const project = { clips: [clip('first', 0)], music: [], texts: [] };
  await engine.render(project, .1);
  positions.length = 0;
  await engine.render(project, .2);
  await engine.render(project, .7);
  assert.deepEqual(positions, [], 'do not restore the old repeated-seek stall loop');
  engine.playing = false;
  await engine.render(project, .3);
  assert.deepEqual(positions, [.3]);
});
