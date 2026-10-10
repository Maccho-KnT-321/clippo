import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';

const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:390,height:744},isMobile:true,hasTouch:true});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(process.env.CLIPPO_URL||'http://127.0.0.1:4173');
  await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/taskforce-start-mobile.png'});
  await page.locator('#welcomeDemo').tap();await page.locator('.timeline-clip').nth(2).waitFor();
  const divider=page.locator('#workspaceDivider'),client=await page.context().newCDPSession(page);
  const measure=()=>page.evaluate(()=>{const p=document.querySelector('.viewer-panel').getBoundingClientRect(),t=document.querySelector('#timeline').getBoundingClientRect(),b=document.querySelector('#mobileEditorToolbar').getBoundingClientRect();return{preview:p.height,previewTop:p.top,timeline:t.height,timelineTop:t.top,toolbarBottom:b.bottom,pageY:scrollY,scrollHeight:document.documentElement.scrollHeight,left:document.querySelector('#timeline').scrollLeft,top:document.querySelector('#timeline').scrollTop};});
  async function dragBy(distance){const b=await divider.boundingBox(),x=b.x+b.width/2,y=b.y+b.height/2;
    await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let step=1;step<=6;step++)await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+distance*step/6}]});
    await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }
  const baseline=await measure();const handle=await divider.boundingBox(),preview=await page.locator('.viewer-panel').boundingBox();assert(Math.abs(handle.y+handle.height/2-preview.y-preview.height)<2,'the handle is on the preview/editor boundary');assert.equal(await page.locator('.timeline-clip').first().evaluate(e=>e.getBoundingClientRect().height),44,'compact clips keep a 44px touch height');
  await page.locator('#timeline').evaluate(e=>e.scrollLeft=140);const before=await measure();
  await dragBy(140);const enlarged=await measure();
  assert(enlarged.preview>before.preview+40,'real touch expands the already-larger preview up to the safe edit-space limit');
  const expansion=enlarged.preview-before.preview;
  assert(Math.abs(enlarged.timelineTop-before.timelineTop-expansion)<2);assert(Math.abs(before.timeline-enlarged.timeline-expansion)<2);
  assert.equal(enlarged.previewTop,before.previewTop);assert.equal(enlarged.toolbarBottom,before.toolbarBottom);assert.equal(enlarged.pageY,0);assert.equal(enlarged.left,before.left);
  await dragBy(-100);const reduced=await measure();
  assert(reduced.preview<enlarged.preview-90);assert(reduced.timelineTop<enlarged.timelineTop-90,'shrinking moves the boundary upward, not the editor offscreen');
  assert.equal(reduced.toolbarBottom,enlarged.toolbarBottom);assert.equal(reduced.scrollHeight,744);
  const cancelBox=await divider.boundingBox(),cancelX=cancelBox.x+cancelBox.width/2,cancelY=cancelBox.y+cancelBox.height/2;
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:cancelX,y:cancelY}]});
  await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:cancelX,y:cancelY+60}]});
  assert((await measure()).preview>reduced.preview+40);
  await client.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  assert.equal((await measure()).preview,reduced.preview,'a cancelled drag restores the prior height');
  await page.locator('#timeline').evaluate(e=>e.scrollLeft=0);await page.locator('.timeline-clip').first().tap();
  assert.equal((await measure()).preview,reduced.preview,'selection retains the chosen preview size');
  await page.locator('#togglePreviewBtn').tap();assert((await measure()).timelineTop<reduced.timelineTop);
  await page.locator('#togglePreviewBtn').tap();assert.equal((await measure()).preview,reduced.preview,'collapse restores the selected preview size');
  await dragBy(2000);assert((await measure()).timeline>=80,'resizing keeps an editable timeline on a short phone');
  await divider.focus();await page.keyboard.press('Home');assert.equal((await measure()).preview,baseline.preview,'Home resets the mobile layout');
  await page.locator('#timeline').evaluate(e=>e.scrollLeft=0);await page.screenshot({path:'test-results/taskforce-editor-mobile.png'});
  await dragBy(135);await page.screenshot({path:'test-results/taskforce-preview-expanded.png'});
  await page.setViewportSize({width:320,height:568});const small=await measure();assert(small.timeline>=70);assert.equal(small.scrollHeight,568);assert.equal(small.pageY,0);
  await page.setViewportSize({width:844,height:390});await divider.focus();await page.keyboard.press('Home');assert.equal(await divider.getAttribute('aria-valuenow'),'43','desktop percentage control is retained');
  await page.setViewportSize({width:390,height:744});assert.equal(await divider.isVisible(),true);
  assert.deepEqual(errors,[]);
  console.log('Mobile resize: real touch expansion/upward shrink, fixed toolbar, retained scroll and chosen size, collapse restoration, compact 44px clips, min editing space, keyboard reset and viewport changes passed.');
}finally{await browser.close();}
