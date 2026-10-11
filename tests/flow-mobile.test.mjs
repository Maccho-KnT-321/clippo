import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';

const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const url=process.env.CLIPPO_URL||'http://127.0.0.1:4173';
const progress=stage=>{if(process.env.CLIPPO_DEBUG)console.log('Mobile flow: '+stage);};
const input=(page,key)=>page.locator(`#inspector .field[data-key=${key}] input,#inspector .field[data-key=${key}] select,#inspector .field[data-key=${key}] textarea`);
const subtool=(page,key)=>page.locator(`.mobile-subtools [data-dock-key=${key}]`);
async function chooseGroup(page,key){
  let button=page.locator(`.mobile-context-actions [data-dock-group=${key}]`);
  if(!await button.isVisible())await page.locator('#mobileDockBack').tap();
  await button.tap();
}
async function savedProject(page){
  await page.waitForFunction(()=>document.getElementById('saveProjectBtn').dataset.recovery==='saved',null,{timeout:15000});
  return page.evaluate(async()=>{const {loadRecovery}=await import('./project-store.js');return (await loadRecovery()).project;});
}
const metrics=page=>page.evaluate(()=>{
  const rect=selector=>document.querySelector(selector).getBoundingClientRect().toJSON();
  return {dock:rect('.inspector-panel'),timeline:rect('#timeline'),toolbar:rect('#mobileEditorToolbar'),inspector:rect('#inspector'),
    width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,pageY:scrollY,
    x:document.querySelector('#timeline').scrollLeft,y:document.querySelector('#timeline').scrollTop};
});
async function fieldsFit(page,keys){
  for(const key of keys){
    const field=page.locator(`#inspector .field[data-key=${key}]`);
    assert.equal(await field.getAttribute('data-dock-visible'),'true',key+' is the real visible native field');
    const bounds=await field.boundingBox(),panel=await page.locator('#inspector').boundingBox();
    assert(bounds&&panel,key+' has a visible editing area');
    assert(bounds.x>=panel.x-1&&bounds.x+bounds.width<=panel.x+panel.width+1,key+' fits horizontally');
    assert(bounds.y>=panel.y-1&&bounds.y+bounds.height<=panel.y+panel.height+1,key+' does not need a tiny hidden scroll: '+JSON.stringify({bounds,panel}));
  }
}
const previewSample=page=>page.evaluate(()=>{
  const canvas=document.querySelector('#preview'),context=canvas.getContext('2d'),values=[];
  for(let y=1;y<10;y++)for(let x=1;x<10;x++)values.push(...context.getImageData(Math.floor(canvas.width*x/10),Math.floor(canvas.height*y/10),1,1).data);
  return values.join(',');
});
async function waitForSample(page,sample,equal){
  await page.waitForFunction(({sample,equal})=>{
    const canvas=document.querySelector('#preview'),context=canvas.getContext('2d'),values=[];
    for(let y=1;y<10;y++)for(let x=1;x<10;x++)values.push(...context.getImageData(Math.floor(canvas.width*x/10),Math.floor(canvas.height*y/10),1,1).data);
    return (values.join(',')===sample)===equal;
  },{sample,equal});
}

try{
  const page=await browser.newPage({viewport:{width:390,height:744},isMobile:true,hasTouch:true}),errors=[];
  page.setDefaultTimeout(30000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);await page.locator('#welcomeDemo').tap();progress('loaded');
  const clips=page.locator('.track[data-kind=clips] .timeline-clip');await clips.nth(2).waitFor();await clips.first().tap();
  assert.equal(await page.locator('body').getAttribute('data-dock-kind'),'clips');
  assert(await page.locator('body').evaluate(body=>body.classList.contains('mobile-dock-collapsed')),'selecting a clip does not automatically open adjustments');
  const idle=await metrics(page);assert(idle.dock.height>=55&&idle.dock.height<=57,'idle controls occupy one compact row');
  await chooseGroup(page,'volume');await fieldsFit(page,['volume']);
  assert((await metrics(page)).dock.height>=163,'opening a tool reveals a useful native adjustment area');
  await page.locator('#mobileDockDone').tap();await clips.first().tap();
  assert(await page.locator('body').evaluate(body=>body.classList.contains('mobile-dock-collapsed')),'a clip tap keeps the compact state; a tool tap expands it');
  assert.equal(await page.locator('#inspector').isVisible(),false);

  progress('compact tools');
  // Each focused tool uses the real field without leaving a partly clipped
  // second field below a 53px window. Switching subtools is not a modal trip.
  await chooseGroup(page,'fit');
  for(const key of ['fit','zoom','rotation','flipX']){await subtool(page,key).tap();await fieldsFit(page,[key]);}
  await chooseGroup(page,'fade');
  for(const key of ['fadeIn','fadeOut']){await subtool(page,key).tap();await fieldsFit(page,[key]);assert.equal(await page.locator('#inspector .field[data-dock-visible=true]').count(),1);}
  await chooseGroup(page,'timing');await fieldsFit(page,['in','out']);
  for(const key of ['trimStartBtn','trimEndBtn'])assert.equal(await page.locator(`.dock-quick-trim-actions [data-native-action=${key}]`).isVisible(),true,'quick source trimming stays in the timing tool');
  const quickEnd=page.locator('.dock-quick-trim-actions [data-native-action=trimEndBtn]');
  assert.equal(await quickEnd.isDisabled(),true,'a source boundary cannot be trimmed again');
  const untrimmed=await savedProject(page);
  await page.locator('#scrub').fill('1');await page.locator('#scrub').dispatchEvent('input');
  await page.waitForFunction(()=>!document.querySelector('.dock-quick-trim-actions [data-native-action=trimEndBtn]').disabled);
  await quickEnd.tap();assert.equal((await savedProject(page)).clips[0].out,1,'the quick action delegates to the actual source trim');
  await page.locator('#undoBtn').tap();assert.deepEqual((await savedProject(page)).clips,untrimmed.clips,'one undo restores the quick source trim');
  await clips.first().tap();await chooseGroup(page,'timing');await page.locator('#scrub').fill('1');await page.locator('#scrub').dispatchEvent('input');
  await page.locator('.dock-quick-trim-actions [data-native-action=trimStartBtn]').tap();assert.equal((await savedProject(page)).clips[0].in,1);
  await page.locator('#undoBtn').tap();assert.deepEqual((await savedProject(page)).clips,untrimmed.clips);await clips.first().tap();

  progress('direct trim');
  // Precision scrolling is local to its category; ordinary tools start at
  // their first control. Main and nested horizontal menus remember separately.
  await chooseGroup(page,'details');await page.locator('#inspector').evaluate(node=>node.scrollTop=node.scrollHeight);
  assert(await page.locator('#inspector').evaluate(node=>node.scrollTop)>100,'precision fixture has enough content to exercise scrolling');
  await chooseGroup(page,'volume');assert.equal(await page.locator('#inspector').evaluate(node=>node.scrollTop),0);await fieldsFit(page,['volume']);
  await page.locator('.mobile-context-actions').evaluate(node=>node.scrollLeft=node.scrollWidth);
  const mainScroll=await page.locator('.mobile-context-actions').evaluate(node=>node.scrollLeft);assert(mainScroll>30);
  // Filters is fully visible at this scroll position, so automation does not
  // legitimately pan the row to reveal a partly clipped target before tapping.
  await chooseGroup(page,'filters');await page.locator('#mobileDockBack').tap();
  assert.equal(await page.locator('.mobile-context-actions').evaluate(node=>node.scrollLeft),mainScroll,'returning from a nested tool restores the main menu position');
  await chooseGroup(page,'fit');await subtool(page,'rotation').tap();await page.locator('#mobileDockBack').tap();
  assert.equal(await page.locator('.mobile-context-actions').evaluate(node=>node.scrollLeft),mainScroll);

  progress('menu scroll');
  // Color cards show the user's actual asset, not a decorative landscape.
  await chooseGroup(page,'filters');
  const neutral=await previewSample(page);
  for(const look of ['standard','vivid','cinema','mono']){
    const card=page.locator(`.color-look-card[data-color-look=${look}]`);assert.equal(await card.locator('img').count(),1);
    assert(await card.locator('img').evaluate(image=>image.complete&&image.naturalWidth>0),'filter '+look+' previews the selected asset');
    await card.tap();assert.equal(await card.getAttribute('aria-pressed'),'true');
  }
  await page.locator('.color-look-card[data-color-look=standard]').tap();await savedProject(page);await waitForSample(page,neutral,true);progress('color looks');
  await chooseGroup(page,'color');await subtool(page,'brightness').tap();await fieldsFit(page,['brightness']);
  await input(page,'brightness').fill('0.6');await input(page,'brightness').dispatchEvent('input');await input(page,'brightness').dispatchEvent('change');
  await waitForSample(page,neutral,false);const adjusted=await previewSample(page),edited=await savedProject(page);
  assert.equal(edited.clips[0].brightness,.6);
  const compare=page.locator('#mobileColorCompare');assert.equal(await compare.isVisible(),true);
  const point=await compare.boundingBox();await page.mouse.move(point.x+point.width/2,point.y+point.height/2);await page.mouse.down();
  await waitForSample(page,neutral,true);assert(await page.locator('body').evaluate(body=>body.classList.contains('preview-comparing')));
  assert.equal(await page.locator('#colorCompareBadge').isVisible(),true);
  assert.deepEqual(await savedProject(page),edited,'comparison does not mutate project or recovery');
  await page.mouse.up();await waitForSample(page,adjusted,true);
  assert.equal(await page.locator('#colorCompareBadge').isVisible(),false);
  for(const cancellation of ['pointercancel','blur']){
    await compare.dispatchEvent('pointerdown',{pointerId:8,button:0});
    assert(await page.locator('body').evaluate(body=>body.classList.contains('preview-comparing')));
    if(cancellation==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
    else await compare.dispatchEvent('pointercancel',{pointerId:8});
    await waitForSample(page,adjusted,true);assert(!await page.locator('body').evaluate(body=>body.classList.contains('preview-comparing')));
  }
  await page.locator('#undoBtn').tap();assert.equal((await savedProject(page)).clips[0].brightness,1,'comparison creates no undo step');
  await page.locator('#redoBtn').tap();assert.equal((await savedProject(page)).clips[0].brightness,.6);
  // Instrument the existing engine rather than mocking playback state.
  await page.evaluate(async()=>{
    const source=await(await fetch(new URL('./app.js',location.href))).text(),module=source.match(/import\s+\{\s*EditorEngine[^;]*from\s+'([^']+)'/)[1];
    const {EditorEngine}=await import(new URL(module,location.href).href),play=EditorEngine.prototype.play;
    EditorEngine.prototype.play=function(...args){window.flowEngine=this;return play.apply(this,args);};
  });
  await clips.first().tap();await chooseGroup(page,'color');await page.locator('#playBtn').tap();await page.waitForFunction(()=>window.flowEngine?.playing);
  await compare.dispatchEvent('pointerdown',{pointerId:9,button:0});assert.equal(await page.evaluate(()=>window.flowEngine.playing),true,'holding compare does not stop playback');
  await compare.dispatchEvent('pointerup',{pointerId:9});assert.equal(await page.evaluate(()=>window.flowEngine.playing),true);await page.locator('#playBtn').tap();

  progress('color comparison');
  // Text style opens a single editable property at a time. The sound preset
  // explicitly states its project-wide scope instead of implying clip scope.
  await page.locator('#addTextBtn').tap();assert.equal(await page.locator('body').getAttribute('data-dock-kind'),'texts');
  assert(!await page.locator('body').evaluate(body=>body.classList.contains('mobile-dock-collapsed')));
  assert.equal(await page.locator('body').getAttribute('data-dock-group'),'text','new text opens its editing field directly');
  assert.equal(await input(page,'text').evaluate(node=>node===document.activeElement),true,'a new caption is ready to type without another menu tap');
  await chooseGroup(page,'style');
  await subtool(page,'looks').tap();assert.equal(await page.locator('#inspector .finishing-presets').isVisible(),true);
  for(const key of ['size','color','background']){await subtool(page,key).tap();await fieldsFit(page,[key]);}
  assert.equal(await page.locator('.mobile-context-actions [data-dock-group=timing]').isVisible(),true);
  await chooseGroup(page,'timing');await fieldsFit(page,['start','end']);
  await page.locator('#addTextBtn').tap();
  assert.equal(await page.locator('body').getAttribute('data-dock-group'),'text','adding another caption opens text instead of the previous timing or style menu');
  assert.equal(await input(page,'text').evaluate(node=>node===document.activeElement),true);
  await page.locator('#addMusicBtn').tap();await page.locator('#presetMusicList .music-row').first().getByRole('button',{name:'追加',exact:true}).tap();await page.locator('#musicDialog').waitFor({state:'hidden'});
  assert.equal(await page.locator('body').getAttribute('data-dock-kind'),'music');
  assert(await page.locator('body').evaluate(body=>body.classList.contains('mobile-dock-collapsed')));
  await chooseGroup(page,'timing');await subtool(page,'start').tap();await fieldsFit(page,['start']);await subtool(page,'range').tap();await fieldsFit(page,['in','out']);
  await chooseGroup(page,'style');assert.match(await page.locator('#inspector .finishing-presets>span').innerText(),/作品全体の音/);
  assert.equal(await page.locator('#inspector .finishing-presets>span').isVisible(),true);

  progress('text and music tools');
  // Normal short-phone layouts retain editing space even for two-field
  // timing. Keyboard-focused editing uses its visible viewport separately.
  await clips.first().tap();await chooseGroup(page,'timing');
  for(const [width,height] of [[320,568],[390,667],[390,744],[430,844]]){
    await page.setViewportSize({width,height});await fieldsFit(page,['in','out']);const size=await metrics(page);
    assert(size.timeline.height>=80,'timing retains an editable timeline: '+JSON.stringify(size));
    assert(size.timeline.bottom<=size.dock.top+1&&size.dock.bottom<=size.toolbar.top+1&&size.toolbar.bottom<=height+1);
    assert(size.width<=width&&size.height<=height&&size.pageY===0);
  }
  await page.setViewportSize({width:390,height:744});await page.locator('.text-clip').first().tap();await chooseGroup(page,'text');await input(page,'text').focus();
  await page.setViewportSize({width:390,height:430});await page.waitForFunction(()=>document.body.classList.contains('mobile-keyboard'));
  await fieldsFit(page,['text']);const done=await page.locator('#mobileDockDone').boundingBox(),typing=await input(page,'text').boundingBox();
  assert(typing.y>=0&&typing.y+typing.height<=430&&done.y>=0&&done.y+done.height<=430,'typing and Done stay inside the visible keyboard viewport');
  await input(page,'text').fill('その場で迷わず編集');await page.locator('#mobileDockDone').tap();await page.setViewportSize({width:390,height:744});
  await page.waitForFunction(()=>!document.body.classList.contains('mobile-keyboard'));assert.equal((await savedProject(page)).texts[0].text,'その場で迷わず編集');
  progress('short phone and keyboard');
  await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/flow-mobile.png'});
  progress('screenshot');
  await page.setViewportSize({width:1440,height:1000});assert.equal(await page.locator('.workspace>.inspector-panel').count(),1);
  assert.equal(await page.locator('#mobileColorCompare').isVisible(),false);
  assert.equal(await page.locator('#inspector .dock-quick-trim-actions').count(),0,'mobile precision helpers do not remain in the desktop inspector');
  await clips.first().click();
  const disclosure=page.locator('#inspector .advanced-controls');
  if(!await disclosure.evaluate(node=>node.open))await disclosure.locator('summary').click();
  progress('desktop open');
  await page.setViewportSize({width:390,height:744});await chooseGroup(page,'color');await subtool(page,'brightness').tap();
  await input(page,'brightness').fill('1.1');await input(page,'brightness').dispatchEvent('change');progress('first desktop-to-mobile color edit');await savedProject(page);
  await page.setViewportSize({width:1440,height:1000});assert.equal(await disclosure.evaluate(node=>node.open),true,'an explicitly open desktop disclosure survives a real mobile edit');progress('desktop open restored');
  await disclosure.locator('summary').click();
  await page.setViewportSize({width:390,height:744});await chooseGroup(page,'color');await subtool(page,'brightness').tap();
  await input(page,'brightness').fill('1.2');await input(page,'brightness').dispatchEvent('change');progress('second desktop-to-mobile color edit');await savedProject(page);
  await page.setViewportSize({width:1440,height:1000});assert.equal(await disclosure.evaluate(node=>node.open),false,'an explicitly closed desktop disclosure is not reopened by mobile refresh');
  assert.deepEqual(errors,[]);
  console.log('Mobile flow: compact idle, real focused fit/fade/text tools, whole-field precision, category scroll, source filter previews, reversible hold-to-compare without history or playback changes, global sound scope, short-phone fit, keyboard editing and desktop restoration passed.');
}finally{await browser.close();}
