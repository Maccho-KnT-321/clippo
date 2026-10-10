import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-accelerated-video-encode','--disable-accelerated-video-decode']});
try{
  const context=await browser.newContext({viewport:{width:390,height:744},isMobile:true,hasTouch:true});
  const page=await context.newPage();
  await page.goto(process.env.CLIPPO_URL||'http://127.0.0.1:4173');
  const fixtures=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#ff0000';ctx.fillRect(0,0,160,90);
    const stream=canvas.captureStream(30),recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'}),chunks=[];
    recorder.ondataavailable=e=>chunks.push(e.data);
    const finished=new Promise(resolve=>recorder.onstop=()=>resolve(new Blob(chunks,{type:recorder.mimeType})));
    recorder.start();
    for(let i=0;i<65;i++){ctx.fillStyle='#ff0000';ctx.fillRect(0,0,160,90);await new Promise(resolve=>setTimeout(resolve,33));}
    recorder.stop();const movie=await finished;stream.getTracks().forEach(t=>t.stop());
    ctx.fillStyle='#0000ff';ctx.fillRect(0,0,160,90);
    const photo=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    return {movie:[...new Uint8Array(await movie.arrayBuffer())],photo:[...new Uint8Array(await photo.arrayBuffer())]};
  });
  await page.locator('#mediaInput').setInputFiles([
    {name:'source-red.webm',mimeType:'video/webm',buffer:Buffer.from(fixtures.movie)},
    {name:'neighbor-blue.png',mimeType:'image/png',buffer:Buffer.from(fixtures.photo)},
  ]);
  const clips=page.locator('.track[data-kind=clips] .timeline-clip');
  await clips.nth(1).waitFor();
  await page.locator('#fitTimelineBtn').tap();await clips.first().tap();
  await page.locator('.transition-button').first().tap();
  await page.getByLabel('切り替え効果',{exact:true}).selectOption('dissolve');
  await clips.first().tap();
  for(const name of ['映像と音のフェードイン（秒）','映像と音のフェードアウト（秒）']){
    await page.getByLabel(name,{exact:true}).evaluate(input=>{input.value='.6';input.dispatchEvent(new Event('change',{bubbles:true}));});
  }
  const originalOut=Number(await page.getByLabel('素材の終了（秒）',{exact:true}).inputValue());
  assert(originalOut>1.8,'video fixture contains enough frames for an edge seek');
  await page.locator('#scrub').fill('0.7');await page.locator('#scrub').dispatchEvent('input');
  await page.waitForTimeout(100);

  await page.evaluate(async()=>{
    const url=performance.getEntriesByType('resource').find(entry=>/\/engine\.js(?:\?|$)/.test(entry.name)).name;
    const {EditorEngine}=await import(url),render=EditorEngine.prototype.render,seek=EditorEngine.prototype.seek;
    window.trimDraws=[];window.trimSeeks=[];
    EditorEngine.prototype.render=function(project,time){
      window.trimDraws.push({time,clips:project.clips.map(c=>({...c})),texts:project.texts.length,music:project.music.length});
      return render.call(this,project,time);
    };
    EditorEngine.prototype.seek=async function(element,value){
      await seek.call(this,element,value);
      if(element instanceof HTMLVideoElement)window.trimSeeks.push({requested:value,actual:element.currentTime});
    };
  });
  const cdp=await context.newCDPSession(page);
  const touch=async(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'||type==='touchCancel'?[]:[{x,y}]});
  const preview=()=>page.evaluate(()=>{const canvas=document.getElementById('preview');return [...canvas.getContext('2d').getImageData(canvas.width/2,canvas.height/2,1,1).data];});

  let handle=await clips.first().locator('.trim-out').boundingBox();
  const startX=handle.x+handle.width/2,startY=handle.y+handle.height/2;
  await touch('touchStart',startX,startY);
  await touch('touchMove',startX-8,startY);await touch('touchMove',startX-16,startY);
  await page.waitForFunction(()=>window.trimDraws.at(-1)?.clips.length===1&&window.trimSeeks.length>0);
  const endSample=await page.evaluate(()=>({draw:window.trimDraws.at(-1),seek:window.trimSeeks.at(-1)}));
  assert(endSample.draw.clips[0].out<originalOut);
  assert.equal(endSample.draw.clips[0].transition.type,'none','trim preview suppresses neighboring dissolve');
  assert.equal(endSample.draw.clips[0].fadeOut,0,'trim preview shows the frame, not a fade to black');
  assert.equal(endSample.draw.texts,0);assert.equal(endSample.draw.music,0);
  assert(Math.abs(endSample.seek.requested-(endSample.draw.clips[0].out-.001))<.002,'end trim requests the selected source end frame');
  assert(Math.abs(endSample.seek.actual-endSample.seek.requested)<.026,'decoded video is at the source boundary within seek tolerance');
  const pixel=await preview();assert(pixel[0]>220&&pixel[2]<30,'edge preview is the red source, never the blue neighbor');
  await touch('touchEnd');
  await page.waitForFunction(()=>window.trimDraws.at(-1)?.clips.length===2);
  await page.waitForFunction(()=>{const canvas=document.getElementById('preview'),pixel=canvas.getContext('2d').getImageData(canvas.width/2,canvas.height/2,1,1).data;return pixel[2]>200&&pixel[0]<50;});
  const trimmedOut=Number(await page.getByLabel('素材の終了（秒）',{exact:true}).inputValue());
  assert(trimmedOut<originalOut,'trim is committed on release');
  await page.locator('#undoBtn').tap();await clips.first().tap();
  assert(Math.abs(Number(await page.getByLabel('素材の終了（秒）',{exact:true}).inputValue())-originalOut)<.002,'one undo restores the entire multi-move gesture');
  await page.locator('#redoBtn').tap();await clips.first().tap();
  assert(Math.abs(Number(await page.getByLabel('素材の終了（秒）',{exact:true}).inputValue())-trimmedOut)<.002,'redo reapplies the entire gesture');

  await page.locator('#scrub').fill('0.7');await page.locator('#scrub').dispatchEvent('input');
  handle=await clips.first().locator('.trim-in').boundingBox();
  const inX=handle.x+handle.width/2,inY=handle.y+handle.height/2;
  await page.evaluate(()=>{window.trimDraws=[];window.trimSeeks=[];});
  await touch('touchStart',inX,inY);await touch('touchMove',inX+12,inY);
  await page.waitForFunction(()=>window.trimDraws.at(-1)?.clips.length===1&&window.trimSeeks.length>0);
  const startSample=await page.evaluate(()=>({draw:window.trimDraws.at(-1),seek:window.trimSeeks.at(-1)}));
  assert(startSample.draw.clips[0].in>0);
  assert(Math.abs(startSample.seek.requested-startSample.draw.clips[0].in)<.002,'start trim requests the selected source beginning frame');
  await touch('touchCancel');
  await page.waitForFunction(()=>window.trimDraws.at(-1)?.clips.length===2);
  assert.equal(Number(await page.getByLabel('素材の開始（秒）',{exact:true}).inputValue()),0,'cancel restores source beginning');
  assert(Math.abs(Number(await page.locator('#scrub').inputValue())-.7)<.002,'cancel restores the original playhead');
  await page.locator('#undoBtn').tap();await clips.first().tap();
  assert(Math.abs(Number(await page.getByLabel('素材の終了（秒）',{exact:true}).inputValue())-originalOut)<.002,'cancel does not consume or add an undo step');
  console.log('Trim preview: real video source-edge seek, no neighboring dissolve, source pixels, one-gesture undo/redo, cancel restores cut and playhead, normal composite restored.');
}finally{await browser.close();}
