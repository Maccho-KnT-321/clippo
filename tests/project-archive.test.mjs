import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectArchive, readProjectArchive } from '../project-archive.js';

const project = () => ({ name: '家族の思い出', aspect: '9:16', clips: [{ id: 'clip', assetId: 'video', in: 0, out: 3 }], texts: [], music: [] });
const assets = () => new Map([['video', { id: 'video', name: '撮影.mov', file: new File(['original-video-bytes'], '撮影.mov', { type: 'video/quicktime', lastModified: 1234 }) }], ['unused', { id: 'unused', file: new File(['unused'], 'unused.mp4') }]]);

test('binary project round trips original bytes and metadata, without packing unused shelf media', async () => {
  const p = project(), before = structuredClone(p), archive = createProjectArchive(p, assets());
  assert.equal(archive.type, 'application/x-clippo-project');
  const loaded = await readProjectArchive(archive);
  assert.deepEqual(loaded.project, before); assert.deepEqual(p, before);
  assert.equal(loaded.assets.length, 1); assert.equal(loaded.assets[0].file.name, '撮影.mov');
  assert.equal(loaded.assets[0].file.type, 'video/quicktime'); assert.equal(loaded.assets[0].file.lastModified, 1234);
  assert.equal(await loaded.assets[0].file.text(), 'original-video-bytes');
});

test('large projects exceeding the former 150MB cap read only a bounded manifest, not video bytes', async () => {
  const file = new File(Array(151).fill(new Uint8Array(1024 * 1024)), 'large.mov', { type: 'video/quicktime' });
  const archive = createProjectArchive(project(), new Map([['video', { id: 'video', file }]]));
  archive.text = () => { throw new Error('whole archive must not be read'); };
  archive.arrayBuffer = () => { throw new Error('whole archive must not be read'); };
  const loaded = await readProjectArchive(archive);
  assert.equal(loaded.assets[0].file.size, file.size);
  assert.ok(archive.size - file.size < 2048, 'no base64 expansion');
});

test('legacy JSON backups remain readable', async () => {
  const data = { format: 'clippo', version: 2, project: project(), assets: [{ id: 'video', name: 'old.mov', data: 'data:video/quicktime;base64,b2xk' }] };
  const loaded = await readProjectArchive(new Blob([JSON.stringify(data)]));
  assert.equal(loaded.version, 2); assert.equal(await loaded.assets[0].file.text(), 'old');
});

test('missing sources and malformed, duplicate or truncated archives are rejected before import', async () => {
  assert.throws(() => createProjectArchive(project(), new Map()), /素材/);
  const archive = createProjectArchive(project(), assets());
  await assert.rejects(readProjectArchive(archive.slice(0, archive.size - 1)), /素材/);
  await assert.rejects(readProjectArchive(new Blob([archive, 'trailing'])), /サイズ/);
  await assert.rejects(readProjectArchive(new Blob(['CLIPPO3\n'])), /途中/);
  await assert.rejects(readProjectArchive(new Blob(['not a project'])), /対応/);
  const data = { format: 'clippo', version: 2, project: project(), assets: Array(2).fill({ id: 'video', name: 'same.mov', data: 'data:video/mp4;base64,eA==' }) };
  await assert.rejects(readProjectArchive(new Blob([JSON.stringify(data)])), /素材/);
});
