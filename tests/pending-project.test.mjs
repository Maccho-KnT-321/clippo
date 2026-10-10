import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(process.env.CLIPPO_URL||'http://127.0.0.1:4173');
  await page.locator('#welcomeDemo').click();
  await page.waitForFunction(()=>document.getElementById('saveProjectBtn').dataset.recovery==='saved');
  const backup=await page.evaluate(async()=>{
    const {loadRecovery}=await import('./project-store.js'),saved=await loadRecovery(),assets=[];
    for(const asset of saved.assets){
      const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(asset.file);});
      assets.push({id:asset.id,name:asset.file.name,type:asset.file.type,data});
    }
    return {revision:saved.revision,json:JSON.stringify({format:'clippo',version:2,project:{...saved.project,name:'開き直した作品'},assets})};
  });
  await page.reload();await page.locator('#recoveryNotice').waitFor();
  await page.locator('#projectInput').setInputFiles({name:'broken.clippo',mimeType:'application/json',buffer:Buffer.from('{broken')});
  await page.waitForFunction(()=>document.getElementById('toast').textContent.startsWith('開けませんでした'));
  assert(await page.locator('#recoveryNotice').isVisible(),'failed backup import retains the recovery choice');
  assert.equal(await page.evaluate(async()=>{const {loadRecovery}=await import('./project-store.js');return (await loadRecovery()).revision;}),backup.revision,'failed import preserves the original saved bytes and revision');
  await page.locator('#projectInput').setInputFiles({name:'review.clippo',mimeType:'application/json',buffer:Buffer.from(backup.json)});
  await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('プロジェクトを開きました'));
  assert.equal(await page.locator('#recoveryNotice').isVisible(),false,'successfully opened backup becomes the chosen project');
  await page.locator('#addTextBtn').click();
  await page.waitForFunction(()=>document.getElementById('saveProjectBtn').dataset.recovery==='saved');
  const updated=await page.evaluate(async()=>{const {loadRecovery}=await import('./project-store.js');const saved=await loadRecovery();return {name:saved.project.name,texts:saved.project.texts.length,revision:saved.revision};});
  assert.equal(updated.name,'開き直した作品');assert.equal(updated.texts,1);assert.notEqual(updated.revision,backup.revision);
  await page.reload();await page.locator('#restoreRecoveryBtn').click();await page.locator('.text-clip').waitFor();
  assert.equal(await page.locator('#projectName').inputValue(),'開き直した作品','new project and subsequent edits restore after reload');

  // Delay one image decode to keep the async template operation pending long
  // enough to test close/cancel/edit protections without timing-dependent waits.
  await page.locator('.template-launch').first().click();
  await page.locator('#templateDialog').waitFor();
  await page.locator('#templateMusic').selectOption('none');
  const source=JSON.parse(backup.json).assets[0];
  await page.locator('#templateFiles').setInputFiles({name:'template.png',mimeType:'image/png',buffer:Buffer.from(source.data.split(';base64,')[1],'base64')});
  await page.evaluate(()=>{
    const descriptor=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
    window.holdNextTemplateImage=true;
    Object.defineProperty(HTMLImageElement.prototype,'src',{...descriptor,set(value){
      if(window.holdNextTemplateImage&&String(value).startsWith('blob:')){
        window.holdNextTemplateImage=false;window.templateDecodeBlocked=true;
        window.releaseTemplateDecode=()=>{Object.defineProperty(HTMLImageElement.prototype,'src',descriptor);descriptor.set.call(this,value);};
      }else descriptor.set.call(this,value);
    }});
  });
  await page.locator('#applyTemplateBtn').click();
  await page.waitForFunction(()=>window.templateDecodeBlocked);
  assert(await page.locator('#templateDialog .dialog-close').isDisabled(),'cannot dismiss an operation that will later replace the timeline');
  assert(await page.locator('#templateTitle').isDisabled(),'pending template options cannot change under the operation');
  const textCount=await page.locator('.text-clip').count();
  const cancellation=await page.evaluate(()=>{document.getElementById('addTextBtn').click();const event=new Event('cancel',{cancelable:true});document.getElementById('templateDialog').dispatchEvent(event);return event.defaultPrevented;});
  assert(cancellation,'Escape/cancel is prevented while template preparation is pending');
  assert.equal(await page.locator('.text-clip').count(),textCount,'editor changes are locked during pending replacement');
  await page.keyboard.press('Escape');assert(await page.locator('#templateDialog').isVisible());
  await page.evaluate(()=>window.releaseTemplateDecode());
  await page.locator('#templateDialog').waitFor({state:'hidden'});
  assert.equal(await page.locator('.track[data-kind=clips] .timeline-clip').count(),1,'template commits once after decoding');
  await page.locator('#undoBtn').click();
  assert.equal(await page.locator('.track[data-kind=clips] .timeline-clip').count(),3,'whole template application remains one undoable change');
  assert.equal(await page.locator('.text-clip').count(),1,'undo retains the pre-template edit');

  await page.locator('.template-launch').first().click();
  await page.locator('#templateFiles').setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('not an image')});
  await page.locator('#applyTemplateBtn').click();
  await page.waitForFunction(()=>document.getElementById('templateStatus').textContent.includes('読み込めません'));
  assert(await page.locator('#templateDialog .dialog-close').isEnabled(),'failure unlocks the dialog');
  await page.locator('#templateDialog .dialog-close').click();
  await page.locator('#addTextBtn').click();
  assert.equal(await page.locator('.text-clip').count(),2,'failure releases the editor lock');
  assert.deepEqual(errors,[]);
  console.log('Pending projects: failed backup preserves recovery, successful import resumes autosave, pending template prevents cancellation and edits, undo and failure recovery passed.');
}finally{await browser.close();}
