import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const url=process.env.CLIPPO_URL||'http://127.0.0.1:4173';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required','--disable-accelerated-video-encode','--disable-accelerated-video-decode']});
async function observeEngine(page){
  await page.evaluate(async()=>{
    const source=await (await fetch(new URL('./app.js',location.href))).text();
    const imported=source.match(/import\s+\{\s*EditorEngine[^;]*from\s+'([^']+)'/)[1];
    const {EditorEngine}=await import(new URL(imported,location.href).href),play=EditorEngine.prototype.play;
    EditorEngine.prototype.play=function(...args){window.liveVolumeEngine=this;return play.apply(this,args);};
  });
}
async function assertGain(page,key,volume){
  await page.waitForFunction(({key,volume})=>window.liveVolumeEngine?.playing&&Math.abs((window.liveVolumeEngine.nodes.get(key)?.gain.gain.value??-1)-volume)<.01,{key,volume});
  assert.equal(await page.locator('#playBtn').getAttribute('aria-label'),'一時停止','volume adjustment does not stop preview playback');
}
async function importPreset(page){
  await page.locator('#welcomeDemo').click();
  await page.locator('#addMusicBtn').click();
  await page.locator('#presetMusicList .music-row').first().getByRole('button',{name:'追加',exact:true}).click();
  await page.locator('.audio-clip').waitFor();
  await page.locator('#scrub').evaluate(input=>{input.value='1';input.dispatchEvent(new Event('input',{bubbles:true}));});
}

try{
  const page=await browser.newPage({viewport:{width:390,height:744},isMobile:true,hasTouch:true}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await observeEngine(page);
  // A short, native-decoded moving clip exercises the real video gain node,
  // not only caption changes or a mocked audio engine.
  const fixture=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;const context=canvas.getContext('2d'),stream=canvas.captureStream(20),chunks=[];
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});recorder.ondataavailable=event=>chunks.push(event.data);const stopped=new Promise(resolve=>recorder.onstop=resolve);recorder.start();
    const start=performance.now();await new Promise(resolve=>{const draw=()=>{context.fillStyle='#327963';context.fillRect(0,0,160,90);context.fillStyle='white';context.fillRect((performance.now()-start)/40%130,30,20,20);if(performance.now()-start>=2800){recorder.stop();resolve();}else requestAnimationFrame(draw);};draw();});
    await stopped;stream.getTracks().forEach(track=>track.stop());return [...new Uint8Array(await new Blob(chunks,{type:recorder.mimeType}).arrayBuffer())];
  });
  await page.locator('#editorMediaInput').setInputFiles({name:'live-volume.webm',mimeType:'video/webm',buffer:Buffer.from(fixture)});
  await page.locator('.timeline-clip').waitFor();await page.locator('#playBtn').tap();await assertGain(page,'clip:lane:0',1);
  await page.locator('#inspector .field[data-key=volume] input').evaluate(input=>{
    input.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1}));
    for(const value of [.6,1.4,1.8]){input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}
  });
  await assertGain(page,'clip:lane:0',1.8);
  await page.locator('#inspector .field[data-key=volume] input').dispatchEvent('pointerup',{pointerId:1});
  await assertGain(page,'clip:lane:0',1.8);
  await page.waitForFunction(()=>document.getElementById('saveProjectBtn').dataset.recovery==='saved');
  assert.equal(await page.evaluate(async()=>{const {loadRecovery}=await import('./project-store.js');return (await loadRecovery()).project.clips[0].volume;}),1.8,'autosave records the gesture final value');
  await page.locator('#undoBtn').tap();await page.locator('.timeline-clip').tap();
  assert.equal(await page.locator('#inspector .field[data-key=volume] input').inputValue(),'1','one undo restores volume before all three input events');
  await page.locator('#undoBtn').tap();assert.equal(await page.locator('.timeline-clip').count(),0,'next undo removes the import, not an intermediate slider value');
  await page.locator('#redoBtn').tap();await page.locator('#redoBtn').tap();await page.locator('.timeline-clip').tap();
  assert.equal(await page.locator('#inspector .field[data-key=volume] input').inputValue(),'1.8','redo reapplies the complete volume gesture');
  await page.close();

  const bgm=await browser.newPage({viewport:{width:390,height:744},isMobile:true,hasTouch:true});bgm.on('pageerror',error=>errors.push(error.message));await bgm.goto(url);await observeEngine(bgm);await importPreset(bgm);
  await bgm.locator('#playBtn').tap();await assertGain(bgm,'music:lane:0',.35);
  const slider=bgm.locator('#inspector .field[data-key=volume] input');
  await slider.evaluate(input=>{
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
    for(const value of [.6,.9,1.2]){input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}
  });
  await assertGain(bgm,'music:lane:0',1.2);await slider.dispatchEvent('keyup',{key:'ArrowRight'});await assertGain(bgm,'music:lane:0',1.2);
  await bgm.locator('#undoBtn').tap();await bgm.locator('.audio-clip').first().tap();assert.equal(await bgm.locator('#inspector .field[data-key=volume] input').inputValue(),'0.35','held keyboard adjustment is also one undo');
  await bgm.locator('#undoBtn').tap();assert.equal(await bgm.locator('.audio-clip').count(),0,'second undo removes music, not a keyboard-repeat value');
  await bgm.close();

  const desktop=await browser.newPage({viewport:{width:1440,height:1000}});desktop.on('pageerror',error=>errors.push(error.message));await desktop.goto(url);await observeEngine(desktop);await importPreset(desktop);
  await desktop.locator('#playBtn').click();await assertGain(desktop,'music:lane:0',.35);
  const number=desktop.locator('#inspector .field[data-key=volume] input');assert.equal(await number.getAttribute('type'),'number');
  await number.fill('1.5');await assertGain(desktop,'music:lane:0',1.5);await number.fill('1.2');await number.press('Tab');await assertGain(desktop,'music:lane:0',1.2);
  await number.fill('9');await number.dispatchEvent('change');assert.equal(await number.inputValue(),'1.2','out-of-range value restores the last valid volume');await assertGain(desktop,'music:lane:0',1.2);
  await desktop.locator('#undoBtn').click();await desktop.locator('.audio-clip').first().click();assert.equal(await desktop.locator('#inspector .field[data-key=volume] input').inputValue(),'0.35','number typing is coalesced until its change/blur commit');
  await desktop.locator('.track[data-kind=clips] .timeline-clip').first().click();await desktop.locator('#playBtn').click();
  await desktop.waitForFunction(()=>window.liveVolumeEngine?.playing);
  await desktop.getByLabel('再生速度',{exact:true}).fill('2');await desktop.getByLabel('再生速度',{exact:true}).dispatchEvent('change');
  assert.equal(await desktop.evaluate(()=>window.liveVolumeEngine.playing),false,'non-volume edits retain their existing stop-on-edit behavior');
  assert.deepEqual(errors,[]);
  console.log('Live volume: video/BGM gains update while playing, pointer and held-key gestures are one undo, final value autosaves, number editing and invalid input stay safe, non-volume behavior unchanged.');
}finally{await browser.close();}
