// Small local looks, previewed from the already-imported thumbnail. No extra
// video decoder or frame analysis is needed to choose a color treatment.
export const colorLooks=Object.freeze([
  {id:'standard',name:'標準',description:'素材の色をそのまま',values:{brightness:1,contrast:1,saturation:1}},
  {id:'vivid',name:'鮮やか',description:'色を明るく、鮮やかに',values:{brightness:1.03,contrast:1.1,saturation:1.3}},
  {id:'cinema',name:'シネマ',description:'落ち着いた映画のような色',values:{brightness:.95,contrast:1.2,saturation:.8}},
  {id:'mono',name:'モノクロ',description:'色を取り除き、明暗を際立たせる',values:{brightness:1,contrast:1.1,saturation:0}}
].map(look=>Object.freeze({...look,values:Object.freeze(look.values)})));

export function matchesColorLook(item,look){
  if(!item||typeof item!=='object'||Array.isArray(item)||!look?.values)return false;
  return ['brightness','contrast','saturation'].every(key=>{
    const value=Number(item[key]??1);
    return Number.isFinite(value)&&Math.abs(value-look.values[key])<.000001;
  });
}

export function colorLookFilter(look){
  const {brightness,contrast,saturation}=look.values;
  return `brightness(${brightness}) contrast(${contrast}) saturate(${saturation})`;
}

export function matchesTextLook(item,look){
  if(!item||typeof item!=='object'||Array.isArray(item)||!look||item.x!=null||item.y!=null)return false;
  return Number(item.size??42)===look.size&&String(item.color??'#ffffff').toLowerCase()===look.color.toLowerCase()
    &&(item.position??'bottom')===look.position&&!!item.background===look.background;
}
