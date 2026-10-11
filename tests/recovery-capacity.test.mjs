import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const browser=await chromium.launch({channel:'chrome',headless:true});
const url=(process.env.CLIPPO_URL||'http://127.0.0.1:4173').replace(/\/$/,'');
try{
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);
  const large=await page.evaluate(async()=>{
    const {saveRecovery,loadRecovery}=await import('./project-store.js');
    const MiB=1024*1024,chunk=new Uint8Array(MiB);chunk[0]=73;chunk[chunk.length-1]=29;
    const file=new File(Array.from({length:160},()=>chunk),'iPhone-original.mov',{type:'video/quicktime',lastModified:1700000000000});
    const originalEstimate=navigator.storage.estimate;
    const assets=new Map([['small',{file:new File([new Uint8Array([1,2,3])],'first.mov',{type:'video/quicktime'})}],['large',{file}]]);
    const edit={version:2,name:'First',clips:[{id:'c1',assetId:'small',in:0,out:10}],music:[],texts:[]};
    let first,code,message;
    try{
      navigator.storage.estimate=async()=>({quota:512*MiB,usage:0});
      first=await saveRecovery(edit,assets,null);
      const next={...edit,name:'160 MB source',clips:[{id:'c1',assetId:'large',in:0,out:10},{id:'c2',assetId:'large',in:10,out:20}]};
      navigator.storage.estimate=async()=>({quota:10*MiB,usage:9*MiB});
      try{await saveRecovery(next,assets,first.revision);}catch(error){code=error.code;message=error.message;}
      const preserved=await loadRecovery();
      const oldBytes=[...new Uint8Array(await preserved.assets[0].file.arrayBuffer())];
      navigator.storage.estimate=async()=>({quota:512*MiB,usage:1*MiB});
      const saved=await saveRecovery(next,assets,first.revision),loaded=await loadRecovery();
      const restored=loaded.assets[0].file;
      // No File/base64 conversion occurs: unchanged source ids are not written
      // again on every volume/trim/name change, even at the storage limit.
      const originalPut=IDBObjectStore.prototype.put;let writes=0,estimates=0;
      IDBObjectStore.prototype.put=function(...args){if(this.name==='files')writes++;return originalPut.apply(this,args);};
      navigator.storage.estimate=async()=>{estimates++;return {quota:160*MiB,usage:160*MiB};};
      let updated;
      try{updated=await saveRecovery({...next,name:'Trim changed'},assets,saved.revision);}
      finally{IDBObjectStore.prototype.put=originalPut;}
      return {
        code,message,previousRevision:preserved.revision===first.revision,oldBytes,
        count:loaded.assets.length,size:restored.size,name:restored.name,clips:loaded.project.clips.length,
        first:[...new Uint8Array(await restored.slice(0,1).arrayBuffer())],
        last:[...new Uint8Array(await restored.slice(-1).arrayBuffer())],
        writes,estimates,updated:updated.revision!==saved.revision
      };
    }finally{navigator.storage.estimate=originalEstimate;}
  });
  assert.equal(large.code,'RECOVERY_QUOTA');assert.match(large.message,/前回の自動保存は残しています/);
  assert(large.previousRevision);assert.deepEqual(large.oldBytes,[1,2,3]);
  assert.equal(large.size,160*1024*1024,'a real Blob above the old 150 MB cap is persisted');
  assert.equal(large.count,1,'repeated clips do not duplicate their source file');assert.equal(large.clips,2);
  assert.equal(large.name,'iPhone-original.mov');assert.deepEqual(large.first,[73]);assert.deepEqual(large.last,[29]);
  assert.equal(large.writes,0);assert.equal(large.estimates,0);assert(large.updated);

  const rollback=await page.evaluate(async()=>{
    const {loadRecovery,saveRecovery}=await import('./project-store.js');
    const before=await loadRecovery(),assets=new Map([['replacement',{file:new File(['new media bytes'],'replacement.mov',{type:'video/quicktime'})}]]);
    const next={...before.project,name:'Must not commit',clips:[{id:'new-clip',assetId:'replacement',in:0,out:3}]};
    const originalEstimate=navigator.storage.estimate,originalPut=IDBObjectStore.prototype.put;
    navigator.storage.estimate=async()=>{throw new Error('estimate unavailable');};
    let quotaCode='',cloneName='',requestCode='';
    try{
      // Synchronous failures after old-source deletions must roll everything
      // back, not leave the snapshot referring to missing source files.
      IDBObjectStore.prototype.put=function(...args){if(this.name==='files')throw new DOMException('quota full','QuotaExceededError');return originalPut.apply(this,args);};
      try{await saveRecovery(next,assets,before.revision);}catch(error){quotaCode=error.code;}
      const afterQuota=await loadRecovery();
      IDBObjectStore.prototype.put=function(...args){if(this.name==='snapshot')throw new DOMException('clone failed','DataCloneError');return originalPut.apply(this,args);};
      try{await saveRecovery(next,assets,before.revision);}catch(error){cloneName=error.name;}
      const afterClone=await loadRecovery();
      // An asynchronous request failure also aborts the same transaction.
      IDBObjectStore.prototype.put=function(...args){
        if(this.name==='files'){const request=this.add(args[0]);this.add(args[0]);return request;} // second add fails asynchronously
        return originalPut.apply(this,args);
      };
      try{await saveRecovery(next,assets,before.revision);}catch(error){requestCode=error.name;}
      const afterRequest=await loadRecovery();
      IDBObjectStore.prototype.put=originalPut;
      const fallback=await saveRecovery(next,assets,before.revision),loaded=await loadRecovery();
      return {
        quotaCode,cloneName,requestCode,
        preserved:[afterQuota,afterClone,afterRequest].every(snapshot=>snapshot.revision===before.revision&&snapshot.assets.length===1&&snapshot.assets[0].file.size===160*1024*1024),
        fallback:loaded.revision===fallback.revision&&loaded.project.name==='Must not commit'&&loaded.assets[0].id==='replacement',
        bytes:await loaded.assets[0].file.text()
      };
    }finally{navigator.storage.estimate=originalEstimate;IDBObjectStore.prototype.put=originalPut;}
  });
  assert.equal(rollback.quotaCode,'RECOVERY_QUOTA');assert.equal(rollback.cloneName,'DataCloneError');assert.equal(rollback.requestCode,'ConstraintError');
  assert(rollback.preserved,'all failed transaction stages retain previous project and large source');
  assert(rollback.fallback,'unavailable capacity estimates fall back to a real atomic storage write');assert.equal(rollback.bytes,'new media bytes');
  assert.deepEqual(errors,[]);
  console.log('Recovery capacity: 160 MB source round-tripped; sources deduplicated and not rewritten on edits; quota/clone failures retain prior bytes; missing estimates safely fall back.');
}finally{await browser.close();}
