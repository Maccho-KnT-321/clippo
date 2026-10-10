import { addLoopVoice, encodeLoopWav } from './beat-maker.js';

export const presetMusicInfo=Object.freeze({
  bright:Object.freeze({name:'軽やかな一歩',bpm:110,bars:8,description:'明るいハイライト・おでかけ'}),
  calm:Object.freeze({name:'静かな午後',bpm:90,bars:8,description:'日記・思い出・落ち着いた場面'})
});

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
  const info=presetMusicInfo[style]||presetMusicInfo.bright,soft=style==='calm';
  const rate=22050,beat=60/info.bpm,seconds=beat*4*info.bars,samples=new Float32Array(Math.round(seconds*rate));
  // Two passes through an original four-chord phrase. Every instrument is
  // synthesized locally, with no recordings or third-party sample material.
  const chords=[[261.63,329.63,392],[220,261.63,329.63],[174.61,220,261.63],[196,246.94,293.66]];
  const voice=(start,length,fn)=>addLoopVoice(samples,start,length,rate,t=>fn(t)*Math.min(1,t/.006,(length-t)/.04));
  let seed=8713;const noise=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2147483648-1;};
  for(let bar=0;bar<info.bars;bar++){
    const chord=chords[bar%4],at=bar*4*beat,variation=bar>=4?1:0;
    for(let pulse=0;pulse<4;pulse++){
      const start=at+pulse*beat,bass=chord[0]/2;
      voice(start,beat*.95,t=>(Math.sin(2*Math.PI*bass*t)+.12*Math.sin(4*Math.PI*bass*t))*.13*Math.exp(-t*3));
      if(soft){
        const f=chord[(pulse+variation)%3];
        voice(start,1.5,t=>(Math.sin(2*Math.PI*f*t)+.16*Math.sin(4*Math.PI*f*t))*.15*Math.exp(-t*3.2));
      }else{
        if(pulse===0||pulse===2)voice(start,.22,t=>Math.sin(2*Math.PI*(48*t+5*(1-Math.exp(-t*35))))*.22*Math.exp(-t*22));
        if(pulse===1||pulse===3)voice(start,.14,t=>noise()*.1*Math.exp(-t*35));
        for(let half=0;half<2;half++){
          const f=chord[(pulse+half+variation)%3]*(pulse===3&&variation?2:1);
          voice(start+half*beat/2,.55,t=>(Math.sin(2*Math.PI*f*t)+.18*Math.sin(4*Math.PI*f*t))*.14*Math.exp(-t*8));
          voice(start+half*beat/2,.055,t=>noise()*.035*Math.exp(-t*70));
        }
      }
    }
  }
  return encodeLoopWav(samples,rate,info.name+'.wav',0);
}
