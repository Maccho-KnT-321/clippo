import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({isMobile:true,hasTouch:true});
  for(const width of [320,390,430]){
    await page.setViewportSize({width,height:744});await page.goto(process.env.CLIPPO_URL||'http://127.0.0.1:4173');
    await page.locator('#welcomeDemo').tap();await page.locator('.timeline-clip').nth(2).waitFor();
    const timeline=await page.locator('#timeline').boundingBox(),toolbar=await page.locator('#mobileEditorToolbar').boundingBox();
    assert(toolbar.y>=timeline.y+timeline.height,'tools sit below the timeline');
    for(const id of ['editorImportBtn','autoEditBtn','splitBtn','addTextBtn','addMusicBtn','deleteBtn','moreActionsBtn']){
      const box=await page.locator('#'+id).boundingBox();assert(box.x>=0&&box.x+box.width<=width+1,id);assert(box.width>=44&&box.height>=44);
    }
    assert(await page.locator('.mobile-history-controls #undoBtn').isVisible());
    await page.locator('#autoEditBtn').tap();assert(await page.locator('#autoEditDialog').isVisible());
    await page.locator('#autoEditDialog .dialog-close').tap();
    await page.locator('#deleteBtn').tap();assert.equal(await page.locator('.timeline-clip').count(),2);
    await page.locator('#undoBtn').tap();assert.equal(await page.locator('.timeline-clip').count(),3);
    await page.locator('#redoBtn').tap();assert.equal(await page.locator('.timeline-clip').count(),2);
  }
  await page.screenshot({path:'test-results/mobile-direct.png',fullPage:true});
  console.log('Mobile direct: 320/390/430px, thumb toolbar, one-tap auto edit, delete, undo and redo passed.');
}finally{await browser.close();}
