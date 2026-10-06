import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto('http://127.0.0.1:4173');await page.locator('#welcomeDemo').click();
  await page.locator('.timeline-clip').nth(2).waitFor();
  await page.locator('#moreActionsBtn').click();await page.getByRole('button',{name:'素材一覧',exact:true}).click();await page.locator('#renameProjectBtn').click();await page.locator('#renameInput').fill('家族の一日');await page.locator('#confirmRenameBtn').click();await page.getByRole('button',{name:'素材パネルを閉じる'}).click();
  await page.locator('#moreActionsBtn').click();await page.locator('#addTextBtn').click();
  await page.waitForFunction(()=>document.getElementById('saveProjectBtn').dataset.recovery==='saved');
  const saved=await page.evaluate(async()=>{const {loadRecovery}=await import('./project-store.js');const s=await loadRecovery();return {revision:s.revision,name:s.project.name,clips:s.project.clips.length,texts:s.project.texts.length,files:s.assets.length};});
  assert.equal(saved.name,'家族の一日');assert.equal(saved.clips,3);assert.equal(saved.texts,1);assert.equal(saved.files,3);
  await page.reload();await page.locator('#recoveryNotice').waitFor();
  assert.equal(await page.locator('.timeline-clip').count(),0,'no silent replacement on startup');
  const untouched=await page.evaluate(async()=>{const {loadRecovery}=await import('./project-store.js');return (await loadRecovery()).revision;});assert.equal(untouched,saved.revision);
  await page.locator('#restoreRecoveryBtn').click();await page.locator('.text-clip').waitFor();
  assert.equal(await page.locator('.timeline-clip:not(.text-clip)').count(),3);assert.equal(await page.locator('#projectName').inputValue(),'家族の一日');
  assert.equal(await page.locator('#recoveryNotice').isVisible(),false);
  // Compare-and-swap rejects another tab's stale revision and keeps the saved copy.
  const conflict=await page.evaluate(async()=>{
    const {loadRecovery,saveRecovery}=await import('./project-store.js'),before=await loadRecovery();let message='';
    const assets=new Map(before.assets.map(a=>[a.id,{file:a.file}]));
    try{await saveRecovery(before.project,assets,null);}catch(e){message=e.message;}
    return {message,same:(await loadRecovery()).revision===before.revision};
  });assert.match(conflict.message,/別のタブ/);assert(conflict.same);
  const oversized=await page.evaluate(async()=>{
    const {loadRecovery,saveRecovery,recoveryLimit}=await import('./project-store.js');const saved=await loadRecovery(),assets=new Map(saved.assets.map(a=>[a.id,{file:a.file}]));
    assets.set(saved.project.clips[0].assetId,{file:{size:recoveryLimit+1}});let message='';
    try{await saveRecovery(saved.project,assets,saved.revision);}catch(e){message=e.message;}
    return {message,same:(await loadRecovery()).revision===saved.revision};
  });assert.match(oversized.message,/150MB/);assert(oversized.same,'oversized save retains previous successful snapshot');
  const other=await context.newPage();other.on('dialog',d=>d.accept());await other.goto('http://127.0.0.1:4173');await other.locator('#recoveryNotice').waitFor();
  await other.locator('#startFreshBtn').click();await other.locator('#welcomeDemo').click();await other.waitForFunction(()=>document.getElementById('saveProjectBtn').dataset.recovery==='saved');
  await page.locator('#moreActionsBtn').click();await page.locator('#addTextBtn').click();await page.waitForFunction(()=>document.getElementById('saveProjectBtn').dataset.recovery==='error');
  assert.match(await page.locator('#recoveryStatus').textContent(),/別のタブ/);
  await page.screenshot({path:'test-results/product-recovery-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log('Recovery: source files and edits saved, reload restored, stale writes rejected, previous snapshot preserved, cross-tab conflict surfaced.');
}finally{await browser.close();}
