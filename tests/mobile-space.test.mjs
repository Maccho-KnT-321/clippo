import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:390,height:667},isMobile:true,hasTouch:true});await page.goto('http://127.0.0.1:4173');
  await page.locator('#welcomeDemo').click();await page.locator('.timeline-clip').nth(2).waitFor();
  for(const height of [667,744,844]){
    await page.setViewportSize({width:390,height});
    const sizes=await page.evaluate(()=>{const t=document.getElementById('timeline').getBoundingClientRect(),b=document.getElementById('mobileEditorToolbar').getBoundingClientRect(),p=document.querySelector('.viewer-panel').getBoundingClientRect();return {timeline:t.height,toolbar:b.height,preview:p.height,scroll:document.documentElement.scrollHeight,width:document.documentElement.scrollWidth};});
    assert(sizes.timeline>=height*.4,JSON.stringify(sizes));assert(sizes.toolbar<=60);assert(sizes.preview<=221);assert(sizes.scroll<=height);assert(sizes.width<=390);
  }
  await page.setViewportSize({width:390,height:667});const before=await page.locator('#timeline').evaluate(e=>e.clientHeight);
  await page.locator('#togglePreviewBtn').tap();assert(await page.locator('#timeline').evaluate(e=>e.clientHeight)>before+50);
  await page.locator('#togglePreviewBtn').tap();
  await page.locator('#moreActionsBtn').tap();await page.locator('#addTextBtn').tap();await page.locator('.text-clip').waitFor();assert.equal(await page.locator('#mobileToolsDialog').isVisible(),false);
  assert.equal(await page.locator('.mobile-nav').isVisible(),false);
  await page.locator('#moreActionsBtn').tap();await page.locator('#snapBtn').tap();assert.equal(await page.locator('#snapBtn').getAttribute('aria-pressed'),'false');await page.getByRole('button',{name:'編集ツールを閉じる'}).tap();
  await page.screenshot({path:'test-results/mobile-space.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});await page.locator('.timeline-toolbar #splitBtn').waitFor();assert.equal(await page.locator('.precision-tools #snapBtn').count(),1);
  await page.setViewportSize({width:390,height:667});await page.locator('#mobileEditorToolbar #splitBtn').waitFor();
  console.log('Mobile: single-row toolbar, timeline >=40% at 667/744/844px, preview collapse, tools and desktop restoration passed.');
}finally{await browser.close();}
