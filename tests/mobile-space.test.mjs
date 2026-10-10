import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:390,height:667},isMobile:true,hasTouch:true});await page.goto(process.env.CLIPPO_URL||'http://127.0.0.1:4173');
  await page.locator('#welcomeDemo').click();await page.locator('.timeline-clip').nth(2).waitFor();
  await page.locator('.mobile-context-actions [data-dock-group=volume]').tap();
  for(const [width,height] of [[320,568],[390,667],[390,744],[430,844]]){
    await page.setViewportSize({width,height});
    const sizes=await page.evaluate(()=>{const t=document.getElementById('timeline').getBoundingClientRect(),b=document.getElementById('mobileEditorToolbar').getBoundingClientRect(),p=document.querySelector('.viewer-panel').getBoundingClientRect(),d=document.querySelector('.inspector-panel').getBoundingClientRect();return {timeline:t.height,timelineTop:t.top,timelineBottom:t.bottom,toolbar:b.height,toolbarTop:b.top,toolbarBottom:b.bottom,preview:p.height,previewBottom:p.bottom,dockTop:d.top,dockBottom:d.bottom,scroll:document.documentElement.scrollHeight,width:document.documentElement.scrollWidth};});
    assert(sizes.timeline>=80,JSON.stringify(sizes));assert(sizes.toolbar<=70);assert(sizes.preview>=(height<=620?120:180));assert(sizes.previewBottom<=sizes.timelineTop+1);assert(sizes.timelineBottom<=sizes.dockTop+1);assert(sizes.dockBottom<=sizes.toolbarTop+1);assert(sizes.toolbarBottom<=height+1);assert(sizes.scroll<=height);assert(sizes.width<=width);
  }
  await page.setViewportSize({width:390,height:667});const before=await page.locator('#timeline').evaluate(e=>e.clientHeight);
  await page.locator('#mobileDockDone').tap();assert(await page.locator('#timeline').evaluate(e=>e.clientHeight)>before+50);
  await page.locator('.mobile-context-actions [data-dock-group=volume]').tap();
  await page.locator('#addTextBtn').tap();await page.locator('.text-clip').waitFor();assert.equal(await page.locator('#mobileToolsDialog').isVisible(),false);
  assert.equal(await page.locator('.mobile-nav').isVisible(),false);
  await page.locator('#moreActionsBtn').tap();await page.locator('#snapBtn').tap();assert.equal(await page.locator('#snapBtn').getAttribute('aria-pressed'),'false');await page.getByRole('button',{name:'編集ツールを閉じる'}).tap();
  await page.screenshot({path:'test-results/mobile-space.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});await page.locator('.timeline-toolbar #splitBtn').waitFor();assert.equal(await page.locator('.precision-tools #snapBtn').count(),1);
  await page.setViewportSize({width:390,height:667});await page.locator('#mobileEditorToolbar #splitBtn').waitFor();
  console.log('Mobile: large preview, non-overlapping inline dock, timeline >=80px at 320/390/430px, dock close/reopen, tools and desktop restoration passed.');
}finally{await browser.close();}
