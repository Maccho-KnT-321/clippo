import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewProject } from '../project-review.js';
import { recoveryLimit } from '../project-store.js';

const source = (id, type = 'video', size = 1024) => [id, { type, url: `blob:${id}`, duration: 10, file: { size } }];
const clip = (id = 'clip', assetId = 'video') => ({ id, assetId, in: 0, out: 10, speed: 1 });
const track = (id, assetId, start, seconds = 2) => ({ id, assetId, start, in: 0, out: seconds, volume: 1 });
const project = () => ({ clips: [clip()], music: [], texts: [] });
const assets = () => new Map([source('video'), source('a', 'audio'), source('b', 'audio'), source('image', 'image')]);
const codes = review => review.issues.map(issue => issue.code);

test('a healthy project is ready; referenced source bytes are counted once and no input is mutated', () => {
  const edit = project(), media = assets();
  edit.clips.push(clip('copy')); edit.music.push(track('bgm', 'a', 0));
  edit.texts.push({ id: 'text', text: 'こんにちは', start: 0, end: 2 });
  const before = structuredClone(edit), result = reviewProject(edit, media);
  assert.deepEqual(result, { ready: true, issues: [], assetBytes: 2048 });
  assert.deepEqual(edit, before); assert.equal(media.size, 4);
});

test('an empty timeline has a dedicated fatal guide even when shelf materials exist', () => {
  assert.deepEqual(reviewProject({ clips: [], music: [], texts: [] }, assets()), {
    ready: false, issues: [{ code: 'empty_project', level: 'error', message: '先に動画または写真をタイムラインに追加してください。' }], assetBytes: 0
  });
});

test('missing and unavailable sources are grouped once with the first actionable location', () => {
  const edit = project(), media = assets(); media.delete('video'); media.get('a').url = '';
  edit.clips.push(clip('copy')); edit.music.push(track('bgm', 'a', 0));
  const result = reviewProject(edit, media);
  assert.equal(result.ready, false); assert.deepEqual(codes(result), ['missing_asset']);
  assert.deepEqual({ kind: result.issues[0].kind, id: result.issues[0].id }, { kind: 'clips', id: 'clip' });
  assert.match(result.issues[0].message, /3個/);
});

test('invalid source ranges block export, while a long still-photo presentation is legal', () => {
  for (const invalid of [{ in: -1 }, { in: 5, out: 4 }, { out: NaN }, { in: null }, { out: 10.2 }]) {
    const edit = project(); Object.assign(edit.clips[0], invalid);
    assert.equal(reviewProject(edit, assets()).ready, false, JSON.stringify(invalid));
    assert.ok(codes(reviewProject(edit, assets())).includes('invalid_clip_range'));
  }
  const edit = project(); edit.clips[0] = { ...clip('photo', 'image'), out: 30 };
  assert.equal(reviewProject(edit, assets()).ready, true);
});

test('invalid music ranges and starts are fatal, numeric project values remain compatible', () => {
  const edit = project(); edit.clips[0] = { ...clip(), in: '0', out: '10' };
  edit.music.push({ ...track('bgm', 'a', 0), start: '0', in: '0', out: '2' });
  assert.equal(reviewProject(edit, assets()).ready, true);
  edit.music[0].start = -1;
  assert.deepEqual(codes(reviewProject(edit, assets())), ['invalid_music_range']);
  edit.music[0].start = 0; edit.music[0].out = 11;
  assert.equal(reviewProject(edit, assets()).ready, false);
});

test('150MB limit is inclusive, ignores unused shelf files, and only warns rather than blocking video export', () => {
  const edit = project(), media = assets(); media.get('video').file.size = recoveryLimit;
  media.get('a').file.size = recoveryLimit * 3;
  assert.equal(reviewProject(edit, media).issues.length, 0);
  edit.clips.push(clip('copy')); assert.equal(reviewProject(edit, media).assetBytes, recoveryLimit);
  media.get('video').file.size++;
  const result = reviewProject(edit, media);
  assert.equal(result.ready, true); assert.equal(result.assetBytes, recoveryLimit + 1);
  assert.deepEqual(codes(result), ['save_limit']); assert.equal(result.issues[0].level, 'warning');
  assert.match(result.issues[0].message, /書き出し自体はこの上限の対象ではありません/);
});

test('outside and momentary captions are grouped, using visible duration and actual dissolved project duration', () => {
  const edit = project(); edit.clips[0].out = 2; edit.clips[0].transition = { type: 'dissolve', duration: 1 };
  edit.clips.push({ ...clip('next'), out: 2 }); // total = 3 seconds, not 4.
  edit.texts = [
    { id: 'outside', text: '次の場面', start: 3, end: 4 },
    { id: 'outside2', text: '前の場面', start: -2, end: -1 },
    { id: 'short', text: '一瞬', start: 1, end: 1.4 },
    { id: 'clipped', text: '最後', start: 2.8, end: 5 },
    { id: 'normal', text: '正常', start: .2, end: .8 },
    { id: 'empty', text: '', start: 20, end: 30 }
  ];
  const result = reviewProject(edit, assets());
  assert.equal(result.ready, true); assert.deepEqual(codes(result), ['text_outside', 'text_short']);
  assert.match(result.issues[0].message, /2個/); assert.match(result.issues[1].message, /2個/);
  assert.equal(result.issues[0].id, 'outside'); assert.equal(result.issues[1].id, 'short');
});

test('continuous BGM loops, muted overlaps, and overlaps outside the visible project are not warnings', () => {
  const edit = project();
  edit.music = [track('first', 'a', 0), track('next', 'a', 2), { ...track('muted', 'b', 1), volume: 0 }, track('after', 'b', 10)];
  assert.deepEqual(reviewProject(edit, assets()).issues, []);
});

test('same-source doubles have one specific warning, while different songs have a mixed-music warning', () => {
  const edit = project(); edit.music = [track('first', 'a', 0, 5), track('double', 'a', 1, 5), track('double2', 'a', 2, 5)];
  const result = reviewProject(edit, assets());
  assert.equal(result.ready, true); assert.deepEqual(codes(result), ['music_duplicate']);
  assert.equal(result.issues[0].kind, 'music'); assert.equal(result.issues[0].id, 'double');
  edit.music = [track('first', 'a', 0, 5), track('mixed', 'b', 1, 5), track('mixed2', 'a', 6, 2)];
  assert.deepEqual(codes(reviewProject(edit, assets())), ['music_overlap']);
});

test('multiple mixed/duplicate intervals remain two actionable warning groups, not a pairwise list', () => {
  const edit = project(); edit.music = Array.from({ length: 300 }, (_, index) => track(String(index), index % 2 ? 'a' : 'b', 0, 5));
  const result = reviewProject(edit, assets());
  assert.equal(result.ready, true); assert.equal(result.issues.length, 2);
  assert.deepEqual(new Set(codes(result)), new Set(['music_duplicate', 'music_overlap']));
});

test('large timelines stay bounded, only used assets count, and grouped caption messages stay compact', () => {
  const edit = project(); edit.clips = Array.from({ length: 500 }, (_, index) => clip(`clip-${index}`));
  edit.texts = Array.from({ length: 500 }, (_, index) => ({ id: `text-${index}`, text: '短い', start: index, end: index + .1 }));
  edit.music = Array.from({ length: 500 }, (_, index) => track(`music-${index}`, 'a', index * 2));
  const start = performance.now(), result = reviewProject(edit, assets()), elapsed = performance.now() - start;
  assert.equal(result.ready, true); assert.equal(result.assetBytes, 2048);
  assert.deepEqual(codes(result), ['text_short']); assert.match(result.issues[0].message, /500個/);
  assert.ok(elapsed < 1000, `metadata preflight took ${elapsed.toFixed(1)}ms`);
});

test('malformed project structures are rejected without crashing; invalid captions stay warnings', () => {
  for (const edit of [null, {}, { clips: null }, { clips: [], music: {} }, { clips: [], texts: 'text' }]) {
    assert.deepEqual(codes(reviewProject(edit, assets())), ['invalid_project']);
  }
  const edit = project(); edit.clips.push(null);
  assert.equal(reviewProject(edit, assets()).ready, false);
  edit.clips.pop(); edit.texts.push({ id: 'broken', text: '表示時間', start: 2, end: 1 });
  const result = reviewProject(edit, assets());
  assert.equal(result.ready, true); assert.deepEqual(codes(result), ['invalid_text_range']);
});
