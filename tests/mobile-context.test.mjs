import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:390,height:667},isMobile:true,hasTouch:true});
  await page.goto(process.env.CLIPPO_URL||'http://127.0.0.1:4173');await page.locator('#welcomeDemo').tap();
  await page.locator('.mobile-context-actions [data-dock-group=speed]').tap();
  const field=await page.locator('#inspector .field[data-key=speed]').boundingBox(),panel=await page.locator('#inspector').boundingBox();
  assert(field.x>=panel.x-2&&field.x<panel.x+panel.width);
  assert.equal(await page.locator('#inspector .field[data-key=speed]').getAttribute('data-dock-visible'),'true');
  await page.locator('.mobile-context-actions [data-dock-group=volume]').tap();
  assert.equal(await page.getByLabel('再生速度',{exact:true}).isVisible(),false);
  assert.equal(await page.getByRole('slider',{name:'音量（1 = 100%）'}).isVisible(),true);
  await page.locator('#addTextBtn').tap();await page.locator('.mobile-context-actions [data-dock-group=text]').tap();
  assert(await page.locator('#inspector textarea').evaluate(e=>e===document.activeElement));
  assert.equal(await page.locator('#mobileToolsDialog').isVisible(),false);
  await page.screenshot({path:'test-results/mobile-context.png'});
  console.log('Context shortcuts: speed, volume and text in the same workspace.');
}finally{await browser.close();}
