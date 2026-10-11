import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(process.env.CLIPPO_URL||'http://127.0.0.1:4173');
  const result=await page.evaluate(async()=>{
    const m=await import('./vendor/mediabunny/mediabunny.js');
    const {EditorEngine}=await import('./engine.js');const {projectDuration}=await import('./timeline.js');
    const c=document.createElement('canvas');c.width=320;c.height=180;document.body.append(c);const ctx=c.getContext('2d');
    const target=new m.BufferTarget(),output=new m.Output({format:new m.Mp4OutputFormat({fastStart:'in-memory'}),target});
    const v=new m.CanvasSource(c,{codec:'avc',bitrate:1000000}),a=new m.AudioBufferSource({codec:'aac',bitrate:128000});
    output.addVideoTrack(v,{frameRate:30});output.addAudioTrack(a);await output.start();
    const pcm=new AudioBuffer({length:57600,numberOfChannels:1,sampleRate:48000});
    const wave=pcm.getChannelData(0);for(let i=0;i<wave.length;i++){const t=i/48000;wave[i]=t>=.4&&t<.6?Math.sin(t*2*Math.PI*660)*.15:0;}
    await a.add(pcm);
    for(let frame=0;frame<36;frame++){ctx.fillStyle=`rgb(${40+frame*5},40,${220-frame*5})`;ctx.fillRect(0,0,320,180);ctx.fillStyle='white';ctx.fillRect(frame*7,70,12,12);await v.add(frame/30,1/30);}
    await output.finalize();const file=new File([target.buffer],'iPhone-style.mp4',{type:'video/mp4'}),url=URL.createObjectURL(file);
    const assets=new Map([['v',{id:'v',name:file.name,type:'video',file,url,duration:1.2,width:320,height:180}]]);
    const engine=new EditorEngine(c,assets),project={aspect:'16:9',clips:[
      {id:'first',assetId:'v',in:.1,out:1.1,speed:1,volume:.5,brightness:1,fit:'contain',transition:{type:'dissolve',duration:.4}},
      {id:'repeat',assetId:'v',in:.1,out:1.1,speed:1,volume:.5,brightness:1,fit:'contain'}
    ],texts:[{id:'title',text:'思い出',start:0,end:1.6,size:42,color:'#ffffff',position:'bottom',background:true}],music:[]};
    const total=projectDuration(project),progress=[],modes=[];
    // Force composition below real-time speed. The encoded timeline must still
    // contain every frame, rather than completing with the frame-drop symptom.
    const paint=engine.paintFrame.bind(engine);engine.paintFrame=(...args)=>{const start=performance.now();while(performance.now()-start<45){}return paint(...args);};
    const start=performance.now(),blob=await engine.export(project,{height:360,mode:'reliable',onProgress:p=>progress.push(p),onMode:m=>modes.push(m.mode)}),elapsed=performance.now()-start;
    const check=new m.Input({source:new m.BlobSource(blob),formats:m.ALL_FORMATS});const track=await check.getPrimaryVideoTrack();
    const stats=await track.computePacketStats(),duration=await check.computeDuration();
    const sink=new m.CanvasSink(track,{poolSize:1}),pixels=[];
    for(const time of [.1,.8,1.5]){const wrapped=await sink.getCanvas(time);pixels.push([...wrapped.canvas.getContext('2d').getImageData(20,20,1,1).data]);}
    const audio=new AudioContext(),decoded=await audio.decodeAudioData(await blob.arrayBuffer()),samples=decoded.getChannelData(0);
    const rms=Math.sqrt(samples.reduce((sum,n)=>sum+n*n,0)/samples.length);
    const windowRms=time=>{const start=Math.round(time*decoded.sampleRate),end=Math.min(samples.length,start+Math.round(.01*decoded.sampleRate));let sum=0;for(let i=start;i<end;i++)sum+=samples[i]*samples[i];return Math.sqrt(sum/(end-start));};
    const firstPulse=Array.from({length:80},(_,i)=>i/100).find(time=>windowRms(time)>.015);
    const repeatedPulse=windowRms(.95),silence=windowRms(.15);await audio.close();check.dispose();
    engine.paintFrame=paint;
    // Explicit quality mode never silently switches to real-time after a user
    // requests pitch-preserving audible speed changes.
    project.clips[0].speed=2;let reason='';try{await engine.export(project,{height:360,mode:'reliable'});}catch(error){reason=error.message;}project.clips[0].speed=1;
    const controller=new AbortController();let aborted=false;
    try{await engine.export(project,{height:360,mode:'reliable',signal:controller.signal,onProgress:p=>{if(p>.1)controller.abort();}});}catch(error){aborted=error.name==='AbortError';}
    const afterCancel={exporting:engine.exporting,width:c.width,height:c.height};
    const again=await engine.export(project,{height:360,mode:'auto',onMode:m=>modes.push(m.mode)});
    const bytes=await blob.arrayBuffer();engine.dispose();c.remove();URL.revokeObjectURL(url);
    return {frames:stats.packetCount,total,duration,elapsed,pixels,rms,firstPulse,repeatedPulse,silence,type:blob.type,size:blob.size,modes,reason,aborted,afterCancel,again:again.size,progress};
  });
  assert.equal(result.frames,Math.ceil(result.total*30),'all scheduled frames are encoded');
  assert.ok(result.elapsed>result.total*1000,'fixture renders slower than real time');
  assert.ok(Math.abs(result.duration-result.total)<.05,'audio/video timestamps preserve full project duration');
  assert.equal(result.type,'video/mp4');assert.ok(result.size>1000);assert.ok(result.rms>.01,'trimmed original audio survives offline mixing');
  assert.ok(Math.abs(result.firstPulse-.3)<.035,'trimmed source sound starts at the expected timeline time');assert.ok(result.repeatedPulse>.02,'repeated-source audio is aligned to its own cut');assert.ok(result.silence<.003,'audio before the source pulse stays silent');
  assert.ok(result.pixels[0][2]>result.pixels[0][0],'first source trim starts blue');assert.ok(result.pixels[2][0]>result.pixels[2][2],'last source trim ends red');
  assert.deepEqual(result.modes,['reliable','reliable']);assert.match(result.reason,/音程/);
  assert.ok(result.aborted);assert.deepEqual(result.afterCancel,{exporting:false,width:320,height:180});assert.ok(result.again>1000,'export works after cancellation');
  assert.equal(result.progress.at(-1),1);assert.ok(result.progress.every((p,i)=>!i||p>=result.progress[i-1]));assert.deepEqual(errors,[]);
  console.log('Reliable export: every 30fps frame retained below real-time speed; repeated-source dissolve, captions, source audio, duration, cancellation and retry verified.',{frames:result.frames,seconds:result.duration,rms:result.rms,elapsed:result.elapsed});
}finally{await browser.close();}
