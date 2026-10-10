import test from 'node:test';
import assert from 'node:assert/strict';
import {makePresetMusic,presetMusicInfo} from '../music-library.js';
import {addLoopVoice,beatPattern,renderBeat} from '../beat-maker.js';
import {planAutoEdit} from '../auto-edit.js';

async function pcm(file){
  const bytes=await file.arrayBuffer(),view=new DataView(bytes),rate=view.getUint32(24,true);
  assert.equal(file.type,'audio/wav');
  assert.equal(view.getUint16(20,true),1,'PCM encoding');
  assert.equal(view.getUint16(22,true),1,'one channel keeps decode memory small');
  assert.equal(view.getUint16(34,true),16);
  assert.equal(view.getUint32(40,true),bytes.byteLength-44);
  const samples=Array.from({length:(bytes.byteLength-44)/2},(_,i)=>view.getInt16(44+i*2,true)/32768);
  const rms=(from=0,to=samples.length)=>Math.sqrt(samples.slice(from,to).reduce((sum,x)=>sum+x*x,0)/(to-from));
  return {bytes,rate,samples,rms,seconds:samples.length/rate};
}

test('preset metadata, original filenames and exact eight-bar lengths remain consistent',async()=>{
  for(const [style,info]of Object.entries(presetMusicInfo)){
    const file=makePresetMusic(style),wave=await pcm(file);
    assert.equal(file.name,info.name+'.wav');
    assert.equal(file.lastModified,0,'generated preset identity is stable across sessions');
    assert.equal(wave.rate,22050);
    assert(Math.abs(wave.seconds-info.bars*4*60/info.bpm)<=1/wave.rate);
    assert(info.description.length>4);
    assert(file.size<1100000,'preset stays around one megabyte or less');
    assert.deepEqual(await makePresetMusic(style).arrayBuffer(),wave.bytes,'synthesis is deterministic');
  }
});

test('preset PCM keeps headroom and a continuous loop without a baked ending fade',async()=>{
  for(const style of Object.keys(presetMusicInfo)){
    const {samples,rate,rms}=await pcm(makePresetMusic(style));
    let peak=0,mean=0;
    for(const value of samples){peak=Math.max(peak,Math.abs(value));mean+=value;}
    assert(peak>.15&&peak<.9,'no clipped PCM and usable signal level');
    assert(rms()>.035&&rms()<.16,'musical level is neither silent nor flattened');
    assert(Math.abs(mean/samples.length)<.001,'no appreciable DC offset');
    assert(Math.abs(samples[0]-samples.at(-1))<.004,'boundary is smooth at one sample');
    const window=Math.floor(rate*.05),middle=Math.floor(samples.length/2);
    const ending=rms(samples.length-window),interior=rms(middle-window,middle);
    assert(ending>interior*.4,'the ending is not faded to silence on each repeated loop');
  }
});

test('voice tails wrap into the next repetition instead of being truncated',()=>{
  const samples=new Float32Array(8);
  addLoopVoice(samples,6,4,1,t=>t+1);
  assert.deepEqual([...samples],[3,4,0,0,0,0,1,2]);
});

test('beat patterns loop smoothly at each supported tempo and preserve their four-beat format',async()=>{
  for(const name of ['pop','chill','dance'])for(const bpm of [90,110,130]){
    const file=renderBeat(beatPattern(name),bpm),{samples,seconds,rate,rms}=await pcm(file);
    assert.equal(file.name,`マイビート-${bpm}BPM.wav`);
    assert(Math.abs(seconds-8*4*60/bpm)<=1/rate);
    assert(Math.abs(samples[0]-samples.at(-1))<.004,'last bass note carries across the boundary');
    assert(rms()>.025&&rms()<.3);
    assert(samples.every(value=>Number.isFinite(value)&&Math.abs(value)<.9));
  }
});

test('all-on rhythm stays below full scale; empty or invalid data is bounded safely',async()=>{
  const full=await pcm(renderBeat(Array.from({length:4},()=>Array(16).fill(true)),130));
  assert(full.samples.every(value=>Math.abs(value)<.9));
  const silent=await pcm(renderBeat(Array.from({length:4},()=>Array(16).fill(false)),110));
  assert(silent.samples.every(value=>value===0));
  for(const bpm of [0,Infinity,NaN,400])assert.throws(()=>renderBeat(beatPattern('pop'),bpm),/確認/);
  assert.throws(()=>renderBeat([],110),/確認/);
  assert.throws(()=>renderBeat(beatPattern('pop'),110,1000000),/確認/);
});

test('planner uses the same tempo metadata without changing its requested-duration contract',()=>{
  const sources=[{id:'a',type:'video',duration:60},{id:'b',type:'video',duration:20}];
  for(const [style,info]of Object.entries(presetMusicInfo))for(const seconds of [15,30,60]){
    const plan=planAutoEdit(sources,{seconds,style});
    assert(Math.abs(plan.duration-seconds)<.001);
    assert.equal(plan.clips.length,Math.ceil(seconds/(60/info.bpm*(style==='calm'?8:4))));
    assert(plan.clips.every(clip=>clip.in>=0&&clip.out>clip.in));
  }
});

test('local preset synthesis has a bounded CPU and file-size budget',()=>{
  const timings=[];
  for(let trial=0;trial<5;trial++)for(const style of Object.keys(presetMusicInfo)){
    const began=performance.now(),file=makePresetMusic(style);timings.push(performance.now()-began);
    assert(file.size<1100000);
  }
  timings.sort((a,b)=>a-b);
  const p95=timings[Math.ceil(timings.length*.95)-1];
  console.log(`Local synthesis benchmark (this Node host, not an iPhone): p95=${p95.toFixed(1)}ms`);
  assert(p95<2000,'guard against accidental multi-second synthesis regressions');
});
