import { projectDuration } from './timeline.js';
import { presetMusicInfo } from './music-library.js';

// A deterministic, local montage planner. No AI inference or network requests.
export function planAutoEdit(sources,{seconds=30,style='bright'}={}){
  if(!sources.length)throw new Error('動画・写真を選んでください。');
  const target=Number(seconds);if(!Number.isFinite(target)||target<5||target>120)throw new Error('長さは5〜120秒にしてください。');
  const valid=sources.filter(a=>a.type==='image'||a.type==='video'&&Number.isFinite(a.duration)&&a.duration>0);
  if(!valid.length)throw new Error('使用できる動画・写真がありません。');
  const soft=style==='calm',beat=60/(presetMusicInfo[style]||presetMusicInfo.bright).bpm,shot=beat*(soft?8:4);
  const slots=Math.max(valid.length,Math.ceil(target/shot));
  const picks=Array.from({length:Math.min(slots,60)},(_,i)=>valid[i%valid.length]);
  const make=length=>picks.map((a,i)=>{
    const available=a.type==='image'?120:a.duration,span=Math.min(available,length);
    // Spread repeated source excerpts across the recording rather than repeating its start.
    const occurrence=Math.floor(i/valid.length),count=Math.ceil((picks.length-(i%valid.length))/valid.length);
    const offset=a.type==='image'?0:(available-span)*(occurrence+1)/(count+1);
    return {assetId:a.id,in:offset,out:offset+span,speed:1,transition:{type:soft?'dissolve':'none',duration:.35}};
  });
  let low=0,high=120;
  for(let i=0;i<45;i++){const mid=(low+high)/2;if(projectDuration({clips:make(mid)})<target)low=mid;else high=mid;}
  const clips=make(high);
  return {clips,duration:projectDuration({clips}),target};
}
