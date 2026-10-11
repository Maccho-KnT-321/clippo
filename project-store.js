const DB='clippo-project-recovery';
const QUOTA_MESSAGE='この端末の空き容量が不足しています。前回の自動保存は残しています。「保存」で素材込みのバックアップを作り、端末の空き容量を増やしてから再試行してください';

function quotaError(cause){
  const error=new Error(QUOTA_MESSAGE,{cause});error.code='RECOVERY_QUOTA';return error;
}
function conflictError(){
  const error=new Error('別のタブで編集が保存されています。上書きを避けるため自動保存を停止しました');error.code='RECOVERY_CONFLICT';return error;
}
function storageError(error){return error?.name==='QuotaExceededError'?quotaError(error):error||new Error('端末保存に失敗しました');}

async function database(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB,1);let expired=false;
    const timer=setTimeout(()=>{expired=true;reject(new Error('端末保存の準備がタイムアウトしました'));},5000);
    request.onupgradeneeded=()=>{request.result.createObjectStore('snapshot');request.result.createObjectStore('files',{keyPath:'id'});};
    request.onsuccess=()=>{clearTimeout(timer);if(expired)request.result.close();else resolve(request.result);};
    request.onerror=()=>{clearTimeout(timer);reject(request.error);};
  });
}

function readStored(db){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(['snapshot','files'],'readonly'),snapshot=tx.objectStore('snapshot').get('latest'),files=tx.objectStore('files').getAll();
    tx.oncomplete=()=>resolve({snapshot:snapshot.result??null,files:files.result});
    tx.onabort=()=>reject(tx.error||new Error('端末保存を読み取れませんでした'));
  });
}

// Quotas are browser estimates, not a promise of permanent storage. Some
// Safari/private contexts do not expose a usable estimate; the atomic write
// still works there and its actual result is authoritative.
async function storageEstimate(){
  if(typeof globalThis.navigator?.storage?.estimate!=='function')return null;
  let timer;
  try{
    const estimate=await Promise.race([
      navigator.storage.estimate(),
      new Promise(resolve=>{timer=setTimeout(()=>resolve(null),1500);})
    ]);
    return Number.isFinite(estimate?.quota)&&estimate.quota>0&&Number.isFinite(estimate.usage)&&estimate.usage>=0?estimate:null;
  }catch{return null;}finally{clearTimeout(timer);}
}

function sameFile(a,b){
  // Asset ids identify immutable source files. Metadata also catches a source
  // replacement with a reused id without hashing/reading every video on edit.
  return a?.size===b.size&&a?.type===b.type&&a?.name===b.name&&a?.lastModified===b.lastModified;
}

export async function loadRecovery(){
  const db=await database();
  try{const {snapshot,files}=await readStored(db);return snapshot?{...snapshot,assets:files}:null;}finally{db.close();}
}

export async function saveRecovery(project,assets,expectedRevision=null){
  const referenced=new Set([...(project.clips||[]),...(project.music||[])].map(item=>item.assetId));
  const files=[...referenced].map(id=>{
    const asset=assets.get(id);
    if(!(asset?.file instanceof Blob))throw new Error('保存する素材ファイルが見つかりません');
    return {id,file:asset.file};
  });
  const snapshot={version:1,project:structuredClone(project),revision:crypto.randomUUID(),savedAt:Date.now()};
  const db=await database();
  try{
    const previous=await readStored(db);
    if((previous.snapshot?.revision??null)!==expectedRevision)throw conflictError();
    const existing=new Map(previous.files.map(file=>[file.id,file.file]));
    const changed=files.filter(file=>!sameFile(existing.get(file.id),file.file));
    const incomingBytes=changed.reduce((sum,asset)=>sum+asset.file.size,0);
    // Reserve room for the new sources and metadata while keeping the old
    // snapshot recoverable. Do not count deleting old sources as free space.
    // An edit to existing sources does not need a second copy of those videos.
    if(incomingBytes){
      const estimate=await storageEstimate();
      const required=incomingBytes+Math.ceil(incomingBytes*.02)+new Blob([JSON.stringify(snapshot)]).size+64*1024;
      if(estimate&&estimate.quota-estimate.usage<required)throw quotaError();
    }
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(['snapshot','files'],'readwrite'),store=tx.objectStore('snapshot'),media=tx.objectStore('files');let failure;
      const abort=error=>{failure=storageError(error);try{tx.abort();}catch{/* The transaction may already be aborting. */}};
      const current=store.get('latest');
      current.onsuccess=()=>{
        if((current.result?.revision??null)!==expectedRevision){abort(conflictError());return;}
        try{
          for(const record of previous.files)if(!referenced.has(record.id))media.delete(record.id);
          for(const file of changed)media.put(file);
          store.put(snapshot,'latest');
        }catch(error){
          // Synchronous clone/quota failures must abort too: otherwise earlier
          // deletions could commit without the new snapshot or source files.
          abort(error);
        }
      };
      tx.onerror=event=>{if(!failure)failure=storageError(tx.error||event.target?.error);};
      tx.onabort=()=>reject(failure||storageError(tx.error));
      tx.oncomplete=()=>resolve(snapshot);
    });
  }finally{db.close();}
}
