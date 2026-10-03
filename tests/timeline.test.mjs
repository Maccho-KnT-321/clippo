import test from 'node:test';
import assert from 'node:assert/strict';
import { clipDuration, transitionDuration, layoutClips, projectDuration } from '../timeline.js';
import { EditorEngine } from '../engine.js';

const clip = (id, seconds, transition) => ({ id, assetId: id, in: 0, out: seconds, speed: 1, transition });

test('overlap reduces project duration and preserves full source durations', () => {
  const clips = [clip('a', 1, { type: 'dissolve', duration: .4 }), clip('b', 1)];
  assert.equal(projectDuration({ clips }), 1.6);
  assert.deepEqual(layoutClips(clips).map(({ start, end, overlap }) => ({ start, end, overlap })), [
    { start: 0, end: 1, overlap: .4 }, { start: .6, end: 1.6, overlap: 0 }
  ]);
});

test('transition limits avoid triple overlap, including speed-adjusted clips', () => {
  const clips = [clip('a', 6, { type: 'wipe', duration: 10 }), { ...clip('b', 2, { type: 'white', duration: 10 }), speed: 2 }, clip('c', 5)];
  assert.equal(clipDuration(clips[1]), 1);
  assert.equal(transitionDuration(clips, 0), .5);
  assert.equal(transitionDuration(clips, 1), .5);
  const layout = layoutClips(clips);
  for (let time = 0; time < projectDuration({ clips }); time += .01) assert.ok(layout.filter(item => time >= item.start && time < item.end).length <= 2);
  assert.equal(transitionDuration(clips, 2), 0);
  assert.equal(projectDuration({ clips: [] }), 0);
});

test('disabled and invalid transitions do not shorten clips', () => {
  for (const type of ['none', 'unknown', undefined]) {
    const clips = [clip('a', 1, { type, duration: .4 }), clip('b', 1)];
    assert.equal(projectDuration({ clips }), 2);
  }
});

test('both overlapping sources advance with their own trim and speed, with linear audio crossfade', async () => {
  globalThis.HTMLImageElement = class {};
  const ctx = { save() {}, restore() {}, fillRect() {}, drawImage() {}, globalAlpha: 1 };
  const engine = new EditorEngine({ width: 640, height: 360, getContext: () => ctx }, new Map());
  const positions = [], gains = new Map();
  engine.element = async id => ({ id, videoWidth: 640, videoHeight: 360, currentTime: 0, readyState: 4 });
  engine.seek = async (element, time) => positions.push([element.id, time]);
  engine.node = (_element, key) => { const gain = { gain: { value: 0 } }; gains.set(key, gain); return gain; };
  engine.visualFrame = ({ visual }) => visual;
  const clips = [{ ...clip('a', 2, { type: 'dissolve', duration: .5 }), speed: 2 }, { ...clip('b', 8), in: 4, speed: 2 }];
  await engine.render({ clips, texts: [], music: [] }, .75);
  assert.deepEqual(positions, [['a', 1.5], ['b', 4.5]]);
  assert.equal(gains.get('clip:a').gain.value, .5);
  assert.equal(gains.get('clip:b').gain.value, .5);
});

test('pause while audio activation is pending cannot restart playback', async () => {
  globalThis.cancelAnimationFrame = () => {};
  const engine = new EditorEngine({ getContext: () => ({}) }, new Map());
  let resume;
  engine.audio = () => new Promise(resolve => { resume = resolve; });
  engine.render = async () => { throw new Error('cancelled playback rendered'); };
  const pending = engine.play({ clips: [], music: [] });
  engine.pause(); resume(); await pending;
  assert.equal(engine.playing, false);
});
