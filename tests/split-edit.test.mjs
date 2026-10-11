import test from 'node:test';
import assert from 'node:assert/strict';
import { canSplitAtPlayhead, splitAtPlayhead } from '../editing.js';
import { projectDuration } from '../timeline.js';
const clip=(id='video')=>({id,assetId:'v',in:0,out:10,speed:1,volume:1,fadeIn:.2,fadeOut:.4});
const project=()=>({clips:[clip()],texts:[{id:'text',start:1,end:5,text:'Hello',fade:.3}],music:[{id:'music',assetId:'a',start:2,in:1,out:7,volume:.4,fadeIn:.2,fadeOut:.7}]});

test('split respects the selected caption and preserves outer fades and unrelated video',()=>{
  const p=project(),before=structuredClone(p.clips);
  assert.deepEqual(splitAtPlayhead(p,{kind:'texts',id:'text'},3,()=> 'right'),{kind:'texts',id:'right'});
  assert.deepEqual(p.clips,before);assert.equal(p.texts[0].end,3);assert.equal(p.texts[1].start,3);
  assert.equal(p.texts[0].fadeIn,.3);assert.equal(p.texts[0].fadeOut,0);assert.equal(p.texts[1].fadeIn,0);assert.equal(p.texts[1].fadeOut,.3);
});
test('music split maps absolute playhead to source offset without changing gain or introducing silence',()=>{
  const p=project();splitAtPlayhead(p,{kind:'music',id:'music'},4,()=> 'right');
  assert.equal(p.music[0].out,3);assert.equal(p.music[1].in,3);assert.equal(p.music[1].start,4);assert.equal(p.music[1].out,7);
  assert.equal(p.music[0].fadeOut,0);assert.equal(p.music[1].fadeIn,0);assert.equal(p.music[1].fadeOut,.7);assert.equal(p.music[1].volume,.4);assert.equal(p.clips.length,1);
});
test('selection outside playhead and boundary cuts are refused without cutting the video behind them',()=>{
  for(const selected of [{kind:'texts',id:'text'},{kind:'music',id:'music'},{kind:'clips',id:'missing'}]){
    const p=project(),before=structuredClone(p);assert.equal(canSplitAtPlayhead(p,selected,.5),false);assert.equal(splitAtPlayhead(p,selected,.5),null);assert.deepEqual(p,before);
  }
});
test('unselected split uses the current video and preserves outgoing transition and total duration',()=>{
  const p=project();p.clips[0].transition={type:'dissolve',duration:1};p.clips.push(clip('next'));
  const before=projectDuration(p);assert.equal(canSplitAtPlayhead(p,null,5),true);splitAtPlayhead(p,null,5,()=> 'right');
  assert.equal(p.clips[0].transition.type,'none');assert.equal(p.clips[1].transition.type,'dissolve');assert.equal(projectDuration(p),before);
});
test('cuts that silently clamp an adjacent dissolve and move all following timestamps are disabled',()=>{
  const p=project();p.clips[0].transition={type:'dissolve',duration:1};p.clips.push(clip('next'));
  for(const [id,time]of [['video',8.5],['next',10.5],['video',9.5]]){
    const before=structuredClone(p);assert.equal(canSplitAtPlayhead(p,{kind:'clips',id},time),false);assert.equal(splitAtPlayhead(p,{kind:'clips',id},time),null);assert.deepEqual(p,before);
  }
});
