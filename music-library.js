const DB='clippo-local-music';
async function database(){return new Promise((resolve,reject)=>{const request=indexedDB.open(DB,1);request.onupgradeneeded=()=>request.result.createObjectStore('tracks',{keyPath:'key'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
export async function musicStore(action,file){
  const db=await database();
  try{return await new Promise((resolve,reject)=>{
    const transaction=db.transaction('tracks',action==='list'?'readonly':'readwrite'),store=transaction.objectStore('tracks');
    const key=file&&`${file.name}:${file.size}:${file.lastModified}`;
    const request=action==='list'?store.getAll():action==='remove'?store.delete(file.key):store.put({key,file,name:file.name});
    transaction.oncomplete=()=>resolve(request.result);transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);
  });}finally{db.close();}
}

// Original synthesized instrumental loops. No downloaded recordings or third-party samples.
export function makePresetMusic(style='bright'){
  const rate=22050,seconds=24,n=rate*seconds,buffer=new ArrayBuffer(44+n*2),view=new DataView(buffer);
  const str=(s,o)=>{for(let i=0;i<s.length;i++)view.setUint8(o+i,s.charCodeAt(i));};
  str('RIFF',0);view.setUint32(4,36+n*2,true);str('WAVEfmt ',8);view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);str('data',36);view.setUint32(40,n*2,true);
  const notes=style==='calm'?[261.63,329.63,392,329.63,220,261.63,329.63,392]:[261.63,329.63,392,523.25,440,392,329.63,293.66];
  const beat=style==='calm'?.75:.5;
  for(let i=0;i<n;i++){
    const t=i/rate,step=Math.floor(t/beat),phase=t%beat,f=notes[step%notes.length];
    const envelope=Math.min(1,phase/.015)*Math.exp(-phase*(style==='calm'?3:7));
    const melody=(Math.sin(2*Math.PI*f*t)+.22*Math.sin(4*Math.PI*f*t))*.15*envelope;
    const bass=Math.sin(2*Math.PI*(step%8<4?130.815:110)*t)*.065;
    const kick=style==='calm'?0:Math.sin(2*Math.PI*65*phase)*Math.exp(-phase*24)*.12;
    const edge=Math.min(1,t/.05,(seconds-t)/.15);
    view.setInt16(44+i*2,Math.max(-1,Math.min(1,(melody+bass+kick)*edge))*32767,true);
  }
  return new File([buffer],style==='calm'?'静かな午後.wav':'軽やかな一歩.wav',{type:'audio/wav',lastModified:0});
}
