import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {trimToPlayhead,insertionAt} from '../editing.js';
import {renderBeat,beatPattern} from '../beat-maker.js';

const clips=[{id:'a',in:1,out:5,speed:2},{id:'b',in:0,out:2,speed:1}];
assert.equal(insertionAt(clips,.1),0);assert.equal(insertionAt(clips,1.5),1);
assert(trimToPlayhead(clips,'a',1,'start'));assert.equal(clips[0].in,3);
assert(!trimToPlayhead(clips,'a',0,'end'));
const wav=renderBeat(beatPattern('pop'),110),bytes=await wav.arrayBuffer(),view=new DataView(bytes);
assert.equal(view.getUint32(24,true),22050);assert(bytes.byteLength>500000);
let peak=0;for(let i=44;i<bytes.byteLength;i+=2)peak=Math.max(peak,Math.abs(view.getInt16(i,true)));assert(peak>3000&&peak<32767);
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const context=await browser.newContext({viewport:{width:1440,height:1100},hasTouch:true}),page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));await mkdir('test-results',{recursive:true});
try{
  await page.goto('http://127.0.0.1:4173');
  await page.locator('#welcomeDemo').click();await page.locator('.timeline-clip').nth(2).waitFor();
  const count=()=>page.locator('.track[data-kind=clips] .timeline-clip').count();
  // A real HTML drag from the library inserts at the indicated timeline boundary.
  const before=await count();await page.locator('.media-card').first().dragTo(page.locator('.timeline-board'),{targetPosition:{x:100,y:50}});
  assert.equal(await count(),before+1,'library drag inserts a clip');
  await page.locator('#undoBtn').click();assert.equal(await count(),before,'drop is undoable');
  const cdp=await context.newCDPSession(page),grip=await page.locator('.media-grip').first().boundingBox(),board=await page.locator('.timeline-board').boundingBox();
  const touch=async(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y}]});
  await touch('touchStart',grip.x+grip.width/2,grip.y+grip.height/2);await page.waitForTimeout(400);
  await touch('touchMove',board.x+100,board.y+50);await touch('touchEnd');
  assert.equal(await count(),before+1,'touch grip drops library media');await page.locator('#undoBtn').click();
  // External file drop uses the same import path and cannot navigate away.
  const transfer=await page.evaluateHandle(()=>{const c=document.createElement('canvas');c.width=80;c.height=60;c.getContext('2d').fillRect(0,0,80,60);const raw=atob(c.toDataURL().split(',')[1]),data=Uint8Array.from(raw,c=>c.charCodeAt(0)),dt=new DataTransfer();dt.items.add(new File([data],'dropped.png',{type:'image/png'}));return dt;});
  await page.locator('#timeline').dispatchEvent('dragenter',{dataTransfer:transfer});
  assert(await page.locator('body').evaluate(b=>b.classList.contains('file-drag')));
  await page.locator('#timeline').dispatchEvent('drop',{dataTransfer:transfer,clientX:100});
  await page.waitForFunction(()=>document.querySelectorAll('.track[data-kind=clips] .timeline-clip').length===4);
  assert.match(await page.locator('.track[data-kind=clips] .timeline-clip').first().innerText(),/dropped/);
  await page.locator('.track[data-kind=clips] .timeline-clip').first().click();await page.locator('#scrub').fill('1');await page.locator('#trimStartBtn').click();
  assert.equal(Number(await page.getByLabel('素材の開始（秒）',{exact:true}).inputValue()),1,'ripple trim uses playhead');
  await page.locator('.timeline-clip').first().click({button:'right'});assert(await page.locator('#clipMenu').isVisible());await page.keyboard.press('Escape');
  await page.locator('.template-launch').first().click();await page.locator('[data-template=short]').click();await page.locator('#templateTitle').fill('はじめての作品');await page.locator('#applyTemplateBtn').click();
  await page.locator('#templateDialog').waitFor({state:'hidden'});assert.equal(await page.locator('#aspect').inputValue(),'9:16');assert.match(await page.locator('.text-clip').innerText(),/はじめての作品/);assert(await page.locator('.audio-clip').count()>0);
  // Imported audio survives a new page on the same browser origin.
  await page.locator('#addMusicBtn').click();await page.locator('#localMusicInput').setInputFiles({name:'my-music.wav',mimeType:'audio/wav',buffer:Buffer.from(bytes)});
  await page.locator('#savedMusicList').getByText('my-music',{exact:true}).waitFor();
  await page.locator('#openBeatBtn').click();await page.locator('#beatPreset').selectOption('dance');await page.locator('#beatTempo').selectOption('130');
  const cell=page.getByRole('button',{name:'ドラム 2番目',exact:true});await cell.click();assert.equal(await cell.getAttribute('aria-pressed'),'true');
  await page.locator('#playBeatBtn').click();await page.waitForFunction(()=>document.querySelector('.beat-cell.playing'));
  await page.locator('#stopBeatBtn').click();assert.equal(await page.locator('.beat-cell.playing').count(),0);
  await page.locator('#saveBeatBtn').click();await page.locator('#beatDialog').waitFor({state:'hidden'});
  const next=await context.newPage();await next.goto('http://127.0.0.1:4173');await next.locator('#addMusicBtn').click();
  await next.locator('#savedMusicList').getByText('my-music',{exact:true}).waitFor();await next.locator('#savedMusicList').getByText('マイビート-130BPM',{exact:true}).waitFor();await next.close();
  await page.screenshot({path:'test-results/creative-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.locator('#addMusicBtn').click();await page.locator('#openBeatBtn').click();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile page fits');
  assert(await page.locator('#beatGrid').evaluate(el=>el.scrollWidth>el.clientWidth),'beat grid is deliberately horizontally scrollable');
  await page.screenshot({path:'test-results/creative-beat-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('Creative tools: drag/drop, ripple trim, context actions, template composition, persistent imports, beat WAV, sequencer and mobile layout passed.');
}finally{await browser.close();}
