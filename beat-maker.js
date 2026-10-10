export const beatTracks=[['kick','ドラム'],['snare','手拍子'],['hat','ハイハット'],['bass','ベース']];
export const beatPresets={
  pop:[[0,4,8,12],[4,12],[0,2,4,6,8,10,12,14],[0,6,8,14]],
  chill:[[0,8],[4,12],[2,6,10,14],[0,8]],
  dance:[[0,4,8,12],[4,12],[2,6,10,14],[0,3,6,8,11,14]]
};
export function beatPattern(name){return beatPresets[name].map(steps=>Array.from({length:16},(_,i)=>steps.includes(i)));}

// Fades belong to the video timeline, not to every repeated WAV. A voice
// crossing the loop boundary continues at the beginning instead of being cut.
export function addLoopVoice(samples,start,length,rate,voice){
  const offset=Math.round(start*rate),count=Math.round(length*rate);
  for(let j=0;j<count;j++)samples[(offset+j)%samples.length]+=voice(j/rate);
}
export function encodeLoopWav(samples,rate,name,lastModified=Date.now()){
  const n=samples.length,buffer=new ArrayBuffer(44+n*2),view=new DataView(buffer);
  const str=(s,o)=>{for(let i=0;i<s.length;i++)view.setUint8(o+i,s.charCodeAt(i));};
  str('RIFF',0);view.setUint32(4,36+n*2,true);str('WAVEfmt ',8);view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);str('data',36);view.setUint32(40,n*2,true);
  for(let i=0;i<n;i++)view.setInt16(44+i*2,Math.tanh(samples[i])*.9*32767,true);
  return new File([buffer],name,{type:'audio/wav',lastModified});
}
export function renderBeat(pattern,bpm=110,bars=8){
  bpm=Number(bpm);bars=Number(bars);
  if(!Number.isFinite(bpm)||bpm<50||bpm>200||!Number.isInteger(bars)||bars<1||bars>32||!Array.isArray(pattern)||pattern.length!==4||pattern.some(row=>!Array.isArray(row)||row.length!==16))throw new Error('リズムと速さを確認してください。');
  const rate=22050,step=60/bpm/4,n=Math.round(step*16*bars*rate),samples=new Float32Array(n);
  let seed=12345;const noise=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2147483648-1;};
  for(let bar=0;bar<bars;bar++)for(let lane=0;lane<4;lane++)for(let pos=0;pos<16;pos++){
    if(!pattern[lane][pos])continue;
    const start=(bar*16+pos)*step,length=lane===3?.48:lane===2?.07:.18;
    const bass=[130.81,130.81,110,98][bar%4];
    addLoopVoice(samples,start,length,rate,t=>{
      const attack=Math.min(1,t/.003),tail=Math.min(1,(length-t)/.025);let value;
      if(lane===0)value=Math.sin(2*Math.PI*(48*t+7*(1-Math.exp(-t*30))))*Math.exp(-t*23)*.48;
      else if(lane===1)value=(noise()*.6+Math.sin(2*Math.PI*185*t)*.2)*Math.exp(-t*28)*.3;
      else if(lane===2)value=noise()*Math.exp(-t*75)*.13;
      else value=(Math.sin(2*Math.PI*bass*t)+.2*Math.sin(4*Math.PI*bass*t))*Math.exp(-t*9)*.3;
      return value*attack*tail;
    });
  }
  return encodeLoopWav(samples,rate,`マイビート-${bpm}BPM.wav`);
}
