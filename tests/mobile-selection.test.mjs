import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const context=await browser.newContext({viewport:{width:390,height:744},isMobile:true,hasTouch:true});
  const page=await context.newPage();
  await page.goto(process.env.CLIPPO_URL||'http://127.0.0.1:4173');
  await page.locator('#welcomeDemo').tap();
  const clips=page.locator('.track[data-kind=clips] .timeline-clip');
  await clips.nth(2).waitFor();
  await page.waitForTimeout(250);
  const timeline=page.locator('#timeline');
  const cdp=await context.newCDPSession(page);
  const touch=async(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y}]});

  await timeline.evaluate(e=>e.scrollLeft=0);
  const first=await clips.first().boundingBox();
  const selectedBefore=await page.locator('.timeline-clip.selected').getAttribute('data-id');
  const timeBefore=await page.locator('#scrub').inputValue();
  const orderBefore=await clips.evaluateAll(nodes=>nodes.map(n=>n.dataset.id));
  const startX=Math.min(first.x+first.width-30,300),y=first.y+35;
  await touch('touchStart',startX,y);
  for(let delta=15;delta<=135;delta+=15){await touch('touchMove',startX-delta,y);await page.waitForTimeout(8);}
  await touch('touchEnd');
  await page.waitForTimeout(100);
  assert(await timeline.evaluate(e=>e.scrollLeft)>=110,'quick swipe over a clip pans the timeline');
  assert.equal(await page.locator('.timeline-clip.selected').getAttribute('data-id'),selectedBefore,'navigation does not change selection');
  assert.equal(await page.locator('#scrub').inputValue(),timeBefore,'navigation does not move the playhead');
  assert.deepEqual(await clips.evaluateAll(nodes=>nodes.map(n=>n.dataset.id)),orderBefore,'navigation does not reorder clips');

  await page.waitForTimeout(420);
  await page.locator('#fitTimelineBtn').tap();
  await clips.first().tap();
  assert.equal(Number(await page.locator('#scrub').inputValue()),0,'tapping a different clip seeks to its start');
  await clips.nth(1).tap();
  assert.equal(Number(await page.locator('#scrub').inputValue()),4,'another tap still selects and previews the chosen clip');

  const before=await clips.first().boundingBox(),next=await clips.nth(1).boundingBox();
  await touch('touchStart',before.x+before.width/2,before.y+35);
  await page.waitForTimeout(380);
  await touch('touchMove',next.x+next.width/2,next.y+35);
  await touch('touchEnd');
  assert.match(await clips.first().innerText(),/デモ 2/,'holding before dragging still reorders clips');
  await page.locator('#undoBtn').tap();
  assert.match(await clips.first().innerText(),/デモ 1/,'reordering supports undo');

  // Overlapping text creates vertical overflow; a vertical swipe must remain native.
  for(let i=0;i<4;i++)await page.locator('#addTextBtn').tap();
  await timeline.evaluate(e=>e.scrollTop=0);
  const verticalFirst=await clips.first().boundingBox();
  const verticalSelection=await page.locator('.timeline-clip.selected').getAttribute('data-id');
  const verticalX=verticalFirst.x+verticalFirst.width/2,verticalY=verticalFirst.y+35;
  await touch('touchStart',verticalX,verticalY);
  for(let delta=15;delta<=90;delta+=15){await touch('touchMove',verticalX,verticalY-delta);await page.waitForTimeout(10);}
  await touch('touchEnd');
  await page.waitForTimeout(150);
  assert(await timeline.evaluate(e=>e.scrollTop)>30,'vertical swipes over clips keep native timeline scrolling');
  assert.equal(await page.locator('.timeline-clip.selected').getAttribute('data-id'),verticalSelection,'vertical scrolling does not select the touched clip');

  console.log('Mobile navigation: quick clip swipe pans without selecting or editing; taps preview clips; deliberate long-press reorder, undo and native vertical scrolling passed.');
}finally{await browser.close();}
