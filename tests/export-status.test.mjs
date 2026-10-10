import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorEngine } from '../engine.js';

// Exercise the actual export lifecycle and stall monitor with a deterministic
// compositor clock. Browser encoding/frame-quality tests live separately.
async function withHarness(run) {
  const names = ['document', 'HTMLVideoElement', 'MediaRecorder', 'cancelAnimationFrame', 'performance'];
  const originals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  let clock = 0;
  class Video {
    paused = true;
    frames = 1;
    pause() { this.paused = true; }
    getVideoPlaybackQuality() { return { totalVideoFrames: this.frames }; }
  }
  class Recorder {
    state = 'inactive';
    constructor(_stream, options) { this.mimeType = options.mimeType; }
    start() { this.state = 'recording'; }
    stop() {
      if (this.state === 'inactive') return;
      this.state = 'inactive';
      queueMicrotask(() => {
        this.ondataavailable?.({ data: new Blob(['encoded fixture']) });
        this.onstop?.();
      });
    }
  }
  const doc = new EventTarget(); doc.hidden = false;
  const values = { document: doc, HTMLVideoElement: Video, MediaRecorder: Recorder, cancelAnimationFrame() {}, performance: { now: () => clock } };
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: values[name] });
  try {
    const stopped = [];
    const track = { stop: () => stopped.push('track') };
    const canvas = { width: 320, height: 180, getContext: () => ({}), captureStream: () => ({ addTrack() {}, getTracks: () => [track] }) };
    const engine = new EditorEngine(canvas, new Map());
    engine.audio = async () => {};
    engine.mediaContainer = () => {};
    engine.streamDestination = { stream: { getAudioTracks: () => [] } };
    engine.element = async (assetId, key) => {
      if (!engine.media.has(key)) engine.media.set(key, { assetId, el: new Video() });
      return engine.media.get(key).el;
    };
    engine.node = () => {};
    engine.seek = async () => {};
    engine.render = async () => {};
    const project = { aspect: '16:9', clips: [{ id: 'a', assetId: 'a', in: 0, out: 4 }, { id: 'b', assetId: 'b', in: 0, out: 4 }], music: [], texts: [] };
    const prepare = [], progress = [], events = [];
    const simulate = (frames, update, interval = 50) => {
      engine.play = async (_project, _time, onTime, onEnd) => {
        engine.playing = true;
        for (let frame = 0; frame < frames; frame++) {
          clock = frame * interval; // Default 20 fps separates decoder and compositor failure.
          update(frame, engine, Video);
          onTime(clock / 1000);
          if (!engine.playing) return;
        }
        onEnd();
      };
    };
    const options = { mimeType: 'video/mp4', onPrepare: message => { prepare.push(message); events.push('prepare'); }, onProgress: value => { progress.push(value); events.push('progress'); } };
    await run({ engine, canvas, project, stopped, prepare, progress, events, simulate, options });
  } finally {
    for (const name of names) {
      const original = originals.get(name);
      if (original) Object.defineProperty(globalThis, name, original); else delete globalThis[name];
    }
  }
}

test('export reports preparation before progress, completes, and restores canvas/tracks', async () => {
  await withHarness(async ({ engine, canvas, project, stopped, prepare, progress, events, simulate, options }) => {
    simulate(10, (frame, current) => { const video = current.media.get('clip:lane:0').el; video.paused = false; video.frames = frame + 1; });
    const blob = await engine.export(project, options);
    assert.ok(blob.size > 0);
    assert.deepEqual(prepare, ['映像を準備中 1/2', '映像を準備中 2/2', '音楽と保存形式を準備しています…']);
    assert.deepEqual(events.slice(0, 4), ['prepare', 'prepare', 'prepare', 'progress']);
    assert.equal(progress.at(-1), 1);
    assert.ok(progress.every(value => value >= 0 && value <= 1));
    assert.equal(canvas.width, 320); assert.equal(canvas.height, 180);
    assert.equal(engine.exporting, false);
    assert.deepEqual(stopped, ['track']);
  });
});

test('replacing a video element in the same lane resets the decoder stall sample', async () => {
  await withHarness(async ({ engine, project, simulate, options }) => {
    simulate(42, (frame, current, Video) => {
      if (frame === 25) current.media.set('clip:lane:0', { assetId: 'replacement', el: new Video() });
      const video = current.media.get('clip:lane:0').el; video.paused = false;
      // The old source remains just below the 1-second stall threshold, then
      // its replacement initially reports exactly the same last frame count.
      // Without element-identity reset the first replacement callback aborts.
      video.frames = frame < 5 ? frame + 1 : frame < 32 ? 5 : frame - 26;
    });
    assert.ok((await engine.export(project, options)).size > 0);
  });
});

test('reactivating the same decoder after an inactive gap gets a fresh stall grace period', async () => {
  await withHarness(async ({ engine, project, simulate, options }) => {
    simulate(45, (frame, current) => {
      const first = current.media.get('clip:lane:0').el, middle = current.media.get('clip:lane:1').el;
      first.paused = frame >= 5 && frame < 35;
      middle.paused = !first.paused; middle.frames = frame + 1;
      first.frames = frame < 5 ? frame + 1 : frame < 38 ? 5 : frame - 32;
    });
    assert.ok((await engine.export(project, options)).size > 0);
  });
});

test('a truly stalled active decoder still rejects export without asking for 720p when already using it', async () => {
  await withHarness(async ({ engine, project, simulate, options, stopped }) => {
    simulate(30, (_frame, current) => { current.media.get('clip:lane:0').el.paused = false; });
    await assert.rejects(engine.export(project, { ...options, height: 720 }), error => {
      assert.match(error.message, /フレーム更新が止まった/);
      assert.doesNotMatch(error.message, /720p/);
      return true;
    });
    assert.equal(engine.exporting, false); assert.deepEqual(stopped, ['track']);
  });
});

test('1080p decoder stall guidance still offers the lower 720p setting', async () => {
  await withHarness(async ({ engine, project, simulate, options }) => {
    simulate(30, (_frame, current) => { current.media.get('clip:lane:0').el.paused = false; });
    await assert.rejects(engine.export(project, { ...options, height: 1080 }), /720p/);
  });
});

for (const height of [720, 1080]) test(`${height}p slow-compositor guidance reflects the selected quality`, async () => {
  await withHarness(async ({ engine, project, simulate, options }) => {
    simulate(20, (frame, current) => {
      const video = current.media.get('clip:lane:0').el; video.paused = false; video.frames = frame + 1;
    }, 100);
    await assert.rejects(engine.export(project, { ...options, height }), error => {
      assert.match(error.message, /映像処理が追いつかず/);
      if (height === 720) assert.doesNotMatch(error.message, /720p/);
      else assert.match(error.message, /720p/);
      return true;
    });
  });
});

test('preparation callback failure cleans up export state before recorder creation', async () => {
  await withHarness(async ({ engine, canvas, project, options }) => {
    await assert.rejects(engine.export(project, { ...options, onPrepare: () => { throw new Error('preparation UI failure'); } }), /preparation UI failure/);
    assert.equal(engine.exporting, false); assert.equal(canvas.width, 320); assert.equal(canvas.height, 180);
  });
});

test('cancellation during preparation does not start recording or report success', async () => {
  await withHarness(async ({ engine, project, options, progress, stopped }) => {
    const controller = new AbortController();
    await assert.rejects(engine.export(project, {
      ...options, signal: controller.signal, onPrepare: () => controller.abort()
    }), error => error.name === 'AbortError');
    assert.equal(engine.exporting, false);
    assert.deepEqual(progress, []); assert.deepEqual(stopped, []);
  });
});

test('cancellation while recording releases tracks and restores the canvas without successful completion', async () => {
  await withHarness(async ({ engine, canvas, project, options, simulate, progress, stopped }) => {
    const controller = new AbortController();
    simulate(10, (frame, current) => {
      const video = current.media.get('clip:lane:0').el; video.paused = false; video.frames = frame + 1;
      if (frame === 3) controller.abort();
    });
    await assert.rejects(engine.export(project, { ...options, signal: controller.signal }), error => error.name === 'AbortError');
    assert.equal(engine.exporting, false);
    assert.equal(canvas.width, 320); assert.equal(canvas.height, 180);
    assert.ok(!progress.includes(1)); assert.deepEqual(stopped, ['track']);
  });
});
