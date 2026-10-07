import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage();
  for(const [width,height] of [[1907,866],[1440,900],[1024,768]]){
    await page.setViewportSize({width,height});await page.goto(process.env.CLIPPO_URL||'http://127.0.0.1:4173');
    const sizes=await page.evaluate(()=>({height:document.querySelector('#timeline').clientHeight,scroll:document.documentElement.scrollHeight}));
    assert(sizes.height>height*.32,JSON.stringify(sizes));assert(sizes.scroll<=height);
    const divider=page.locator('#workspaceDivider');const box=await divider.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+6);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y-80);await page.mouse.up();
    assert(await page.locator('#timeline').evaluate(e=>e.clientHeight)>sizes.height+60);
    await divider.focus();await page.keyboard.press('Home');
  }
  await page.screenshot({path:'test-results/workspace-height.png'});
  console.log('Desktop timeline fits viewport and divider expands editing space.');
}finally{await browser.close();}
