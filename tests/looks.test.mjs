import test from 'node:test';
import assert from 'node:assert/strict';
import {colorLooks,matchesColorLook,colorLookFilter,matchesTextLook} from '../looks.js';
import {textLooks} from '../finishing.js';
import {canTrimToPlayhead,trimToPlayhead} from '../editing.js';
import {EditorEngine} from '../engine.js';

test('four local color looks preserve the existing coefficients and have readable metadata',()=>{
  assert.deepEqual(colorLooks.map(look=>look.id),['standard','vivid','cinema','mono']);
  assert.deepEqual(colorLooks.map(look=>look.values),[
    {brightness:1,contrast:1,saturation:1},
    {brightness:1.03,contrast:1.1,saturation:1.3},
    {brightness:.95,contrast:1.2,saturation:.8},
    {brightness:1,contrast:1.1,saturation:0}
  ]);
  for(const look of colorLooks){
    assert(look.name.length&&look.description.length);
    assert(look.values.brightness>=.2&&look.values.brightness<=2);
    assert(look.values.contrast>=0&&look.values.contrast<=2);
    assert(look.values.saturation>=0&&look.values.saturation<=2);
    assert.equal(colorLookFilter(look),`brightness(${look.values.brightness}) contrast(${look.values.contrast}) saturate(${look.values.saturation})`);
  }
  assert(Object.isFrozen(colorLooks));
  assert(colorLooks.every(look=>Object.isFrozen(look)&&Object.isFrozen(look.values)));
});

test('color look matching follows real values rather than a stale preset choice',()=>{
  for(const look of colorLooks){
    const item={...look.values,rotation:90,zoom:1.5,custom:'keep'};
    assert(matchesColorLook(item,look));
    assert.equal(colorLooks.filter(preset=>matchesColorLook(item,preset)).length,1);
    item.contrast+=.05;assert(!matchesColorLook(item,look));
    item.contrast=look.values.contrast;assert(matchesColorLook(item,look));
  }
  assert(matchesColorLook({},colorLooks[0]),'older clips have neutral color defaults');
  assert(!matchesColorLook({brightness:NaN},colorLooks[0]));
  assert(!matchesColorLook({brightness:Infinity},colorLooks[0]));
  assert(!matchesColorLook(null,colorLooks[0]));
  assert(!matchesColorLook([],colorLooks[0]));
  assert(!matchesColorLook({},null));
});

test('text sample selection describes the actual look, not text content or timing',()=>{
  for(const look of textLooks){
    const item={...look,text:'違う言葉',start:10,end:20,fade:.2};
    const before=structuredClone(item);assert(matchesTextLook(item,look));assert.deepEqual(item,before);
    item.size+=1;assert(!matchesTextLook(item,look));item.size=look.size;
    item.color=look.color.toUpperCase();assert(matchesTextLook(item,look));
    item.x=.5;assert(!matchesTextLook(item,look),'manually moved text is no longer the standard placement');delete item.x;
    item.y=.5;assert(!matchesTextLook(item,look));delete item.y;assert(matchesTextLook(item,look));
  }
  assert(!matchesTextLook(null,textLooks[0]));
  assert(!matchesTextLook([],textLooks[0]));
  assert(!matchesTextLook({},null));
  assert(!matchesTextLook({color:123},textLooks[0]));
});

test('direct trim availability is pure and matches the actual boundary/overlap safety',()=>{
  const original=[
    {id:'a',in:2,out:10,speed:2,transition:{type:'dissolve',duration:1},fadeIn:.4,fadeOut:.5},
    {id:'b',in:0,out:5,speed:1,transition:{type:'none',duration:.5}}
  ];
  const before=structuredClone(original);
  for(const [id,time,expected] of [['a',0,false],['a',.05,false],['a',1,true],['a',3.5,false],['a',4,false],['b',3.5,false],['b',5,true],['b',8,false],['no',2,false],['a',NaN,false]]){
    assert.equal(canTrimToPlayhead(original,id,time),expected,`${id}@${time}`);
    for(const side of ['start','end']){
      const candidate=structuredClone(original);
      assert.equal(trimToPlayhead(candidate,id,time,side),expected,`${side} ${id}@${time}`);
      if(!expected)assert.deepEqual(candidate,original);
    }
  }
  assert.deepEqual(original,before);
  const candidate=structuredClone(original);assert(trimToPlayhead(candidate,'a',1,'start'));
  assert.equal(candidate[0].in,4);assert.equal(candidate[0].fadeIn,0);assert.equal(candidate[0].out,10);
});

test('original-color comparison bypasses only color, preserves transforms/fades and is never used for export',()=>{
  const priorDocument=globalThis.document;
  try{
    for(const [bypass,exporting,expectedFilter] of [[null,false,'brightness(1.03) contrast(1.1) saturate(1.3)'],['a',false,'none'],['other',false,'brightness(1.03) contrast(1.1) saturate(1.3)'],['a',true,'brightness(1.03) contrast(1.1) saturate(1.3)']]){
      const frames=[],transforms=[],fills=[],stack=[];
      const ctx={filter:'none',save(){stack.push(this.filter);},restore(){this.filter=stack.pop();},clearRect(){},translate(...args){transforms.push(['translate',...args]);},rotate(...args){transforms.push(['rotate',...args]);},scale(...args){transforms.push(['scale',...args]);},drawImage(){frames.push(this.filter);},fillRect(){fills.push(this.fillStyle);}};
      globalThis.document={createElement:()=>({getContext:()=>ctx})};
      const engine=new EditorEngine({width:320,height:180,getContext:()=>ctx},new Map());engine.previewColorBypassId=bypass;engine.exporting=exporting;
      const clip={id:'a',brightness:1.03,contrast:1.1,saturation:1.3,rotation:90,flipX:true,zoom:2,fit:'cover'},before=structuredClone(clip);
      engine.visualFrame({visual:{videoWidth:640,videoHeight:360},clip,fade:.5},0);
      assert.equal(frames[0],expectedFilter);
      assert.deepEqual(transforms,[['translate',160,90],['rotate',Math.PI/2],['scale',-1,1]]);
      assert(fills.includes('rgba(0,0,0,0.5)'),'comparison keeps the visual fade');
      assert.deepEqual(clip,before,'comparison never neutralizes the saved clip settings');
    }
  }finally{if(priorDocument===undefined)delete globalThis.document;else globalThis.document=priorDocument;}
});

test('comparison uses the neutral fast path for one clip without adding decoders, but export uses its color settings',async()=>{
  const priorImage=globalThis.HTMLImageElement;
  try{
    globalThis.HTMLImageElement=class {naturalWidth=640;naturalHeight=360;};
    const ctx={save(){},restore(){},fillRect(){},drawImage(){}};
    const engine=new EditorEngine({width:320,height:180,getContext:()=>ctx},new Map());
    const visual=new globalThis.HTMLImageElement();engine.element=async()=>visual;
    let filtered=0;engine.visualFrame=()=>{filtered++;return visual;};
    const project={clips:[{id:'a',assetId:'source',in:0,out:4,speed:1,volume:1,fit:'contain',brightness:1.03,contrast:1.1,saturation:1.3}],music:[],texts:[]},before=structuredClone(project);
    await engine.render(project,1);assert.equal(filtered,1);
    engine.previewColorBypassId='a';await engine.render(project,1);assert.equal(filtered,1,'comparison does not use an unnecessary intermediate layer');
    engine.exporting=true;await engine.render(project,1);assert.equal(filtered,2,'a recording cannot inherit original-color comparison');
    assert.equal(engine.media.size,0);assert.deepEqual(project,before);
  }finally{if(priorImage===undefined)delete globalThis.HTMLImageElement;else globalThis.HTMLImageElement=priorImage;}
});
