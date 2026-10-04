import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto('http://127.0.0.1:4173');
  await page.locator('#editorMediaInput').setInputFiles({name:'empty.mov',mimeType:'video/quicktime',buffer:Buffer.alloc(0)});
  await page.locator('#importReport').waitFor();assert.match(await page.locator('#importReportMessage').innerText(),/ファイルが空/);
  await page.locator('#importReport button').click();
  await page.locator('#editorMediaInput').setInputFiles({name:'broken.mp4',mimeType:'video/mp4',buffer:Buffer.from('not a video')});
  await page.locator('#importReport').waitFor();assert.match(await page.locator('#importReportMessage').innerText(),/再生できません|デコードできません/);
  await page.locator('#importReport button').click();
  const file=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;const ctx=canvas.getContext('2d'),stream=canvas.captureStream(20),chunks=[];
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});recorder.ondataavailable=e=>chunks.push(e.data);const done=new Promise(resolve=>recorder.onstop=resolve);recorder.start();
    const start=performance.now();await new Promise(resolve=>{const draw=()=>{ctx.fillStyle='#b2dd69';ctx.fillRect(0,0,160,90);ctx.fillStyle='#22553c';ctx.fillRect(((performance.now()-start)/10)%100,20,30,30);if(performance.now()-start>900){recorder.stop();resolve();}else requestAnimationFrame(draw);};draw();});await done;stream.getTracks().forEach(t=>t.stop());return [...new Uint8Array(await new Blob(chunks,{type:recorder.mimeType}).arrayBuffer())];
  });
  await page.locator('#editorMediaInput').setInputFiles({name:'recorded.webm',mimeType:'video/webm',buffer:Buffer.from(file)});
  await page.locator('.timeline-clip').first().waitFor({timeout:50000});
  assert.equal(await page.locator('#importReport').isVisible(),false);
  assert.equal(await page.locator('body').getAttribute('data-panel'),'edit','import stays in editor');
  const chooser=page.waitForEvent('filechooser');await page.locator('#editorImportBtn').tap();assert((await chooser).isMultiple());
  for(const height of [844,667]){
    await page.setViewportSize({width:390,height});
    const check=await page.evaluate(()=>{const p=document.querySelector('.viewer-panel').getBoundingClientRect(),t=document.getElementById('timeline').getBoundingClientRect();return {previewTop:p.top,previewBottom:p.bottom,timelineTop:t.top,timelineBottom:t.bottom,timelineHeight:t.height,pageHeight:document.documentElement.scrollHeight,viewport:innerHeight};});
    assert(check.previewTop>=0&&check.previewBottom<=check.timelineTop,'preview remains above timeline');
    assert(check.timelineBottom<=height&&check.timelineHeight>65,'timeline remains usable in viewport');
    assert(check.pageHeight<=height,'no page scroll required');
    await page.locator('#timeline').evaluate(el=>el.scrollTop=120);
    assert.equal(await page.evaluate(()=>window.scrollY),0,'timeline scroll does not move preview');
  }
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/editor-fixed-verified.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('Import/layout: empty and broken files explained, recorded WebM duration recovered, direct editor import, fixed preview at 844/667px passed.');
}finally{await browser.close();}
