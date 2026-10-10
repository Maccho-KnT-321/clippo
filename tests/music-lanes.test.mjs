import {musicLanes} from '../timeline.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorEngine} from '../engine.js';
test('repeated BGM loops reuse one lane',()=>{
  const keys=musicLanes(Array.from({length:40},(_,i)=>({id:String(i),assetId:'same',start:i,in:0,out:1})));
  assert.equal(new Set(keys.values()).size,1);
});
test('overlapping instances of the same source get independent lanes',()=>{
  const keys=musicLanes([{id:'a',assetId:'same',start:0,in:0,out:5},{id:'b',assetId:'same',start:2,in:1,out:4},{id:'c',assetId:'other',start:5,in:0,out:1}]);
  assert.notEqual(keys.get('a'),keys.get('b'));assert.equal(keys.get('a'),keys.get('c'));
});
test('compositor assigns separate players and gains to overlapping audio',async()=>{
  const ctx={save(){},restore(){},fillRect(){}};
  const engine=new EditorEngine({width:100,height:100,getContext:()=>ctx},new Map());
  const keys=[],positions=[],gains=new Map();
  engine.element=async(assetId,key)=>{keys.push(key);return {key,error:null,currentTime:0,paused:true};};
  engine.seek=async(el,time)=>positions.push([el.key,time]);
  engine.node=(el,key)=>{const gain={gain:{value:0}};gains.set(key,gain);return gain;};
  await engine.render({clips:[],texts:[],music:[{id:'a',assetId:'same',start:0,in:0,out:5,volume:.2},{id:'b',assetId:'same',start:1,in:2,out:6,volume:.8}]},2);
  assert.equal(new Set(keys).size,2);assert.deepEqual(positions,[['music:lane:0',2],['music:lane:1',3]]);
  assert.equal(gains.get('music:lane:0').gain.value,.2);assert.equal(gains.get('music:lane:1').gain.value,.8);
});
