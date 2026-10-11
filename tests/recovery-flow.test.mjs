import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const browser=await chromium.launch({channel:'chrome',headless:true});
const url=(process.env.CLIPPO_URL||'http://127.0.0.1:4173').replace(/\/$/,'');
const errors=[];

async function pageWithStoreHooks(){
  // Each browser.newPage() has its own fresh context and IndexedDB. Instrument
  // only that page's fetched module: the production source is not modified.
  const page=await browser.newPage({viewport:{width:390,height:744},isMobile:true,hasTouch:true});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/project-store.js*',async route=>{
    const response=await route.fetch(),source=await response.text();
    const signature='export async function saveRecovery(project,assets,expectedRevision=null){';
    assert(source.includes(signature),'the served persistence module exposes the expected save entry point');
    const body=source.replace(signature,signature+`
      if(globalThis.__failSave)throw new Error('forced storage failure');
      if(globalThis.__saveDelay){
        globalThis.__saveStarted=true;
        await new Promise(resolve=>setTimeout(resolve,globalThis.__saveDelay));
      }
    `);
    await route.fulfill({response,body});
  });
  await page.goto(url);
  await page.locator('#welcomeDemo').tap();
  await page.locator('.track[data-kind=clips] .timeline-clip').first().tap();
  await page.locator('.mobile-context-actions [data-dock-group=filters]').tap();
  await waitSaved(page);
  return page;
}

async function waitSaved(page){
  await page.waitForFunction(()=>document.getElementById('saveProjectBtn').dataset.recovery==='saved');
}
async function saved(page){
  return page.evaluate(async()=>{
    const {loadRecovery}=await import('./project-store.js');
    const snapshot=await loadRecovery();
    return {revision:snapshot.revision,project:snapshot.project};
  });
}
const recoveryState=page=>page.locator('#saveProjectBtn').getAttribute('data-recovery');

try{
  // Returning to the persisted values before the debounce expires is already
  // saved. It must cancel the pending timer, not remain "pending" forever or
  // perform a redundant transaction that changes the recovery revision.
  const quick=await pageWithStoreHooks(),quickBefore=await saved(quick);
  await quick.evaluate(async()=>{
    for(const id of ['vivid','cinema','mono','standard']){
      document.querySelector(`[data-color-look=${id}]`).click();
      await new Promise(resolve=>setTimeout(resolve,20));
    }
  });
  await waitSaved(quick);
  assert.deepEqual(await saved(quick),quickBefore,'a quick revert preserves the persisted revision and project');
  await quick.waitForTimeout(850); // Beyond the editor's 700 ms save debounce.
  assert.equal(await recoveryState(quick),'saved');
  assert.deepEqual(await saved(quick),quickBefore,'the cancelled save timer does not rewrite unchanged content');
  await quick.close();

  // An old snapshot still matches during an in-flight write, but that write
  // will soon replace it. Reverting at this point must remain pending and
  // persist the reverted values after the original write completes.
  const race=await pageWithStoreHooks(),raceBefore=await saved(race);
  await race.evaluate(()=>globalThis.__saveDelay=1700);
  await race.locator('[data-color-look=vivid]').tap();
  await race.waitForFunction(()=>globalThis.__saveStarted&&document.getElementById('saveProjectBtn').dataset.recovery==='saving');
  await race.locator('[data-color-look=standard]').tap();
  assert.equal(await recoveryState(race),'pending','a running write prevents a false already-saved state');
  assert.equal((await saved(race)).revision,raceBefore.revision,'the delayed write has not committed yet');
  await race.evaluate(()=>globalThis.__saveDelay=0);
  await waitSaved(race);
  const raceAfter=await saved(race);
  assert.deepEqual(raceAfter.project,raceBefore.project,'the final persisted state is the revert, not the in-flight look');
  assert.notEqual(raceAfter.revision,raceBefore.revision,'the in-flight write was followed by a corrective save');
  await race.close();

  // Matching an earlier fingerprint cannot dismiss a known storage failure.
  const failure=await pageWithStoreHooks(),failureBefore=await saved(failure);
  await failure.evaluate(()=>globalThis.__failSave=true);
  await failure.locator('[data-color-look=vivid]').tap();
  await failure.waitForFunction(()=>document.getElementById('saveProjectBtn').dataset.recovery==='error');
  await failure.locator('[data-color-look=standard]').tap();
  assert.equal(await recoveryState(failure),'error');
  assert.match(await failure.locator('#recoveryStatus').textContent(),/forced storage failure/);
  assert.deepEqual(await saved(failure),failureBefore,'failed persistence never replaces the existing snapshot');
  await failure.close();

  // A competing tab's transaction makes our old fingerprint stale. Returning
  // to those local values must retain the conflict and preserve the other tab.
  const conflict=await pageWithStoreHooks();
  await conflict.evaluate(async()=>{
    const {loadRecovery,saveRecovery}=await import('./project-store.js');
    const snapshot=await loadRecovery();
    const assets=new Map(snapshot.assets.map(asset=>[asset.id,{file:asset.file}]));
    await saveRecovery({...snapshot.project,name:'another tab'},assets,snapshot.revision);
  });
  await conflict.locator('[data-color-look=vivid]').tap();
  await conflict.waitForFunction(()=>document.getElementById('saveProjectBtn').dataset.recovery==='error');
  await conflict.locator('[data-color-look=standard]').tap();
  assert.equal(await recoveryState(conflict),'error');
  assert.match(await conflict.locator('#recoveryStatus').textContent(),/別のタブ/);
  assert.equal((await saved(conflict)).project.name,'another tab','the competing saved project is not overwritten');
  await conflict.close();

  assert.deepEqual(errors,[]);
  console.log('Recovery flow: quick revert saved without a rewrite, in-flight revert persisted after the first write, storage failure and cross-tab conflict retained with saved snapshots protected.');
}finally{
  await browser.close();
}
