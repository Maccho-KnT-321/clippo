import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';

// Tests actual decoded pixels, not just the presence of transition controls.
// Stabilize pixel assertions independently of this machine's H.264 hardware driver.
// The hardware-path frame-loss limitation is documented in README.md.
const browser = await chromium.launch({channel:'chrome', headless:true, args:['--autoplay-policy=no-user-gesture-required','--disable-accelerated-video-encode','--disable-accelerated-video-decode']});
const page = await browser.newPage({viewport:{width:1440,height:1000}});
page.setDefaultTimeout(20000);
const errors=[];page.on('pageerror',error=>errors.push(error.message));
await mkdir('test-results',{recursive:true});
try {
  await page.goto('http://127.0.0.1:4173');
  const fixtures=await page.evaluate(async()=>{
    const files=[];
    for(const color of ['#ff0000','#0000ff']){
      const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
      const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,320,180);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      files.push([...new Uint8Array(await blob.arrayBuffer())]);
    }
    return files;
  });
  await page.locator('#mediaInput').setInputFiles(fixtures.map((bytes,index)=>({name:index?'blue.png':'red.png',mimeType:'image/png',buffer:Buffer.from(bytes)})));
  await page.waitForFunction(()=>document.querySelectorAll('.track:first-of-type .timeline-clip').length===2||document.querySelectorAll('.timeline-clip').length===2);
  const clips=page.locator('.track').first().locator('.timeline-clip');
  await clips.first().click();
  await page.locator('#scrub').fill('1');await page.locator('#splitBtn').click();
  assert.equal(await clips.count(),3,'split creates adjacent source segments');
  await page.locator('#mergeBtn').click();
  assert.equal(await clips.count(),2,'merge rejoins adjacent compatible source segments');
  await clips.first().click();await page.locator('#copyBtn').click();await page.locator('#pasteBtn').click();
  assert.equal(await clips.count(),3,'copy/paste creates an independent clip');
  await page.locator('#undoBtn').click();assert.equal(await clips.count(),2,'paste supports undo');
  await page.locator('.transition-button').first().click();
  const effect=page.getByLabel('切り替え効果',{exact:true});
  const options=await effect.locator('option').evaluateAll(nodes=>nodes.map(node=>({value:node.value,text:node.textContent})));
  const crossfade=options.find(option=>/クロス|ディゾルブ/.test(option.text));assert(crossfade,'crossfade option is available');
  await effect.selectOption(crossfade.value);
  await page.getByLabel('効果の長さ（秒）',{exact:true}).fill('0.4');
  await page.getByLabel('効果の長さ（秒）',{exact:true}).press('Tab');
  const download=page.waitForEvent('download');await page.locator('#saveProjectBtn').click();
  await (await download).saveAs('test-results/polish.clippo');
  const packed=JSON.parse(await readFile('test-results/polish.clippo','utf8'));
  const pixelResult=await page.evaluate(async({packed})=>{
    const {EditorEngine,supportedFormats}=await import('/engine.js');
    const assets=new Map(packed.assets.map(asset=>[asset.id,{id:asset.id,type:'image',url:asset.data,duration:4,width:320,height:180}]));
    const project=structuredClone(packed.project);
    // Keep the same transition schema serialized by the production UI, but
    // shorten the fixture so export checks run in two seconds.
    for(const clip of project.clips){clip.in=0;clip.out=1;clip.speed=1;}
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
    canvas.style.cssText='position:fixed;right:0;top:0;width:320px;height:180px;z-index:100';
    document.body.append(canvas);const engine=new EditorEngine(canvas,assets);
    const sample=async time=>{await engine.render(project,time);return [...canvas.getContext('2d').getImageData(20,20,1,1).data];};
    const before=await sample(.2),midpoint=await sample(.8),after=await sample(1.2);
    const effects={};
    for(const type of ['black','white','wipe']){
      project.clips[0].transition.type=type;
      effects[type]=await sample(.8);
      if(type==='wipe')effects.wipeRight=[...canvas.getContext('2d').getImageData(620,20,1,1).data];
    }
    project.clips[0].transition.type='dissolve';
    const format=supportedFormats().find(format=>format.startsWith('video/mp4'));
    let exported=null;
    if(format){
      const blob=await engine.export(project,{height:360,mimeType:format});
      const video=document.createElement('video');video.muted=true;video.src=URL.createObjectURL(blob);
      await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(new Error('Export did not decode'));});
      video.style.cssText='position:fixed;top:0;left:0;width:320px;height:180px;z-index:100';video.playbackRate=.5;document.body.append(video);
      const ctx=canvas.getContext('2d'),frames=[];
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('Export playback frame timed out')),8000);
        video.onended=()=>{clearTimeout(timer);resolve();};
        const tick=(_,meta)=>{ctx.drawImage(video,0,0,canvas.width,canvas.height);frames.push({time:meta.mediaTime,pixel:[...ctx.getImageData(20,20,1,1).data]});if(!video.ended)video.requestVideoFrameCallback(tick);};
        video.requestVideoFrameCallback(tick);video.play().catch(reject);
      });
      exported={frames,duration:video.duration,bytes:blob.size,quality:video.getVideoPlaybackQuality().toJSON?.()||{total:video.getVideoPlaybackQuality().totalVideoFrames,dropped:video.getVideoPlaybackQuality().droppedVideoFrames}};video.remove();
      URL.revokeObjectURL(video.src);
    }
    engine.dispose();canvas.remove();return {before,midpoint,after,effects,exported};
  },{packed});
  assert(pixelResult.before[0]>230&&pixelResult.before[2]<20,'before transition is red');
  assert(pixelResult.midpoint[0]>85&&pixelResult.midpoint[0]<175&&pixelResult.midpoint[2]>85&&pixelResult.midpoint[2]<175,'transition midpoint blends both sources');
  assert(pixelResult.after[2]>230&&pixelResult.after[0]<20,'after transition is blue');
  assert(pixelResult.effects.black.slice(0,3).every(v=>v<5),'dip to black midpoint');
  assert(pixelResult.effects.white.slice(0,3).every(v=>v>250),'dip to white midpoint');
  assert(pixelResult.effects.wipe[0]>230&&pixelResult.effects.wipeRight[2]>230,'wipe reveals incoming on right');
  if(pixelResult.exported){
    assert(Math.abs(pixelResult.exported.duration-1.6)<.2,'export length subtracts transition overlap');
    assert(pixelResult.exported.frames.some(f=>f.time>.5&&f.time<1.1&&f.pixel[0]>45&&f.pixel[2]>45),'exported crossfade contains both colors during playback');
  }
  await page.locator('#projectInput').setInputFiles('test-results/polish.clippo');
  await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('プロジェクトを開きました'));
  await page.locator('.transition-button').first().click();
  assert.equal(await effect.inputValue(),crossfade.value,'portable project retains transition type');
  assert.equal(Number(await page.getByLabel('効果の長さ（秒）',{exact:true}).inputValue()),.4,'portable project retains transition duration');
  await page.locator('#scrub').fill('1');await page.locator('#stepForwardBtn').click();
  assert(Number(await page.locator('#scrub').inputValue())>1,'one frame forward advances playhead');
  await page.locator('#stepBackBtn').click();
  assert(Math.abs(Number(await page.locator('#scrub').inputValue())-1)<.005,'one frame back restores playhead');
  await page.setViewportSize({width:390,height:844});await page.locator('#fitTimelineBtn').click();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile page does not overflow');
  await page.screenshot({path:'test-results/polish-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:'test-results/polish-desktop.png',fullPage:true});
  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  console.log('Desktop effects passed; checking mobile touch gestures.');
  const touchPage=await mobile.newPage();await touchPage.goto('http://127.0.0.1:4173');
  await touchPage.locator('#mediaInput').setInputFiles(fixtures.map((bytes,index)=>({name:index?'blue.png':'red.png',mimeType:'image/png',buffer:Buffer.from(bytes)})));
  const touchClips=touchPage.locator('.track').first().locator('.timeline-clip');await touchClips.nth(1).waitFor();
  await touchPage.locator('#fitTimelineBtn').tap();
  const cdp=await mobile.newCDPSession(touchPage);
  const touch=async(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y}]});
  await touchClips.first().scrollIntoViewIfNeeded();
  let first=await touchClips.first().boundingBox(),second=await touchClips.nth(1).boundingBox();
  const y=first.y+40;
  await touch('touchStart',first.x+first.width/2,y);await touchPage.waitForTimeout(400);
  await touch('touchMove',second.x+second.width/2,y);await touch('touchEnd');
  assert.match(await touchClips.first().innerText(),/blue/,'real touch long-press reorders clips');
  await touchPage.locator('#undoBtn').tap();assert.match(await touchClips.first().innerText(),/red/,'touch reorder supports undo');
  await touchClips.first().tap();
  const handle=await touchClips.first().locator('.trim-out').boundingBox();
  await touch('touchStart',handle.x+handle.width/2,handle.y+40);
  await touch('touchMove',handle.x-22,handle.y+40);await touch('touchEnd');
  assert(!/00:04.0/.test(await touchClips.first().innerText()),'real touch handle trims clip');
  await touchPage.locator('.transition-button').first().tap();
  await touchPage.screenshot({path:'test-results/touch-before-effect.png',fullPage:true});
  await touchPage.getByLabel('切り替え効果',{exact:true}).selectOption('dissolve');
  assert.equal(await touchPage.locator('body').getAttribute('data-panel'),'settings','touch transition opens bottom inspector');
  await touchPage.screenshot({path:'test-results/polish-touch.png',fullPage:true});
  await mobile.close();
  assert.deepEqual(errors,[],'no uncaught browser errors');
  console.log('Polish: split/merge, copy/paste undo, all transition pixels, portable transitions, frame step and mobile touch passed.',{exportDuration:pixelResult.exported?.duration,decodedFrames:pixelResult.exported?.frames.length});
} catch(error){await page.screenshot({path:'test-results/polish-failure.png',fullPage:true});throw error;}
finally {await browser.close();}
