import {projectDuration} from './timeline.js';

// Small, explicit finishing choices. These are local style and mix presets,
// not speech detection, loudness analysis, or generated content.
export const textLooks=Object.freeze([
  {id:'caption',name:'字幕',description:'下に読みやすく、背景つき',size:44,color:'#ffffff',position:'bottom',background:true},
  {id:'headline',name:'見出し',description:'中央に大きく、シンプルに',size:70,color:'#ffffff',position:'center',background:false},
  {id:'highlight',name:'強調',description:'中央にアクセントカラーで',size:56,color:'#d1f477',position:'center',background:true}
].map(look=>Object.freeze(look)));

export const soundMixes=Object.freeze([
  {id:'voice',name:'声を主役',description:'動画の音を残し、BGMは控えめに',clipVolume:1,musicVolume:.18},
  {id:'balanced',name:'バランス',description:'動画の音と音楽をほどよく',clipVolume:.75,musicVolume:.35},
  {id:'music',name:'音楽を主役',description:'BGMを前に、動画の音は小さく',clipVolume:.18,musicVolume:.7}
].map(mix=>Object.freeze(mix)));

const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function applyTextLook(item,id){
  const look=textLooks.find(value=>value.id===id);
  if(!look||!record(item))return false;
  for(const key of ['size','color','position','background'])item[key]=look[key];
  delete item.x;delete item.y;
  return true;
}

export function applySoundMix(project,id){
  const mix=soundMixes.find(value=>value.id===id);
  if(!mix||!record(project))return false;
  const clips=(Array.isArray(project.clips)?project.clips:[]).filter(record);
  const music=(Array.isArray(project.music)?project.music:[]).filter(record);
  for(const item of clips)item.volume=mix.clipVolume;
  for(const item of music){item.volume=mix.musicVolume;item.fadeIn=0;item.fadeOut=0;}
  const total=projectDuration({...project,clips});
  const spans=music.map(item=>({item,start:Number(item.start),length:Number(item.out)-Number(item.in)}))
    .filter(span=>Number.isFinite(span.start)&&span.start>=0&&span.start<total&&Number.isFinite(span.length)&&span.length>0);
  for(const span of spans){
    if(span.start+span.length>total){span.item.out=Number(span.item.in)+total-span.start;span.length=total-span.start;}
  }
  if(!spans.length)return true;
  const start=Math.min(...spans.map(span=>span.start)),end=Math.max(...spans.map(span=>span.start+span.length));
  // Only audible outer BGM boundaries are softened. Internal repeats are not
  // given a fade. Long music is trimmed to the video ending; source identity,
  // in-point and placement are retained, including music placed after the end.
  for(const span of spans){
    if(Math.abs(span.start-start)<.000001)span.item.fadeIn=Math.min(.25,span.length/2);
    if(Math.abs(span.start+span.length-end)<.000001)span.item.fadeOut=Math.min(.8,span.length/2);
  }
  return true;
}
