export const beatTracks=[['kick','ドラム'],['snare','手拍子'],['hat','ハイハット'],['bass','ベース']];
export const beatPresets={
  pop:[[0,4,8,12],[4,12],[0,2,4,6,8,10,12,14],[0,6,8,14]],
  chill:[[0,8],[4,12],[2,6,10,14],[0,8]],
  dance:[[0,4,8,12],[4,12],[2,6,10,14],[0,3,6,8,11,14]]
};
export function beatPattern(name){return beatPresets[name].map(steps=>Array.from({length:16},(_,i)=>steps.includes(i)));}
export function renderBeat(pattern,bpm=110,bars=8){
  const rate=22050,step=60/bpm/4,n=Math.round(step*16*bars*rate),samples=new Float32Array(n);
  let seed=12345;const noise=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2147483648-1;};
  for(let bar=0;bar<bars;bar++)for(let lane=0;lane<4;lane++)for(let pos=0;pos<16;pos++){
    if(!pattern[lane][pos])continue;
    const start=Math.round((bar*16+pos)*step*rate),length=lane===3?.28:lane===2?.07:.18;
    const bass=[130.81,130.81,110,98][bar%4];
    for(let j=0;j<Math.round(length*rate)&&start+j<n;j++){
      const t=j/rate,attack=Math.min(1,t/.003);let value;
      if(lane===0)value=Math.sin(2*Math.PI*(48*t+7*(1-Math.exp(-t*30))))*Math.exp(-t*23)*.48;
      else if(lane===1)value=(noise()*.6+Math.sin(2*Math.PI*185*t)*.2)*Math.exp(-t*28)*.3;
      else if(lane===2)value=noise()*Math.exp(-t*75)*.13;
      else value=(Math.sin(2*Math.PI*bass*t)+.2*Math.sin(4*Math.PI*bass*t))*Math.exp(-t*9)*.3;
      samples[start+j]+=value*attack;
    }
  }
  const buffer=new ArrayBuffer(44+n*2),view=new DataView(buffer),str=(s,o)=>{for(let i=0;i<s.length;i++)view.setUint8(o+i,s.charCodeAt(i));};
  str('RIFF',0);view.setUint32(4,36+n*2,true);str('WAVEfmt ',8);view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);str('data',36);view.setUint32(40,n*2,true);
  for(let i=0;i<n;i++)view.setInt16(44+i*2,Math.tanh(samples[i])*.9*32767,true);
  return new File([buffer],`マイビート-${bpm}BPM.wav`,{type:'audio/wav'});
}
