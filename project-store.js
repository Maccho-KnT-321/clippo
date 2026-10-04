const DB='clippo-project-recovery';
export const recoveryLimit=150*1024*1024;
async function database(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB,1);let expired=false;
    const timer=setTimeout(()=>{expired=true;reject(new Error('端末保存の準備がタイムアウトしました'));},5000);
    request.onupgradeneeded=()=>{request.result.createObjectStore('snapshot');request.result.createObjectStore('files',{keyPath:'id'});};
    request.onsuccess=()=>{clearTimeout(timer);if(expired)request.result.close();else resolve(request.result);};
    request.onerror=()=>{clearTimeout(timer);reject(request.error);};
  });
}
export async function loadRecovery(){
  const db=await database();
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction(['snapshot','files'],'readonly'),snapshot=tx.objectStore('snapshot').get('latest'),files=tx.objectStore('files').getAll();
    tx.oncomplete=()=>resolve(snapshot.result?{...snapshot.result,assets:files.result}:null);
    tx.onabort=tx.onerror=()=>reject(tx.error||new Error('端末保存を読み取れませんでした'));
  });}finally{db.close();}
}
export async function saveRecovery(project,assets,expectedRevision=null){
  const referenced=new Set([...project.clips,...project.music].map(item=>item.assetId));
  const files=[...referenced].map(id=>{const asset=assets.get(id);if(!asset?.file)throw new Error('保存する素材が見つかりません');return {id,file:asset.file};});
  if(files.reduce((sum,a)=>sum+a.file.size,0)>recoveryLimit)throw new Error('自動保存は素材合計150MBまでです。使用する素材を減らすか、短い素材に分けてください');
  const snapshot={version:1,project:structuredClone(project),revision:crypto.randomUUID(),savedAt:Date.now()};
  const db=await database();
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction(['snapshot','files'],'readwrite'),store=tx.objectStore('snapshot'),media=tx.objectStore('files');let failure;
    const current=store.get('latest');
    current.onsuccess=()=>{
      if((current.result?.revision??null)!==expectedRevision){failure=new Error('別のタブで編集が保存されています。上書きを避けるため自動保存を停止しました');tx.abort();return;}
      const keys=media.getAllKeys();keys.onsuccess=()=>{
        const existing=new Set(keys.result);for(const key of existing)if(!referenced.has(key))media.delete(key);
        for(const file of files)if(!existing.has(file.id))media.put(file);
        store.put(snapshot,'latest');
      };
    };
    tx.oncomplete=()=>resolve(snapshot);
    tx.onabort=tx.onerror=()=>reject(failure||tx.error||new Error('端末保存に失敗しました'));
  });}finally{db.close();}
}
