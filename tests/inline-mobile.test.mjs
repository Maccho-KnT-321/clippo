import {chromium} from 'playwright';import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:390,height:667},isMobile:true,hasTouch:true});await page.goto(process.env.CLIPPO_URL||'http://127.0.0.1:4173');await page.locator('#welcomeDemo').tap();await page.locator('.timeline-clip').nth(2).waitFor();
  assert.equal(await page.locator('.mobile-nav').isVisible(),false);
  assert.equal(await page.locator('.timeline-panel .inspector-panel').count(),1);
  await page.locator('.timeline-clip').first().tap();
  await page.locator('.mobile-context-actions [data-dock-group=volume]').tap();
  const volume=page.getByRole('slider',{name:'音量（1 = 100%）'});await volume.waitFor();
  await volume.fill('1.5');await volume.dispatchEvent('input');await volume.dispatchEvent('change');
  assert.equal(await page.getByRole('slider',{name:'音量（1 = 100%）'}).inputValue(),'1.5');
  assert.match(await page.locator('#inspector .field[data-key=volume]').innerText(),/150%/);
  await page.locator('.mobile-context-actions [data-dock-group=speed]').tap();
  const speed=page.getByLabel('再生速度',{exact:true});await speed.fill('2');await speed.dispatchEvent('change');assert.equal(await page.getByLabel('再生速度',{exact:true}).inputValue(),'2');assert.equal(await page.locator('.mobile-context-actions [data-dock-group=speed]').getAttribute('aria-pressed'),'true','editing retains the active adjustment');assert.equal(await volume.isVisible(),false,'one adjustment is shown at a time');
  const before=await page.locator('#timeline').boundingBox(),panel=await page.locator('.inspector-panel').boundingBox();assert(panel.y+panel.height<=before.y||before.y+before.height<=panel.y,'inline settings do not cover the timeline');assert(before.height>=80);
  await page.locator('.timeline-clip').nth(1).tap();assert.equal(await page.getByLabel('再生速度',{exact:true}).inputValue(),'1','selection updates controls and retains the category');
  await page.locator('.mobile-context-actions [data-dock-group=volume]').tap();assert.equal(await page.getByRole('slider',{name:'音量（1 = 100%）'}).inputValue(),'1');
  await page.locator('#addTextBtn').tap();await page.locator('.mobile-context-actions [data-dock-group=text]').tap();await page.locator('#inspector textarea').fill('その場で編集');await page.locator('#inspector textarea').dispatchEvent('change');assert.match(await page.locator('.text-clip').innerText(),/その場で編集/);
  await page.screenshot({path:'test-results/inline-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});assert.equal(await page.locator('.workspace>.inspector-panel').count(),1);
  console.log('Inline mobile: no tabs, clip selection updates inline volume, 150% adjustment persists, text editing and timeline remain in one workspace.');
}finally{await browser.close();}
