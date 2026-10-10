import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorEngine } from '../engine.js';

// Real engine load/seek/export code with deterministic browser primitives.
// An abandoned source can emit events later, as Safari loaders sometimes do;
// that source must never take ownership of a fresh export's decoder lane.
async function withHarness(run) {
  const names = ['document', 'HTMLVideoElement', 'HTMLImageElement', 'MediaRecorder', 'cancelAnimationFrame'];
  const originals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const media = [], configurations = [], tracks = [];
  class Media extends EventTarget {
    paused = true; readyState = 0; duration = 5; videoWidth = 320; videoHeight = 180;
    seeking = false; removed = false; _time = 0; _src = ''; listeners = new Map();
    constructor() { super(); Object.assign(this, configurations.shift()); media.push(this); this.style = {}; }
    addEventListener(type, fn, options) { super.addEventListener(type, fn, options); this.listeners.set(type, (this.listeners.get(type) || new Set()).add(fn)); }
    removeEventListener(type, fn, options) { super.removeEventListener(type, fn, options); this.listeners.get(type)?.delete(fn); }
    listenerCount() { return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0); }
    setAttribute() {}
    removeAttribute(name) { if (name === 'src') this._src = ''; }
    set src(value) { this._src = value; }
    get src() { return this._src; }
    load() { if (this._src && !this.holdLoad) queueMicrotask(() => this.finishLoad()); }
    finishLoad() { this.readyState = 2; this.dispatchEvent(new Event('loadeddata')); }
    set currentTime(value) {
      this._time = value; this.seeking = true;
      if (!this.holdSeek) queueMicrotask(() => { this.seeking = false; this.dispatchEvent(new Event('seeked')); });
    }
    get currentTime() { return this._time; }
    pause() { this.paused = true; }
    async play() { this.paused = false; }
    remove() { this.removed = true; }
  }
  class Recorder {
    state = 'inactive';
    constructor(_stream, options) { this.mimeType = options.mimeType; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['encoded']) }); this.onstop?.(); }); }
  }
  const host = { append(element) { element.parentNode = this; }, remove() {} };
  const doc = new EventTarget(); doc.hidden = false; doc.body = host;
  doc.querySelector = () => null;
  doc.createElement = type => type === 'video' || type === 'audio' ? new Media() : host;
  const values = { document: doc, HTMLVideoElement: Media, HTMLImageElement: class {}, MediaRecorder: Recorder, cancelAnimationFrame() {} };
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: values[name] });
  const ctx = { save() {}, restore() {}, fillRect() {}, drawImage() {} };
  const canvas = {
    width: 320, height: 180, getContext: () => ctx,
    captureStream: () => { const track = { stopped: false, stop() { this.stopped = true; } }; tracks.push(track); return { addTrack() {}, getTracks: () => [track] }; }
  };
  const engine = new EditorEngine(canvas, new Map([['source', { type: 'video', url: 'blob:fixture' }]]));
  engine.audio = async () => {};
  engine.mediaContainer = () => host;
  engine.node = () => ({ gain: { value: 1 } });
  engine.streamDestination = { stream: { getAudioTracks: () => [] } };
  engine.play = async (_project, _time, onTime, onEnd) => { engine.playing = true; onTime(.1); onEnd(); };
  const project = { aspect: '16:9', clips: [{ id: 'clip', assetId: 'source', in: 0, out: 3, speed: 1 }], music: [], texts: [] };
  const options = { mimeType: 'video/mp4' };
  try { await run({ engine, canvas, project, options, media, configurations, tracks }); }
  finally {
    engine.dispose();
    for (const name of names) {
      const original = originals.get(name);
      if (original) Object.defineProperty(globalThis, name, original); else delete globalThis[name];
    }
  }
}

const nextTurn = () => new Promise(resolve => setTimeout(resolve, 0));
function trackedController() {
  const controller = new AbortController(), listeners = new Set();
  const add = controller.signal.addEventListener.bind(controller.signal), remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = (type, fn, options) => { if (type === 'abort') listeners.add(fn); add(type, fn, options); };
  controller.signal.removeEventListener = (type, fn, options) => { if (type === 'abort') listeners.delete(fn); remove(type, fn, options); };
  controller.listeners = listeners;
  return controller;
}
async function rejectsQuickly(promise) {
  let timer;
  try {
    await assert.rejects(Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('cancel did not settle promptly')), 250); })]), error => error.name === 'AbortError');
  } finally { clearTimeout(timer); }
}

test('cancel during decoder loading releases the loader and a fresh export succeeds', async () => {
  await withHarness(async ({ engine, canvas, project, options, media, configurations, tracks }) => {
    configurations.push({ holdLoad: true });
    const controller = trackedController();
    const pending = engine.export(project, { ...options, signal: controller.signal });
    await nextTurn();
    assert.equal(media.length, 1); assert.ok(media[0].listenerCount() > 0);
    controller.abort(); await rejectsQuickly(pending);
    assert.equal(controller.listeners.size, 0, 'the export removes its abort listener');
    const abandoned = media[0];
    assert.equal(abandoned.listenerCount(), 0); assert.equal(abandoned.src, ''); assert.equal(abandoned.removed, true);
    assert.equal(engine.media.size, 0); assert.equal(engine.exporting, false);
    assert.equal(canvas.width, 320); assert.equal(canvas.height, 180); assert.equal(tracks.length, 0);
    abandoned.finishLoad();
    assert.equal(engine.media.size, 0, 'a late loadeddata event cannot re-register a cancelled loader');
    assert.ok((await engine.export(project, options)).size > 0);
    assert.notEqual(engine.media.get('clip:lane:0').el, abandoned);
    assert.equal(engine.exporting, false); assert.ok(tracks.every(track => track.stopped));
  });
});

test('cancel during initial trim seeking removes wait listeners and does not poison the next export', async () => {
  await withHarness(async ({ engine, canvas, project, options, media, configurations, tracks }) => {
    project.clips[0].in = 1;
    configurations.push({ holdSeek: true });
    const controller = trackedController();
    const pending = engine.export(project, { ...options, signal: controller.signal });
    await nextTurn();
    assert.equal(media[0].seeking, true); assert.equal(media[0].listeners.get('seeked').size, 1);
    controller.abort(); await rejectsQuickly(pending);
    assert.equal(controller.listeners.size, 0);
    assert.equal(media[0].listenerCount(), 0); assert.equal(media[0].removed, true);
    assert.equal(engine.media.size, 0); assert.equal(engine.exporting, false);
    assert.equal(canvas.width, 320); assert.equal(canvas.height, 180);
    media[0].dispatchEvent(new Event('seeked'));
    assert.ok((await engine.export(project, options)).size > 0);
    assert.notEqual(engine.media.get('clip:lane:0').el, media[0]);
    assert.ok(tracks.every(track => track.stopped));
  });
});

test('pause cancels an obsolete preview seek without rejecting its render or blocking a later render', async () => {
  await withHarness(async ({ engine, project, media, configurations }) => {
    configurations.push({ holdSeek: true });
    const preview = engine.render(project, 1);
    await nextTurn();
    assert.equal(media[0].listeners.get('seeked').size, 1);
    engine.pause();
    await preview;
    assert.equal(media[0].listenerCount(), 0);
    media[0].holdSeek = false;
    await engine.render(project, .5);
    assert.equal(media[0].currentTime, .5);
  });
});

test('an abandoned loader cannot remove a newly assigned element from the same lane', async () => {
  await withHarness(async ({ engine, media, configurations }) => {
    configurations.push({ holdLoad: true });
    const old = engine.element('source', 'clip:lane:0').catch(error => error);
    engine.pause();
    const fresh = engine.element('source', 'clip:lane:0');
    assert.equal((await old).name, 'AbortError');
    const element = await fresh;
    assert.equal(media[0].listenerCount(), 0);
    assert.equal(engine.media.get('clip:lane:0').el, element);
    assert.notEqual(element, media[0]); assert.equal(element.removed, false);
  });
});
