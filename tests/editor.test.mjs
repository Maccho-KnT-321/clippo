import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.setDefaultTimeout(20000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await mkdir('test-results',{recursive:true});
try {
 await page.goto('http://127.0.0.1:4173');
 const result=await page.evaluate(async()=>{
  const {EditorEngine,supportedFormats}=await import('/engine.js');
  // Two seconds of moving, audible video: imported with a .MOV name to test
  // container-independent decoding (this is NOT an HEVC compatibility test).
  const src=document.createElement('canvas');src.width=320;src.height=180;
  const ctx=src.getContext('2d'),ac=new AudioContext(),osc=ac.createOscillator(),gain=ac.createGain(),dest=ac.createMediaStreamDestination();
  osc.frequency.value=440;gain.gain.value=.1;osc.connect(gain).connect(dest);osc.start();await ac.resume();
  const stream=src.captureStream(30);dest.stream.getAudioTracks().forEach(t=>stream.addTrack(t));
  const mime=supportedFormats()[0];
  const chunks=[],rec=new MediaRecorder(stream,{mimeType:mime});rec.ondataavailable=e=>chunks.push(e.data);const done=new Promise(r=>rec.onstop=r);rec.start();
  const begin=performance.now();await new Promise(resolve=>{function frame(){const elapsed=performance.now()-begin;ctx.fillStyle=elapsed<900?'#cc2211':'#1144dd';ctx.fillRect(0,0,320,180);ctx.fillStyle='white';ctx.fillRect((elapsed/10)%260,60,30,30);if(elapsed>=1800){rec.stop();resolve();}else requestAnimationFrame(frame);}frame();});await done;osc.stop();stream.getTracks().forEach(t=>t.stop());await ac.close();
  const blob=new Blob(chunks,{type:mime}),url=URL.createObjectURL(blob);
  const video=document.createElement('video');video.muted=true;video.src=url;await new Promise((r,j)=>{video.onloadeddata=r;video.onerror=j;});
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;document.body.append(canvas);
  const assets=new Map([['v',{id:'v',type:'video',url,duration:1.8,width:320,height:180}]]);
  const engine=new EditorEngine(canvas,assets);
  const p={aspect:'16:9',clips:[{id:'a',assetId:'v',in:0,out:.8,speed:2,volume:.5,brightness:1,fit:'contain'},{id:'b',assetId:'v',in:.9,out:1.7,speed:1,volume:1,brightness:1,fit:'cover'}],texts:[{id:'t',text:'TEST テロップ',start:0,end:1.2,size:48,color:'#ffffff',position:'bottom',background:true}],music:[]};
  await engine.render(p,.1);const red=[...canvas.getContext('2d').getImageData(5,5,1,1).data];
  await engine.render(p,.7);const blue=[...canvas.getContext('2d').getImageData(5,5,1,1).data];
  const out=await engine.export(p,{height:360,mimeType:supportedFormats()[0]});
  const outUrl=URL.createObjectURL(out),check=document.createElement('video');check.muted=true;check.src=outUrl;await new Promise((r,j)=>{check.onloadeddata=r;check.onerror=j;});
  const controller=new AbortController();setTimeout(()=>controller.abort(),200);let aborted=false;try{await engine.export(p,{height:360,signal:controller.signal});}catch(e){aborted=e.name==='AbortError';}
  const audioCheck=new AudioContext();const decoded=await audioCheck.decodeAudioData(await out.arrayBuffer());const samples=decoded.getChannelData(0);const rms=Math.sqrt(samples.reduce((sum,v)=>sum+v*v,0)/samples.length);await audioCheck.close();
  const repeat=await engine.export(p,{height:360,mimeType:supportedFormats()[0]});
  const bytes=Array.from(new Uint8Array(await blob.arrayBuffer()));engine.dispose();canvas.remove();
  return {red,blue,size:out.size,type:out.type,width:check.videoWidth,height:check.videoHeight,aborted,rms,repeatSize:repeat.size,fixture:bytes,mime};
 });
 assert(result.red[0]>result.red[2]*2,'first source segment is red');assert(result.blue[2]>result.blue[0]*2,'second source segment is blue');assert(result.size>1000);assert.equal(result.width,640);assert.equal(result.height,360);assert(result.aborted);assert(result.rms>.01,'export contains audible sound');assert(result.repeatSize>1000,'repeated export works');
 console.log('Engine: trimmed multi-clip composition, speed mapping, playable export, dimensions and cancellation passed.',{type:result.type,bytes:result.size});
 await page.locator('#mediaInput').setInputFiles([{name:'iPhone-sample.MOV',mimeType:result.mime,buffer:Buffer.from(result.fixture)}]);
 await page.locator('.timeline-clip').first().waitFor();
 await page.locator('#demoBtn').click();await page.waitForFunction(()=>document.querySelectorAll('.timeline-clip').length>=4);
 await page.locator('#addTextBtn').click();await page.locator('.text-clip').waitFor();
 await page.getByLabel('テキスト',{exact:true}).fill('旅の記録');await page.getByLabel('テキスト',{exact:true}).press('Tab');
 await page.locator('#scrub').fill('0.4');await page.locator('#splitBtn').click();
 assert.equal(await page.locator('.track').first().locator('.timeline-clip').count(),5,'split creates a second segment');
 await page.locator('#undoBtn').click();assert.equal(await page.locator('.track').first().locator('.timeline-clip').count(),4);
 await page.locator('#redoBtn').click();assert.equal(await page.locator('.track').first().locator('.timeline-clip').count(),5);
 await page.locator('.track').first().locator('.timeline-clip').last().click();
 await page.locator('#moveLeftBtn').click();assert.match(await page.locator('.track').first().locator('.timeline-clip').nth(3).innerText(),/デモ 3/);
 await page.getByLabel('再生速度',{exact:true}).fill('2');await page.getByLabel('再生速度',{exact:true}).press('Tab');
 await page.getByLabel('音量（1 = 100%）',{exact:true}).fill('1.5');await page.getByLabel('音量（1 = 100%）',{exact:true}).press('Tab');
 await page.locator('#aspect').selectOption('9:16');assert(await page.locator('#preview').evaluate(c=>c.width<c.height));
 await page.locator('#aspect').selectOption('16:9');
 const trim=page.locator('.timeline-clip.selected .trim-out');const bounds=await trim.boundingBox();assert(bounds);await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width/2-30,bounds.y+bounds.height/2,{steps:5});await page.mouse.up();assert(Number(await page.getByLabel('素材の終了（秒）',{exact:true}).inputValue())<4,'dragging end handle trims clip');
 const music=await page.evaluate(()=>{const n=44100,buffer=new ArrayBuffer(44+n*2),d=new DataView(buffer);const str=(s,o)=>{for(let i=0;i<s.length;i++)d.setUint8(o+i,s.charCodeAt(i));};str('RIFF',0);d.setUint32(4,36+n*2,true);str('WAVEfmt ',8);d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,1,true);d.setUint32(24,44100,true);d.setUint32(28,88200,true);d.setUint16(32,2,true);d.setUint16(34,16,true);str('data',36);d.setUint32(40,n*2,true);for(let i=0;i<n;i++)d.setInt16(44+i*2,Math.sin(i/44100*2*Math.PI*220)*5000,true);return [...new Uint8Array(buffer)];});
 await page.locator('#mediaInput').setInputFiles({name:'music.wav',mimeType:'audio/wav',buffer:Buffer.from(music)});await page.locator('.audio-clip').waitFor();
 const downloaded=page.waitForEvent('download');await page.locator('#saveProjectBtn').click();const file=await downloaded;await file.saveAs('test-results/project.clippo');
 await page.locator('#projectInput').setInputFiles('test-results/project.clippo');await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('プロジェクトを開きました'));
 assert.equal(await page.locator('.audio-clip').count(),1);assert.match(await page.locator('.text-clip').innerText(),/旅の記録/);
 await page.locator('#exportBtn').click();await page.locator('#exportQuality').selectOption('720');await page.locator('#startExportBtn').click();await page.locator('#exportResult a').waitFor({timeout:40000});
 assert.match(await page.locator('#exportMessage').innerText(),/完了/);await page.locator('#closeExportBtn').click();
 await page.screenshot({path:'test-results/desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/mobile.png',fullPage:true});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile viewport has no horizontal overflow');
 await page.locator('[data-panel="settings"]').click();assert(await page.locator('.inspector-panel').isVisible(),'mobile inspector accessible');
 assert.deepEqual(errors,[],'no uncaught browser errors');
 console.log('UI: MOV-named native-decoded fixture import, demo multi-clip, text and mobile overflow passed.');
} catch(error){await page.screenshot({path:'test-results/failure.png',fullPage:true});console.error('UI state:',await page.locator('#toast').textContent(),await page.locator('#exportMessage').textContent());throw error;} finally {await browser.close();}
