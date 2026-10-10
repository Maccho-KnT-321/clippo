import test from 'node:test';
import assert from 'node:assert/strict';
import {applySoundMix,applyTextLook,soundMixes,textLooks} from '../finishing.js';

test('three text looks apply readable placement while preserving content and timing',()=>{
  const original={id:'title',text:'今日の思い出',start:2,end:8,fade:.2,x:.3,y:.7,size:20,color:'#000000',position:'top',background:false,custom:{tag:'keep'}};
  for(const look of textLooks){
    const item=structuredClone(original);
    assert.equal(applyTextLook(item,look.id),true);
    for(const key of ['size','color','position','background'])assert.equal(item[key],look[key]);
    for(const key of ['id','text','start','end','fade','custom'])assert.deepEqual(item[key],original[key]);
    assert(!Object.hasOwn(item,'x')&&!Object.hasOwn(item,'y'),'manual coordinates reset to the chosen standard position');
    assert(look.size>=12&&look.size<=160);
    assert.match(look.color,/^#[0-9a-f]{6}$/i);
  }
  assert.equal(textLooks.find(look=>look.id==='caption').size,44);
  assert.equal(textLooks.find(look=>look.id==='headline').size,70);
  assert.equal(textLooks.find(look=>look.id==='highlight').size,56);
});

test('unknown choices and invalid records do not change content',()=>{
  const item={text:'そのまま',size:40,x:.1,y:.2},before=structuredClone(item);
  assert.equal(applyTextLook(item,'not-a-look'),false);assert.deepEqual(item,before);
  assert.equal(applyTextLook(null,'caption'),false);
  const project={clips:[{volume:1}],music:[{volume:.4}],name:'keep'},saved=structuredClone(project);
  assert.equal(applySoundMix(project,'unknown'),false);assert.deepEqual(project,saved);
  assert.equal(applySoundMix(null,'voice'),false);
});

test('sound mixes set both gains safely and soften only the first and last BGM loops',()=>{
  const original={name:'作品',aspect:'9:16',texts:[{text:'keep'}],clips:[{id:'clip',assetId:'v',in:2,out:42,speed:2,volume:1.8,fadeIn:.6,fadeOut:.9,custom:'keep'}],music:[
    {id:'first',assetId:'a',start:0,in:0,out:8,volume:1.3,fadeIn:2,fadeOut:2},
    {id:'middle',assetId:'a',start:8,in:0,out:8,volume:1.2,fadeIn:2,fadeOut:2},
    {id:'last',assetId:'a',start:16,in:1,out:5,volume:1.1,fadeIn:2,fadeOut:2}
  ]};
  for(const mix of soundMixes){
    const project=structuredClone(original);assert.equal(applySoundMix(project,mix.id),true);
    assert.equal(project.clips[0].volume,mix.clipVolume);
    assert(project.music.every(item=>item.volume===mix.musicVolume));
    assert(mix.clipVolume>=0&&mix.clipVolume<=2&&mix.musicVolume>=0&&mix.musicVolume<=2);
    assert.deepEqual(project.music.map(item=>[item.fadeIn,item.fadeOut]),[[.25,0],[0,0],[0,.8]]);
    assert.equal(project.clips[0].fadeIn,.6);assert.equal(project.clips[0].fadeOut,.9,'video visual/audio fades are not overwritten');
    for(const [index,item]of project.music.entries())for(const key of ['id','assetId','start','in','out'])assert.equal(item[key],original.music[index][key]);
    for(const key of ['name','aspect','texts'])assert.deepEqual(project[key],original[key]);
  }
});

test('unordered overlapping tracks use their true outside boundaries, not array order',()=>{
  const project={clips:[{in:0,out:20,speed:1}],music:[
    {id:'middle',start:5,in:0,out:4},
    {id:'last-a',start:10,in:0,out:5},
    {id:'first-a',start:2,in:0,out:5},
    {id:'first-b',start:2,in:2,out:8},
    {id:'last-b',start:12,in:0,out:3}
  ]};
  applySoundMix(project,'balanced');
  assert.deepEqual(project.music.map(item=>[item.fadeIn,item.fadeOut]),[[0,0],[0,.8],[.25,0],[.25,0],[0,.8]]);
});

test('short music, empty tracks and absent track arrays are safe',()=>{
  const project={clips:[{in:0,out:5,speed:1}],music:[{start:4,in:0,out:.1}]};
  applySoundMix(project,'voice');
  assert.equal(project.music[0].fadeIn,.05);assert.equal(project.music[0].fadeOut,.05);
  assert.equal(applySoundMix({clips:[],music:[]},'balanced'),true);
  assert.equal(applySoundMix({name:'empty'},'music'),true);
  const malformed={clips:[null,[]],music:[null,{start:0,in:0,out:0}]};
  assert.equal(applySoundMix(malformed,'voice'),true);
  assert.equal(malformed.music[1].fadeIn,0);assert.equal(malformed.music[1].fadeOut,0);
});

test('long BGM is trimmed and faded at the actual video ending, while future placement remains',()=>{
  const project={clips:[{id:'video',in:1,out:11,speed:2}],music:[
    {id:'long',assetId:'song',start:1,in:2,out:62,custom:'keep'},
    {id:'future',assetId:'song',start:10,in:3,out:7}
  ]};
  applySoundMix(project,'balanced');
  assert.equal(project.music[0].out,6,'source in 2 + four seconds until the video ends at 5');
  assert.equal(project.music[0].fadeIn,.25);assert.equal(project.music[0].fadeOut,.8);
  assert.deepEqual(Object.fromEntries(['id','assetId','start','in','custom'].map(key=>[key,project.music[0][key]])),{id:'long',assetId:'song',start:1,in:2,custom:'keep'});
  assert.equal(project.music[1].start,10);assert.equal(project.music[1].out,7,'future track is not removed or shortened');
  assert.equal(project.music[1].fadeIn,0);assert.equal(project.music[1].fadeOut,0,'future music is not considered the audible ending');
  assert.equal(project.music.length,2);
});

test('a trimmed tiny ending segment keeps both fades inside the audible duration',()=>{
  const project={clips:[{in:0,out:5,speed:1}],music:[{start:4.8,in:7,out:60}]};
  applySoundMix(project,'voice');
  assert(Math.abs(project.music[0].out-7.2)<.000001);
  assert(Math.abs(project.music[0].fadeIn-.1)<.000001);
  assert(Math.abs(project.music[0].fadeOut-.1)<.000001);
});

test('preset metadata cannot accidentally be changed by an editor operation',()=>{
  assert(Object.isFrozen(textLooks)&&Object.isFrozen(soundMixes));
  assert(textLooks.every(Object.isFrozen)&&soundMixes.every(Object.isFrozen));
  const item={text:'hello'};applyTextLook(item,'caption');item.size=99;
  assert.equal(textLooks[0].size,44);
});
