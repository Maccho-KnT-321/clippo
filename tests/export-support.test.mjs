import test from 'node:test';
import assert from 'node:assert/strict';
import {keepScreenAwake,playbackMessage} from '../export-support.js';
test('screen guard releases on completion',async()=>{
  let released=0;const guard=keepScreenAwake({request:async type=>{assert.equal(type,'screen');return {release:async()=>released++};}});
  assert(await guard.ready);await guard.release();await guard.release();assert.equal(released,1);
});
test('late lock is released even after cancellation',async()=>{
  let resolve,released=0;const guard=keepScreenAwake({request:()=>new Promise(r=>resolve=r)});
  await guard.release();resolve({release:async()=>released++});await guard.ready;assert.equal(released,1);
});
test('unsupported or denied wake lock does not block export',async()=>{
  assert.equal(await keepScreenAwake({}).ready,false);
  const guard=keepScreenAwake({request:async()=>{throw new Error('denied');}});assert.equal(await guard.ready,false);await guard.release();
});
test('permission errors show actionable Japanese, not raw system text',()=>{
  assert.match(playbackMessage({name:'NotAllowedError'}),/再生ボタン/);
  assert.match(playbackMessage({name:'NotAllowedError'},'export'),/画面を閉じて/);
  assert.match(playbackMessage({name:'NotSupportedError'}),/MP4/);
  assert.equal(playbackMessage(new Error('specific')),'specific');
});
