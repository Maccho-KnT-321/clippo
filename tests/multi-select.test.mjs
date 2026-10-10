import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {selectionKey,selectedEntries,toggleTrackSelection,removeSelected} from '../selection.js';

const project={clips:[{id:'a'},{id:'b'}],texts:[{id:'a'},{id:'c'}],music:[{id:'m'}]};
const keys=new Set([selectionKey('texts','a')]);
toggleTrackSelection(project,keys,'clips');assert.equal(selectedEntries(project,keys).length,3);
toggleTrackSelection(project,keys,'clips');assert.deepEqual([...keys],['texts:a']);
removeSelected(project,keys);assert.equal(project.texts.length,1);assert.equal(project.clips.length,2);

const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:390,height:744},isMobile:true,hasTouch:true});
  await page.goto(process.env.CLIPPO_URL||'http://127.0.0.1:4173');await page.locator('#welcomeDemo').tap();
  const video=page.locator('.track[data-kind=clips] .timeline-clip');await video.nth(2).waitFor();
  for(let i=0;i<4;i++)await page.locator('#addTextBtn').tap();
  await page.locator('#addMusicBtn').tap();await page.locator('#presetMusicList .music-row').first().getByRole('button',{name:'追加',exact:true}).tap();
  await page.locator('.audio-clip').waitFor();
  const counts=()=>page.evaluate(()=>Object.fromEntries(['clips','texts','music'].map(kind=>[kind,document.querySelectorAll(`.track[data-kind=${kind}] .timeline-clip`).length])));
  const original=await counts();
  await page.locator('#timeline').evaluate(e=>{e.scrollTop=110;e.scrollLeft=220;});
  const before=await page.locator('#timeline').evaluate(e=>({top:e.scrollTop,left:e.scrollLeft}));
  const time=await page.locator('#scrub').inputValue();
  await page.locator('[data-select-track=texts]').tap();
  assert.equal(await page.locator('.text-clip.selected').count(),4,'track label selects all text blocks');
  assert.equal(await page.locator('#scrub').inputValue(),time,'track selection does not seek the movie');
  const position=await page.locator('#timeline').evaluate(e=>({top:e.scrollTop,left:e.scrollLeft}));
  assert.equal(position.left,before.left,'batch selection does not reveal the first offscreen item');
  const text=page.locator('.text-clip');await text.nth(1).tap();
  assert.equal(await page.locator('.text-clip.selected').count(),3,'a block tap toggles only that block');
  await page.locator('#deleteBtn').tap();assert.equal((await counts()).texts,1,'batch delete leaves unselected text untouched');
  assert.equal((await counts()).clips,original.clips);assert.equal((await counts()).music,original.music);
  await page.locator('#undoBtn').tap();assert.deepEqual(await counts(),original,'one undo restores the entire deletion');
  await page.locator('#redoBtn').tap();assert.equal((await counts()).texts,1);await page.locator('#undoBtn').tap();

  await page.locator('#timeline').evaluate(e=>{e.scrollTop=0;e.scrollLeft=0;});
  await page.locator('#multiSelectBtn').tap();await video.first().tap();await video.nth(1).tap();
  assert.equal(await video.locator(':scope').count(),3);assert.equal(await page.locator('.track[data-kind=clips] .selected').count(),2);
  await page.locator('#timeline').evaluate(e=>e.scrollTop=e.scrollHeight);
  await page.locator('[data-select-track=music]').tap();
  assert.equal(await page.locator('.audio-clip.selected').count(),original.music,'track selection adds to a mixed selection');
  await page.locator('#deleteBtn').tap();assert.equal((await counts()).clips,1);assert.equal((await counts()).music,0);assert.equal((await counts()).texts,4);
  await page.locator('#undoBtn').tap();assert.deepEqual(await counts(),original);

  for(const width of [320,390,430]){
    await page.setViewportSize({width,height:744});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'selection controls fit small phones');
    const toggle=await page.locator('#multiSelectBtn').boundingBox();assert(toggle.x>=0&&toggle.x+toggle.width<=width,'selection button stays inside the viewport');
  }
  await page.setViewportSize({width:1440,height:1000});
  await video.first().click();await video.nth(1).click({modifiers:['Control']});
  assert.equal(await page.locator('.track[data-kind=clips] .selected').count(),2,'desktop modifier click adds a selection');
  await page.locator('#deleteBtn').click();assert.equal((await counts()).clips,1);await page.locator('#undoBtn').click();assert.deepEqual(await counts(),original);
  console.log('Batch editing: track and mixed selection, individual toggles, untouched tracks, single undo/redo, no seek or horizontal jump, 320px controls and desktop modifier selection passed.');
}finally{await browser.close();}
