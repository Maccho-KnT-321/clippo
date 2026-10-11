import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentGain, mixDecodedBuffer, limitAudio } from '../export-audio.js';
test('fade envelope matches preview and combines independent transition crossfades',()=>{
  const s={start:0,end:2,volume:1,fadeIn:2,fadeOut:2};assert.equal(segmentGain(s,1),.5);
  assert.equal(segmentGain({...s,crossIn:2},1),.25);assert.equal(segmentGain(s,2),0);
});
test('decoded packets are trimmed and mixed on the output sample clock with stereo mapping',()=>{
  const output=[new Float32Array(8),new Float32Array(8)],buffer={sampleRate:4,length:4,numberOfChannels:1,getChannelData:()=>new Float32Array([.2,.4,.6,.8])};
  mixDecodedBuffer(output,0,4,{start:.5,end:1.25,in:.25,volume:.5,speed:1},{timestamp:0,buffer});
  assert.deepEqual([...output[0]].map(n=>Math.round(n*100)),[0,0,20,30,40,0,0,0]);assert.deepEqual(output[0],output[1]);
});
test('soft limiting prevents overlapping music clipping without altering ordinary quiet samples',()=>{
  const data=[new Float32Array([0,.5,.9,1,3,-3])];limitAudio(data);
  assert.equal(data[0][1],.5);assert.ok(data[0][3]>.9&&data[0][3]<1);assert.ok(data[0][4]<=1&&data[0][5]>=-1);
});
