import { EditorEngine, supportedFormats } from './engine.js';
import { clipDuration, layoutClips, projectDuration, transitionDuration } from './timeline.js';
import { insertionAt, trimToPlayhead } from './editing.js';
import { musicStore, makePresetMusic } from './music-library.js';
import { templates } from './templates.js';
import { beatTracks, beatPattern, renderBeat } from './beat-maker.js';
import { inspectLocalFile } from './import-media.js';

const $ = id => document.getElementById(id);
const assets = new Map();
let project = { version: 2, name: '名称未設定のプロジェクト', aspect: '16:9', clips: [], texts: [], music: [] };
let selected = null, time = 0, playing = false, busy = false, exportController = null, resultUrl = null;
let past = [], future = [], renderPending = false, renderAgain = false, toastTimer;
let timelineScale=60, clipboard=null, transitionSelection=null, suppressClickUntil=0;
let snapping=true, advancedOpen=false, draggedAsset=null, dropDepth=0;
const engine = new EditorEngine($('preview'), assets);
$('projectInput').accept='.clippo,.json,application/json';
$('mediaInput').accept='video/*,audio/*,image/*,.mov,.m4v,.mp4,.m4a';
$('saveProjectBtn').setAttribute('aria-label','素材込みでプロジェクトを保存');
const uid = () => crypto.randomUUID();
const clone = value => JSON.parse(JSON.stringify(value));
const duration = () => projectDuration(project);
const fmt = value => { const s = Math.max(0, Number(value) || 0); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + (s % 60).toFixed(1).padStart(4, '0'); };
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toast = message => { $('toast').textContent = message; $('toast').hidden = false; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; $('toast').classList.remove('visible'); }, 4500); };
function stop() { engine.pause(); playing = false; $('playBtn').textContent = '▶'; $('playBtn').setAttribute('aria-label', '再生'); }
function remember() { stop(); past.push(clone(project)); if (past.length > 60) past.shift(); future = []; }
function edit(fn) { if (busy) return; remember(); fn(); time = Math.min(time, duration()); refresh(); }
function selection() { if (!selected) return null; return project[selected.kind].find(item => item.id === selected.id); }
function select(kind, id) { selected = { kind, id }; transitionSelection=null; renderTimeline(); renderInspector(); }
function setPanel(name){ document.body.dataset.panel=name; for(const tab of document.querySelectorAll('[data-panel]')){tab.classList.toggle('active',tab.dataset.panel===name);tab.setAttribute('aria-pressed',String(tab.dataset.panel===name));} }
async function renderPreview() {
  if (renderPending) { renderAgain = true; return; }
  renderPending = true;
  try { await engine.render(project, time); } catch (error) { console.warn(error); toast('プレビューを表示できません。素材の形式をご確認ください。'); }
  finally { renderPending = false; if (renderAgain) { renderAgain = false; renderPreview(); } }
}
function refresh() {
  document.body.classList.toggle('has-clips',project.clips.length>0);
  if(!busy){const [w,h]=project.aspect.split(':').map(Number); const height=540,width=Math.round(height*w/h);if($('preview').width!==width||$('preview').height!==height){$('preview').width=width;$('preview').height=height;}}
  $('projectName').value = project.name;
  $('aspect').value = project.aspect;
  $('previewEmpty').hidden = project.clips.length > 0;
  $('scrub').max = duration(); $('scrub').value = time;
  $('timeDisplay').textContent = fmt(time) + ' / ' + fmt(duration());
  $('undoBtn').disabled = !past.length || busy; $('redoBtn').disabled = !future.length || busy;
  $('exportBtn').disabled = !project.clips.length || busy;
  renderMedia(); renderTimeline(); renderInspector(); renderPreview();
  updateGuide();
}
function renderMedia() {
  $('mediaList').replaceChildren();
  if(!assets.size)$('mediaList').innerHTML='<div class="media-empty"><p>ここから、あなたの作品を。</p><span>動画・写真・音楽を追加してください。</span></div>';
  for (const asset of assets.values()) {
    const button = document.createElement('button'); button.className = 'media-card'; button.type = 'button';
    button.title = asset.name + ' — タイムラインに追加';
    button.innerHTML = '<div class="media-thumb">' + (asset.thumb ? '<img alt="" src="' + asset.thumb + '">' : '<span>♫</span>') + '<span class="media-duration">' + fmt(asset.duration) + '</span></div><span>' + escape(asset.name) + '</span>';
    button.onclick = () => addAsset(asset);
    button.querySelectorAll('img').forEach(img=>img.draggable=false);
    const grip=document.createElement('span');grip.className='media-grip';grip.textContent='⠿';grip.title='長押ししてタイムラインへ運ぶ';grip.setAttribute('aria-hidden','true');button.append(grip);
    button.dataset.assetId=asset.id;button.draggable=true;
    button.setAttribute('aria-label',asset.name+' を追加。ドラッグで好きな場所にも置けます');
    button.ondragstart=e=>{if(busy){e.preventDefault();return;}draggedAsset=asset.id;e.dataTransfer.setData('application/x-clippo-asset',asset.id);e.dataTransfer.effectAllowed='copy';button.classList.add('source-dragging');};
    button.ondragend=()=>{draggedAsset=null;clearDrop();button.classList.remove('source-dragging');};
    wireMediaTouch(button,asset);
    $('mediaList').append(button);
  }
}
function newClip(asset) { return { id: uid(), assetId: asset.id, in: 0, out: asset.type === 'image' ? 4 : asset.duration, speed: 1, volume: 1, brightness: 1, contrast:1, saturation:1, zoom:1, rotation:0, flipX:false, fadeIn:0, fadeOut:0, transition:{type:'none',duration:.5}, fit: 'contain' }; }
function addAsset(asset,index=project.clips.length,at=time) {
  edit(() => {
    if (asset.type === 'audio') { const item = { id: uid(), assetId: asset.id, start: at, in: 0, out: asset.duration, volume: .65, fadeIn: .2, fadeOut: .5 }; project.music.push(item); selected = { kind: 'music', id: item.id }; }
    else { const item = newClip(asset); project.clips.splice(index,0,item); selected = { kind: 'clips', id: item.id }; }
  });
}
function snapTime(value, exclude=null) {
  if(!snapping)return Math.max(0,value);
  const points=[0,time,...layoutClips(project.clips).flatMap(c=>[c.start,c.end]),...project.texts.filter(t=>t.id!==exclude).flatMap(t=>[t.start,t.end])];
  const closest=points.reduce((best,p)=>Math.abs(p-value)<Math.abs(best-value)?p:best,Infinity);
  return Math.max(0, Math.abs(closest-value)*timelineScale<9?closest:value);
}
function renderTimeline() {
  const target=$('timeline'), scroll=target.scrollLeft; target.replaceChildren();
  const entries=layoutClips(project.clips), total=duration(), scale=timelineScale, width=Math.max(target.clientWidth-40,(total+2)*scale+72);
  const board=document.createElement('div');board.className='timeline-board';board.style.cssText='position:relative;min-width:'+width+'px;padding-left:72px';
  const ruler=document.createElement('div');ruler.className='timeline-ruler';ruler.style.cssText='height:32px;position:relative;touch-action:none';
  for(let second=0;second<=total+2;second+=Math.max(1,Math.ceil(90/scale))){const tick=document.createElement('span');tick.style.cssText='position:absolute;left:'+second*scale+'px';tick.textContent=fmt(second);ruler.append(tick);}
  const seekAt=e=>{stop();time=Math.max(0,Math.min(total,(e.clientX-ruler.getBoundingClientRect().left)/scale));updateTime();renderPreview();};
  ruler.onpointerdown=e=>{if(busy)return;e.preventDefault();ruler.setPointerCapture(e.pointerId);seekAt(e);ruler.onpointermove=seekAt;};
  ruler.onpointerup=ruler.onpointercancel=()=>ruler.onpointermove=null;board.append(ruler);
  for(const [kind,label] of [['clips','映像'],['texts','テロップ'],['music','音楽']]){
    const lanes=[];
    const row=document.createElement('div');row.className='track';row.dataset.kind=kind;row.style.cssText='position:relative;height:76px;margin-bottom:8px';
    const title=document.createElement('span');title.className='track-label';title.textContent=label;title.style.cssText='position:absolute;left:-68px;top:20px';row.append(title);
    project[kind].forEach((item,index)=>{
      const entry=entries[index],start=kind==='clips'?entry.start:item.start,length=kind==='clips'?entry.duration:kind==='texts'?item.end-item.start:item.out-item.in,asset=assets.get(item.assetId);
      let lane=0;if(kind!=='clips'){while(lanes[lane]>start)lane++;lanes[lane]=start+length;row.style.height=Math.max(76,(lane+1)*70+6)+'px';}
      const b=document.createElement('button');b.type='button';b.dataset.id=item.id;b.className='timeline-clip'+(kind==='texts'?' text-clip':kind==='music'?' audio-clip':'')+(selected?.id===item.id?' selected':'');
      b.style.cssText='position:absolute;left:'+start*scale+'px;width:'+Math.max(26,length*scale-3)+'px;height:62px;top:5px;overflow:hidden';
      b.style.top=(5+lane*70)+'px';
      const titleText=kind==='texts'?item.text:asset?.name||'素材';
      b.innerHTML='<span class="clip-name">'+escape(titleText)+'</span><small>'+fmt(length)+(kind==='clips'?' · '+item.speed+'×':'')+'</small>';
      b.title=titleText+' — タップで選択、長押しで移動';
      b.setAttribute('aria-pressed',String(selected?.id===item.id));
      b.oncontextmenu=e=>{e.preventDefault();select(kind,item.id);openClipMenu(e.clientX,e.clientY);};
      if(kind==='clips'&&asset?.thumb){b.style.backgroundImage='linear-gradient(90deg,#142011b0,#14201166),url("'+asset.thumb+'")';b.style.backgroundSize='auto 100%';}
      b.onclick=e=>{e.stopPropagation();if(performance.now()<suppressClickUntil)return;select(kind,item.id);};
      wireClipMove(b,item,kind,start,row,board);
      for(const edge of ['in','out']){
        const handle=document.createElement('span');handle.className='trim-handle trim-'+edge;handle.title=edge==='in'?'開始を調整':'終了を調整';
        handle.onpointerdown=e=>{
          if(busy)return;e.preventDefault();e.stopPropagation();stop();handle.setPointerCapture(e.pointerId);
          const origin=e.clientX, before=clone(item), initialScroll=target.scrollLeft;let changed=false;
          const move=ev=>{
            const delta=(ev.clientX-origin+target.scrollLeft-initialScroll)/scale;
            if(!changed&&Math.abs(ev.clientX-origin)>2){remember();changed=true;}
            if(!changed)return;
            if(kind==='clips'){
              const rate=item.speed, max=asset.type==='image'?600:asset.duration;
              item[edge]=edge==='in'?Math.max(0,Math.min(before.out-.05,before.in+delta*rate)):Math.max(before.in+.05,Math.min(max,before.out+delta*rate));
            }else if(kind==='texts'){
              item[edge==='in'?'start':'end']=edge==='in'?Math.max(0,Math.min(before.end-.05,snapTime(before.start+delta,item.id))):Math.max(before.start+.05,snapTime(before.end+delta,item.id));
            }else if(edge==='in'){
              const shift=Math.max(-Math.min(before.start,before.in),Math.min(before.out-before.in-.05,delta));item.start=before.start+shift;item.in=before.in+shift;
            }else item.out=Math.max(before.in+.05,Math.min(asset.duration,before.out+delta));
            const len=kind==='clips'?clipDuration(item):kind==='texts'?item.end-item.start:item.out-item.in;
            b.style.width=Math.max(26,len*scale-3)+'px';if(kind!=='clips')b.style.left=item.start*scale+'px';
            b.querySelector('small').textContent=fmt(len); time=Math.min(time,duration());updateTime();renderPreview();
          };
          const finish=ev=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',finish);handle.removeEventListener('pointercancel',finish);suppressClickUntil=performance.now()+350;if(ev.type==='pointercancel'&&changed){Object.assign(item,before);past.pop();}selected={kind,id:item.id};refresh();};
          handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);
        };handle.onclick=e=>e.stopPropagation();b.append(handle);
      }
      row.append(b);
      if(kind==='clips'&&index<project.clips.length-1){
        const transition=document.createElement('button');transition.className='transition-button'+(transitionSelection===item.id?' selected':'');transition.style.left=(entry.end-entry.overlap/2)*scale+'px';
        const type=item.transition?.type||'none';transition.textContent=type==='none'?'+':'◈';transition.title='切り替え効果';transition.setAttribute('aria-label','クリップ '+(index+1)+' の切り替え効果');
        transition.dataset.effect=type;
        let activated=false;
        const activate=e=>{e.stopPropagation();if(activated||busy)return;activated=true;stop();selected={kind:'clips',id:item.id};transitionSelection=item.id;renderTimeline();renderInspector();if(innerWidth<=580)setPanel('settings');};
        transition.onclick=activate;transition.onpointerup=e=>{if(e.pointerType==='touch'){e.preventDefault();activate(e);}};row.append(transition);
      }
    });
    if(!project[kind].length){const hint=document.createElement('span');hint.className='empty-track-hint';hint.textContent=kind==='clips'?'素材を追加すると、隙間なくつながります':kind==='texts'?'T テロップを追加':'♫ 音楽を追加';row.append(hint);}
    board.append(row);
  }
  const head=document.createElement('div');head.className='playhead';head.style.cssText='position:absolute;pointer-events:none;top:0;bottom:0;width:2px;left:'+(72+time*scale)+'px';board.append(head);
  board.onclick=e=>{if(busy||performance.now()<suppressClickUntil)return;stop();time=Math.max(0,Math.min(duration(),(e.clientX-board.getBoundingClientRect().left-72)/scale));updateTime();renderPreview();};
  target.append(board);target.scrollLeft=scroll;
  const has=!!selection();for(const id of ['duplicateBtn','deleteBtn','copyBtn','adjustBtn'])if($(id))$(id).disabled=!has||busy;
  document.body.classList.toggle('has-selection',has);
  $('splitBtn').disabled=!project.clips.length||busy;$('moveLeftBtn').disabled=selected?.kind!=='clips'||busy;$('moveRightBtn').disabled=selected?.kind!=='clips'||busy;
  if($('pasteBtn'))$('pasteBtn').disabled=!clipboard||busy;if($('mergeBtn'))$('mergeBtn').disabled=selected?.kind!=='clips'||busy;
  if($('selectionName'))$('selectionName').textContent=has?(selected.kind==='texts'?selection().text:assets.get(selection().assetId)?.name):'クリップを選択して編集';
  for(const id of ['trimStartBtn','trimEndBtn'])if($(id))$(id).disabled=selected?.kind!=='clips'||busy;
}
function wireClipMove(button,item,kind,start,row,board){
  button.onpointerdown=e=>{
    if(busy||e.target.closest('.trim-handle')||e.button>0)return;
    const initialX=e.clientX,initialY=e.clientY,initialScroll=$('timeline').scrollLeft;
    let armed=false,moved=false,destination=-1,newStart=start;
    const arm=()=>{armed=true;button.setPointerCapture(e.pointerId);button.classList.add('dragging');};
    const timer=e.pointerType==='touch'?setTimeout(arm,320):null;
    if(e.pointerType!=='touch')arm();
    const move=ev=>{
      const dx=ev.clientX-initialX,dy=ev.clientY-initialY;
      if(!armed){if(Math.abs(dx)>8||Math.abs(dy)>8)clearTimeout(timer);return;}
      if(Math.abs(dx)<4&&!moved)return;ev.preventDefault();moved=true;
      const container=$('timeline'),rect=container.getBoundingClientRect();if(ev.clientX>rect.right-24)container.scrollLeft+=12;if(ev.clientX<rect.left+90)container.scrollLeft-=12;
      const delta=(dx+container.scrollLeft-initialScroll)/timelineScale;
      if(kind==='clips'){
        button.style.transform='translateX('+(delta*timelineScale)+'px)';
        const point=(ev.clientX-board.getBoundingClientRect().left-72)/timelineScale;
        const entries=layoutClips(project.clips);destination=entries.reduce((best,c,i)=>Math.abs((c.start+c.end)/2-point)<Math.abs((entries[best].start+entries[best].end)/2-point)?i:best,0);
        row.querySelectorAll('.timeline-clip').forEach((b,i)=>b.classList.toggle('drop-target',i===destination&&b!==button));
      }else{newStart=snapTime(start+delta,item.id);button.style.left=newStart*timelineScale+'px';}
    };
    const end=ev=>{
      clearTimeout(timer);button.removeEventListener('pointermove',move);button.removeEventListener('pointerup',end);button.removeEventListener('pointercancel',end);button.classList.remove('dragging');button.style.transform='';
      if(moved&&ev.type!=='pointercancel'){
        suppressClickUntil=performance.now()+400;
        edit(()=>{if(kind==='clips'){const from=project.clips.indexOf(item);if(destination>=0&&from!==destination){project.clips.splice(from,1);project.clips.splice(destination,0,item);}}else{const delta=newStart-item.start;item.start=newStart;if(kind==='texts')item.end+=delta;}selected={kind,id:item.id};});
      }else if(ev.type!=='pointercancel'){selected={kind,id:item.id};transitionSelection=null;renderTimeline();renderInspector();}
      else renderTimeline();
    };
    button.addEventListener('pointermove',move);button.addEventListener('pointerup',end);button.addEventListener('pointercancel',end);
  };
}
function updateTime() { $('scrub').value = time; $('timeDisplay').textContent = fmt(time) + ' / ' + fmt(duration()); const head = document.querySelector('.playhead'); if (head) head.style.left = (72 + time * timelineScale) + 'px'; }
function renderInspector() {
  $('preview').classList.toggle('text-selected',selected?.kind==='texts');
  const panel = $('inspector'), item = selection(); panel.replaceChildren();
  if (!item) { panel.innerHTML = '<div class="empty-inspector">タイムラインの素材を選ぶと、ここで調整できます。</div>'; return; }
  if(transitionSelection===item.id&&selected.kind==='clips'){renderTransitionInspector(panel,item);return;}
  const heading = document.createElement('h3'); heading.className = 'inspector-heading'; heading.textContent = selected.kind === 'texts' ? 'テロップを編集' : assets.get(item.assetId)?.name || '素材を編集'; panel.append(heading);
  const field = (label, key, type, options = {}) => {
    const wrap = document.createElement('label'); wrap.className = 'field';
    const caption = document.createElement('span'); caption.textContent = label; wrap.append(caption);
    const input = document.createElement(type === 'select' ? 'select' : type === 'textarea' ? 'textarea' : 'input');
    input.setAttribute('aria-label',label);
    if (type === 'select') for (const [value, text] of options.choices) { const option = document.createElement('option'); option.value = value; option.textContent = text; input.append(option); }
    else if (type !== 'textarea') input.type = type;
    for (const key of ['min', 'max', 'step']) if (options[key] != null) input[key] = options[key];
    if (type === 'checkbox') input.checked = !!item[key]; else {const value=item[key]??options.default??'';input.value=typeof value==='number'?Number(value.toFixed(3)):value;}
    input.onchange = () => {
      const value = type === 'checkbox' ? input.checked : type === 'number' || type === 'range' ? Number(input.value) : input.value;
      if (typeof value === 'number' && (!Number.isFinite(value) || (options.min != null && value < options.min) || (options.max != null && value > options.max))) { toast('範囲内の数値を入力してください。'); renderInspector(); return; }
      if (key === 'in' && value >= item.out || key === 'out' && value <= item.in || key === 'end' && value <= item.start || key === 'start' && selected.kind === 'texts' && value >= item.end) { toast('終了は開始より後に設定してください。'); renderInspector(); return; }
      edit(() => {item[key] = value;if(key==='position'){delete item.x;delete item.y;}});
    };
    wrap.append(input); panel.append(wrap);
  };
  if (selected.kind === 'texts') {
    field('テキスト', 'text', 'textarea'); field('表示開始（秒）', 'start', 'number', {min:0,step:.1}); field('表示終了（秒）', 'end', 'number', {min:.1,step:.1});
    field('文字サイズ', 'size', 'number', {min:12,max:160,step:1}); field('文字色', 'color', 'color');
    field('配置', 'position', 'select', {choices:[['top','上'],['center','中央'],['bottom','下']]}); field('背景を表示', 'background', 'checkbox');field('文字のフェード（秒）','fade','number',{min:0,max:3,step:.1,default:0});const hint=document.createElement('p');hint.className='inspector-note';hint.textContent='選択中のテロップは、プレビュー上をドラッグして位置を変更できます。';panel.append(hint);
  } else {
    const asset = assets.get(item.assetId), max = asset.type === 'image' ? 600 : asset.duration;
    field('素材の開始（秒）', 'in', 'number', {min:0,max:max,step:.05}); field('素材の終了（秒）', 'out', 'number', {min:.05,max:max,step:.05});
    if (selected.kind === 'clips') {
      field('再生速度', 'speed', 'number', {min:.25,max:4,step:.25}); field('音量（1 = 100%）', 'volume', 'number', {min:0,max:2,step:.1});
      quickPresets(panel,[['ゆっくり',.5],['ふつう',1],['早送り',2]],speed=>edit(()=>item.speed=speed));
      field('画面への収め方', 'fit', 'select', {choices:[['contain','全体を表示'],['cover','画面いっぱい']]});
      field('拡大','zoom','range',{min:1,max:3,step:.05,default:1});
      field('回転','rotation','select',{choices:[[0,'0°'],[90,'90°'],[180,'180°'],[270,'270°']],default:0});
      field('左右反転','flipX','checkbox');
      sectionTitle(panel,'カラー');
      quickPresets(panel,[['標準',{brightness:1,contrast:1,saturation:1}],['鮮やか',{brightness:1.03,contrast:1.1,saturation:1.3}],['シネマ',{brightness:.95,contrast:1.2,saturation:.8}],['モノクロ',{brightness:1,contrast:1.1,saturation:0}]],values=>edit(()=>Object.assign(item,values)));
      field('明るさ（1 = 標準）', 'brightness', 'number', {min:.2,max:2,step:.1});
      field('コントラスト','contrast','range',{min:0,max:2,step:.05,default:1});
      field('彩度','saturation','range',{min:0,max:2,step:.05,default:1});
      sectionTitle(panel,'フェード');
      field('映像と音のフェードイン（秒）','fadeIn','number',{min:0,max:10,step:.1,default:0});
      field('映像と音のフェードアウト（秒）','fadeOut','number',{min:0,max:10,step:.1,default:0});
      const transitionButton=document.createElement('button');transitionButton.className='button full-width';transitionButton.textContent='次のクリップへの切り替え効果';transitionButton.disabled=project.clips.at(-1)===item;transitionButton.onclick=()=>{transitionSelection=item.id;renderInspector();};panel.append(transitionButton);
    } else {
      field('配置開始（秒）', 'start', 'number', {min:0,step:.1}); field('音量（1 = 100%）', 'volume', 'number', {min:0,max:2,step:.05});
      field('フェードイン（秒）', 'fadeIn', 'number', {min:0,max:30,step:.1}); field('フェードアウト（秒）', 'fadeOut', 'number', {min:0,max:30,step:.1});
    }
  }
  // Keep common controls visible; disclose precision controls without removing them.
  if(selected.kind==='clips'){
    const children=[...panel.children],start=children.findIndex(el=>el.classList.contains('inspector-section-title'));
    if(start>=0){const details=document.createElement('details');details.className='advanced-controls';details.open=advancedOpen;const summary=document.createElement('summary');summary.textContent='もっとこだわる · 色とフェード';details.append(summary);for(const node of children.slice(start))details.append(node);details.ontoggle=()=>advancedOpen=details.open;panel.append(details);}
  }
}
const inspectFile=inspectLocalFile;
async function importFiles(files,insertion=null) {
  if (busy || !files.length) return; stop(); busy = true; toast('素材を読み込んでいます…');
  const loaded = [], errors = [];
  $('importReport').hidden=true;
  for (const file of files) { try { loaded.push(await inspectFile(file)); } catch (error) { errors.push(file.name + ': ' + error.message); } }
  let musicSaveFailed=false;for(const asset of loaded.filter(a=>a.type==='audio')){try{await musicStore('put',asset.file);}catch{musicSaveFailed=true;}}
  busy = false;
  if (loaded.length) edit(() => { let index=insertion?.index??project.clips.length;for (const asset of loaded) { assets.set(asset.id, asset); if (asset.type === 'audio') {const item={id:uid(),assetId:asset.id,start:insertion?.time??time,in:0,out:asset.duration,volume:.65,fadeIn:.2,fadeOut:.5};project.music.push(item);selected={kind:'music',id:item.id};} else {const item=newClip(asset);project.clips.splice(index++,0,item);selected={kind:'clips',id:item.id};} } });
  if(loaded.length){setPanel('edit');if(selected?.kind==='clips'){time=layoutClips(project.clips).find(entry=>entry.clip.id===selected.id)?.start||0;updateTime();renderPreview();}}
  if(errors.length){$('importReportMessage').textContent=errors.join('\n');$('importReport').hidden=false;}
  toast(errors.length ? loaded.length+'個を追加。'+errors.length+'個は読み込めませんでした。画面のエラー内容を確認してください。' : loaded.length + '個の素材を追加しました'+(musicSaveFailed?'。音楽の端末保存はできませんでした。プロジェクトを保存してください。':''));
}
$('importBtn').onclick = () => $('mediaInput').click(); $('mediaInput').onchange = async e => { await importFiles([...e.target.files]); e.target.value = ''; };
$('addMusicBtn').onclick = () => { $('mediaInput').accept = 'audio/*,.mp3,.m4a,.wav,.aac'; $('mediaInput').click(); setTimeout(() => $('mediaInput').accept = 'video/*,audio/*,image/*,.mov,.mp4,.m4v,.m4a', 1000); };
$('projectName').onchange = e => edit(() => project.name = e.target.value.trim() || '名称未設定のプロジェクト');
$('aspect').onchange = e => edit(() => project.aspect = e.target.value);
$('scrub').oninput = e => { stop(); time = Number(e.target.value); updateTime(); renderPreview(); };
$('playBtn').onclick = async () => { if (busy || !duration()) return; if (playing) { stop(); return; } if (time >= duration() - .01) time = 0; playing = true; $('playBtn').textContent = 'Ⅱ'; $('playBtn').setAttribute('aria-label','一時停止'); try { await engine.play(project,time,value => { time = value; updateTime(); },error => {stop(); if(error) toast(error.message);}); } catch(error) {stop();toast(error.message);} };
$('undoBtn').onclick = () => { if (!past.length || busy) return; stop(); future.push(clone(project)); project = past.pop(); selected = null; time = Math.min(time,duration()); refresh(); };
$('redoBtn').onclick = () => { if (!future.length || busy) return; stop(); past.push(clone(project)); project = future.pop(); selected = null; refresh(); };
$('splitBtn').onclick = () => {
  const entries=layoutClips(project.clips), active=entries.filter(c=>time>c.start+.05&&time<c.end-.05);
  const entry=active.find(c=>c.clip.id===selected?.id)||active[0];
  if(!entry){toast('クリップの途中に再生位置を合わせてください');return;}
  if(entries.filter(c=>time>=c.start&&time<c.end).length>1){toast('切り替え効果の外側で分割してください。');return;}
  edit(()=>{const clip=entry.clip,index=project.clips.indexOf(clip),cut=clip.in+(time-entry.start)*clip.speed,right={...clone(clip),id:uid(),in:cut,fadeIn:0};clip.out=cut;clip.fadeOut=0;clip.transition={type:'none',duration:.5};project.clips.splice(index+1,0,right);selected={kind:'clips',id:right.id};transitionSelection=null;});
};
$('duplicateBtn').onclick = () => {const item=selection();if(!item)return;edit(()=>{const list=project[selected.kind], copy={...clone(item),id:uid()};list.splice(list.indexOf(item)+1,0,copy);selected={kind:selected.kind,id:copy.id};});};
$('deleteBtn').onclick = () => {const item=selection();if(!item)return;edit(()=>{const list=project[selected.kind];list.splice(list.indexOf(item),1);selected=null;});};
function move(direction){if(selected?.kind!=='clips')return;const index=project.clips.findIndex(c=>c.id===selected.id),to=index+direction;if(to<0||to>=project.clips.length)return;edit(()=>{const [clip]=project.clips.splice(index,1);project.clips.splice(to,0,clip);});}
$('moveLeftBtn').onclick=()=>move(-1);$('moveRightBtn').onclick=()=>move(1);
$('addTextBtn').onclick=()=>{if(!duration()){toast('先に動画または写真を追加してください。');return;}edit(()=>{const start=Math.min(time,duration()-.1),item={id:uid(),text:'ここにテロップを入力',start,end:Math.min(start+3,duration()),size:42,color:'#ffffff',position:'bottom',background:true};project.texts.push(item);selected={kind:'texts',id:item.id};});if(innerWidth<=580)setPanel('settings');};
for(const button of document.querySelectorAll('[data-panel]')) button.onclick=()=>setPanel(button.dataset.panel);
$('helpBtn').onclick=()=>$('helpDialog').showModal();$('closeHelpBtn').onclick=()=>$('helpDialog').close();
$('exportBtn').onclick=()=>{
  stop(); const formats=supportedFormats();$('exportFormat').replaceChildren();
  for(const mime of formats){const option=document.createElement('option');option.value=mime;option.textContent=mime.startsWith('video/mp4')?'MP4 · H.264':'WebM · '+(mime.includes('vp9')?'VP9':'VP8');$('exportFormat').append(option);}
  $('startExportBtn').disabled=!formats.length;$('exportMessage').textContent=formats.length?'書き出し中はこの画面を開いたままにしてください。':'このブラウザは動画書き出しに対応していません。';$('exportProgress').value=0;$('exportResult').replaceChildren();$('exportDialog').showModal();
};
$('closeExportBtn').onclick=()=>{if(!busy)$('exportDialog').close();};
$('cancelExportBtn').onclick=()=>{exportController?.abort();if(!busy)$('exportDialog').close();};
$('exportDialog').addEventListener('cancel',event=>{if(busy){event.preventDefault();exportController?.abort();}});
$('startExportBtn').onclick=async()=>{
  if(busy)return;busy=true;stop();$('startExportBtn').disabled=true;$('closeExportBtn').disabled=true;$('exportResult').replaceChildren();exportController=new AbortController();
  try{
    const mimeType=$('exportFormat').value;
    const blob=await engine.export(project,{height:Number($('exportQuality').value)||720,mimeType,onProgress:value=>{$('exportProgress').max=1;$('exportProgress').value=value;$('exportMessage').textContent='書き出し中 '+Math.round(value*100)+'%';},signal:exportController.signal});
    if(resultUrl)URL.revokeObjectURL(resultUrl);resultUrl=URL.createObjectURL(blob);
    const name=(project.name.replace(/[\\/:*?"<>|]/g,'_')||'clippo')+(blob.type.includes('mp4')?'.mp4':'.webm');
    const link=document.createElement('a');link.href=resultUrl;link.download=name;link.className='primary-button';link.textContent='動画を保存';$('exportResult').append(link);
    const file=new File([blob],name,{type:blob.type});if(navigator.canShare?.({files:[file]})){const share=document.createElement('button');share.textContent='共有・写真に保存';share.onclick=async()=>{try{await navigator.share({files:[file]});}catch(error){if(error.name!=='AbortError')toast('共有できませんでした。動画を保存してください。');}};$('exportResult').append(share);}
    $('exportMessage').textContent='書き出しが完了しました。動画を保存してください。';
  }catch(error){$('exportMessage').textContent=exportController.signal.aborted?'書き出しをキャンセルしました。':'書き出しできませんでした: '+error.message;}
  finally{busy=false;exportController=null;$('startExportBtn').disabled=false;$('closeExportBtn').disabled=false;refresh();}
};
function download(blob,name){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function dataUrl(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});}
$('saveProjectBtn').onclick=async()=>{
  if(busy)return;const used=new Set([...project.clips,...project.music].map(c=>c.assetId));const source=[...assets.values()].filter(a=>used.has(a.id));
  if(source.reduce((sum,a)=>sum+a.file.size,0)>150*1024*1024){toast('素材込み保存は150MBまでです。短い素材に分けてください。');return;}
  busy=true;toast('素材を含めてプロジェクトを保存しています…');
  try{const packed=[];for(const a of source)packed.push({id:a.id,name:a.name,type:a.file.type,data:await dataUrl(a.file)});download(new Blob([JSON.stringify({format:'clippo',version:2,project,assets:packed})],{type:'application/json'}),project.name+'.clippo');toast('素材込みのプロジェクトを保存しました');}catch(error){toast('保存できませんでした: '+error.message);}finally{busy=false;}
};
$('loadProjectBtn').onclick=()=>$('projectInput').click();
$('projectInput').onchange=async event=>{
  const file=event.target.files[0];event.target.value='';if(!file||busy)return;if(file.size>220*1024*1024){toast('プロジェクトファイルが大きすぎます');return;}busy=true;stop();
  const loaded=[];
  try{
    const data=JSON.parse(await file.text()),p=data.project;
    if(data.format!=='clippo'||data.version!==2||!p||!['16:9','9:16','1:1','4:5'].includes(p.aspect)||!Array.isArray(data.assets)||data.assets.length>200||!['clips','texts','music'].every(key=>Array.isArray(p[key])&&p[key].length<=1000))throw new Error('対応するClippoプロジェクトではありません');
    const validNumber=(n,min,max)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
    for(const a of data.assets){if(typeof a.data!=='string'||!/^data:(video\/|audio\/|image\/|application\/octet-stream)/.test(a.data)||typeof a.id!=='string'||!a.data.includes(';base64,'))throw new Error('素材データが不正です');const marker=a.data.indexOf(';base64,'),mime=a.data.slice(5,marker).split(';')[0],bytes=Uint8Array.from(atob(a.data.slice(marker+8)),c=>c.charCodeAt(0));const asset=await inspectFile(new File([bytes],String(a.name),{type:mime}));asset.id=a.id;loaded.push(asset);}
    const map=new Map(loaded.map(a=>[a.id,a]));
    for(const c of p.clips){const a=map.get(c.assetId);if(!a||a.type==='audio'||!validNumber(c.in,0,600000)||!validNumber(c.out,c.in+.001,a.type==='image'?600:a.duration+.1)||!validNumber(c.speed,.25,4)||!validNumber(c.volume,0,2)||!validNumber(c.brightness,.2,2)||!['contain','cover'].includes(c.fit))throw new Error('クリップ設定が不正です');
      if(c.transition&&(!['none','dissolve','black','white','wipe'].includes(c.transition.type)||!validNumber(c.transition.duration,0,5)))throw new Error('切り替え効果が不正です');
      for(const [key,min,max]of [['zoom',1,3],['contrast',0,2],['saturation',0,2],['fadeIn',0,10],['fadeOut',0,10]])if(c[key]!=null&&!validNumber(c[key],min,max))throw new Error('エフェクト設定が不正です');
      if(c.rotation!=null&&![0,90,180,270].includes(Number(c.rotation)))throw new Error('回転設定が不正です');c.id=uid();}
    for(const m of p.music){const a=map.get(m.assetId);if(!a||a.type!=='audio'||!validNumber(m.in,0,a.duration)||!validNumber(m.out,m.in+.001,a.duration+.1)||!validNumber(m.start,0,600000)||!validNumber(m.volume,0,2)||!validNumber(m.fadeIn,0,30)||!validNumber(m.fadeOut,0,30))throw new Error('音楽設定が不正です');m.id=uid();}
    for(const t of p.texts){if(typeof t.text!=='string'||t.text.length>10000||!validNumber(t.start,0,600000)||!validNumber(t.end,t.start+.001,600000)||!validNumber(t.size,12,160)||!/^#[0-9a-f]{6}$/i.test(t.color)||!['top','center','bottom'].includes(t.position))throw new Error('テロップ設定が不正です');for(const k of ['x','y'])if(t[k]!=null&&!validNumber(t[k],0,1))throw new Error('文字位置が不正です');if(t.fade!=null&&!validNumber(t.fade,0,3))throw new Error('文字フェードが不正です');t.id=uid();}
    remember();for(const a of loaded)assets.set(a.id,a);project={version:2,name:String(p.name).slice(0,120),aspect:p.aspect,clips:p.clips,texts:p.texts,music:p.music};selected=null;time=0;toast('プロジェクトを開きました');
  }catch(error){for(const a of loaded)URL.revokeObjectURL(a.url);toast('開けませんでした: '+error.message);}
  finally{busy=false;refresh();}
};
$('demoBtn').onclick=async()=>{
  if(busy)return;const files=[];
  for(const [index,color] of ['#236b62','#6659ad','#c56d45'].entries()){
    const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,1280,720);ctx.fillStyle='#ffffff';ctx.font='bold 100px sans-serif';ctx.fillText(['MAKE','YOUR','STORY'][index],90,345);ctx.font='26px sans-serif';ctx.fillText('CLIPPO / DEMO STILL '+(index+1),96,420);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));files.push(new File([blob],'デモ '+(index+1)+'.png',{type:'image/png'}));
  }
  await importFiles(files);
};
document.addEventListener('keydown',event=>{
  if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)||document.querySelector('dialog[open]'))return;
  if(event.code==='Space'){event.preventDefault();$('playBtn').click();}
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();$(event.shiftKey?'redoBtn':'undoBtn').click();}
  if(event.key==='Delete'||event.key==='Backspace')$('deleteBtn').click();
});
window.addEventListener('beforeunload',event=>{if(project.clips.length||project.music.length){event.preventDefault();event.returnValue='';}});
const zoom=document.createElement('label');zoom.className='timeline-zoom';zoom.innerHTML='表示倍率 <input type="range" min="1" max="140" value="60" aria-label="タイムラインの表示倍率">';zoom.querySelector('input').oninput=e=>{timelineScale=Number(e.target.value);renderTimeline();};document.querySelector('.timeline-heading').append(zoom);

function sectionTitle(panel,title){const h=document.createElement('h4');h.className='inspector-section-title';h.textContent=title;panel.append(h);}
function quickPresets(panel,choices,action){const row=document.createElement('div');row.className='quick-presets';for(const [label,value]of choices){const b=document.createElement('button');b.textContent=label;b.onclick=()=>action(value);row.append(b);}panel.append(row);}
function renderTransitionInspector(panel,item){
  const index=project.clips.indexOf(item),config=item.transition||{type:'none',duration:.5};
  if(index>=project.clips.length-1){transitionSelection=null;renderInspector();return;}
  const options=[['none','カット'],['dissolve','クロスディゾルブ'],['black','暗転'],['white','白フラッシュ'],['wipe','ワイプ']];
  panel.innerHTML='<h3 class="inspector-heading">シーンをつなぐ</h3><p class="panel-summary">隣り合う映像と音を重ねて切り替えます。作品全体の長さは重なった分だけ短くなります。</p>';
  const presets=document.createElement('div');presets.className='transition-presets';
  for(const [type,label]of options){const b=document.createElement('button');b.className=config.type===type?'active':'';b.innerHTML='<span class="effect-symbol effect-'+type+'">◧</span>'+label;b.onclick=()=>edit(()=>item.transition={type,duration:config.duration});presets.append(b);}panel.append(presets);
  const field=document.createElement('label');field.className='field';field.innerHTML='<span>切り替え効果</span>';const select=document.createElement('select');select.setAttribute('aria-label','切り替え効果');for(const [value,label]of options){const o=document.createElement('option');o.value=value;o.textContent=label;select.append(o);}select.value=config.type;select.onchange=()=>edit(()=>item.transition={type:select.value,duration:config.duration});field.append(select);panel.append(field);
  const length=document.createElement('label');length.className='field';length.innerHTML='<span>効果の長さ（秒）</span>';const input=document.createElement('input');input.type='number';input.setAttribute('aria-label','効果の長さ（秒）');input.min=.1;input.max=5;input.step=.1;input.value=config.duration;input.onchange=()=>{const value=Number(input.value);if(!Number.isFinite(value)||value<.1||value>5){toast('0.1〜5秒で指定してください。');return;}edit(()=>item.transition={type:config.type,duration:value});};length.append(input);panel.append(length);
  const actual=transitionDuration(project.clips,index),note=document.createElement('p');note.className='inspector-note';note.textContent='実際の重なり: '+actual.toFixed(2)+'秒。短いクリップでは各素材の半分までに調整されます。';panel.append(note);
  quickPresets(panel,[['効果の中央を見る',0],['クリップ調整に戻る',1]],action=>{if(action){transitionSelection=null;renderInspector();}else{const entry=layoutClips(project.clips)[index];stop();time=entry.end-entry.overlap/2;updateTime();renderPreview();}});
}
const selectionBar=document.createElement('div');selectionBar.className='selection-bar';selectionBar.innerHTML='<span id="selectionName" class="selection-name">クリップを選択して編集</span><div class="selection-actions"><button id="adjustBtn">調整</button><button id="copyBtn">コピー</button><button id="pasteBtn">貼り付け</button><button id="mergeBtn">切れ目を結合</button></div>';
document.querySelector('.timeline-heading').before(selectionBar);
const gestureHint=document.createElement('p');gestureHint.className='timeline-hint';gestureHint.textContent='端をドラッグして長さを調整 · 長押しで移動 · ＋で切り替え効果';document.querySelector('.timeline-heading').after(gestureHint);
$('adjustBtn').onclick=()=>{transitionSelection=null;renderInspector();if(innerWidth<=580)setPanel('settings');else $('inspector').scrollIntoView({block:'nearest'});};
$('copyBtn').onclick=()=>{if(!selection())return;clipboard={kind:selected.kind,item:clone(selection())};renderTimeline();toast('クリップをコピーしました');};
$('pasteBtn').onclick=()=>{if(!clipboard)return;edit(()=>{const {kind}=clipboard,copy={...clone(clipboard.item),id:uid()};if(kind==='clips'){const index=selected?.kind==='clips'?project.clips.findIndex(c=>c.id===selected.id):layoutClips(project.clips).findIndex(c=>time<c.end);project.clips.splice(index<0?project.clips.length:index+1,0,copy);}else{if(kind==='texts'){copy.end=time+(copy.end-copy.start);}copy.start=time;project[kind].push(copy);}selected={kind,id:copy.id};transitionSelection=null;});};
$('mergeBtn').onclick=()=>{
  const index=project.clips.findIndex(c=>c.id===selected?.id);
  const compatible=(a,b)=>a&&b&&a.assetId===b.assetId&&Math.abs(a.out-b.in)<.02&&['speed','volume','brightness','fit','rotation','flipX','contrast','saturation','zoom'].every(k=>(a[k]??({rotation:0,flipX:false,contrast:1,saturation:1,zoom:1}[k]))===(b[k]??({rotation:0,flipX:false,contrast:1,saturation:1,zoom:1}[k])))&&(!a.transition||a.transition.type==='none')&&!(a.fadeOut>0)&&!(b.fadeIn>0);
  const from=compatible(project.clips[index-1],project.clips[index])?index-1:compatible(project.clips[index],project.clips[index+1])?index:-1;
  if(from<0){toast('同じ素材から分割した、設定が同じ連続クリップを選んでください。別の素材も並べるだけでつながります。');return;}
  edit(()=>{const a=project.clips[from],b=project.clips[from+1];a.out=b.out;a.transition=clone(b.transition||{type:'none',duration:.5});a.fadeOut=b.fadeOut||0;project.clips.splice(from+1,1);selected={kind:'clips',id:a.id};});
};
const transport=document.querySelector('.transport');
for(const [id,label,delta,icon]of [['stepBackBtn','1フレーム戻る',-1,'‹'],['stepForwardBtn','1フレーム進む',1,'›']]){const b=document.createElement('button');b.id=id;b.className='frame-button';b.textContent=icon;b.setAttribute('aria-label',label);b.title=label;b.onclick=()=>{if(busy)return;stop();time=Math.max(0,Math.min(duration(),time+delta/30));updateTime();renderPreview();};if(delta<0)$('playBtn').before(b);else $('playBtn').after(b);}
$('scrub').step='0.001';
const fit=document.createElement('button');fit.id='fitTimelineBtn';fit.className='text-button';fit.textContent='全体を表示';fit.onclick=()=>{timelineScale=Math.min(140,Math.max(1,($('timeline').clientWidth-110)/Math.max(1,duration())));zoom.querySelector('input').value=timelineScale;renderTimeline();$('timeline').scrollLeft=0;};document.querySelector('.timeline-heading').append(fit);
const closeInspector=document.createElement('button');closeInspector.className='icon-button inspector-close';closeInspector.textContent='×';closeInspector.setAttribute('aria-label','調整パネルを閉じる');closeInspector.onclick=()=>setPanel('edit');document.querySelector('.inspector-panel .panel-heading').append(closeInspector);
const canvas=$('preview');
canvas.onpointerdown=e=>{
  const item=selection();if(busy||selected?.kind!=='texts'||!item||time<item.start||time>=item.end)return;
  e.preventDefault();stop();canvas.setPointerCapture(e.pointerId);const before=clone(item);let changed=false;
  const move=ev=>{if(!changed){remember();changed=true;}const rect=canvas.getBoundingClientRect(),scale=Math.min(rect.width/canvas.width,rect.height/canvas.height),w=canvas.width*scale,h=canvas.height*scale;item.x=Math.max(.05,Math.min(.95,(ev.clientX-rect.left-(rect.width-w)/2)/w));item.y=Math.max(.05,Math.min(.95,(ev.clientY-rect.top-(rect.height-h)/2)/h));renderPreview();};
  const end=ev=>{canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',end);canvas.removeEventListener('pointercancel',end);if(ev.type==='pointercancel'&&changed){Object.assign(item,before);past.pop();}refresh();};
  canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);
};
document.addEventListener('keydown',e=>{if(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||document.querySelector('dialog[open]'))return;
 if((e.ctrlKey||e.metaKey)&&['c','v','x'].includes(e.key.toLowerCase())){e.preventDefault();if(e.key.toLowerCase()==='v')$('pasteBtn').click();else{$('copyBtn').click();if(e.key.toLowerCase()==='x')$('deleteBtn').click();}}
 if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();$(e.key==='ArrowLeft'?'stepBackBtn':'stepForwardBtn').click();}
 if(e.key.toLowerCase()==='s'&&!e.ctrlKey&&!e.metaKey)$('splitBtn').click();
 if(e.key.toLowerCase()==='q'&&!e.ctrlKey&&!e.metaKey)$('trimStartBtn').click();
 if(e.key.toLowerCase()==='w'&&!e.ctrlKey&&!e.metaKey)$('trimEndBtn').click();
 if(e.key==='Escape'){clearDrop();$('clipMenu').hidden=true;}
});

// A single insertion model is shared by file drops, library drags and touch drags.
function dropPosition(clientX){
  const board=document.querySelector('.timeline-board');
  const at=board?Math.max(0,Math.min(duration(),(clientX-board.getBoundingClientRect().left-72)/timelineScale)):0;
  return {time:at,index:insertionAt(project.clips,at)};
}
function showDrop(clientX,isAudio=false){
  const position=dropPosition(clientX),entries=layoutClips(project.clips);
  const board=document.querySelector('.timeline-board');if(!board)return position;
  let line=$('insertionGuide');if(!line){line=document.createElement('div');line.id='insertionGuide';line.className='insertion-guide';board.append(line);}
  const at=isAudio?position.time:(entries[position.index]?.start??duration());
  line.style.left=(72+at*timelineScale)+'px';line.textContent=isAudio?'ここに音楽':'ここに追加';
  $('timeline').classList.add('drop-ready');return position;
}
function clearDrop(){dropDepth=0;document.body.classList.remove('file-drag');$('insertionGuide')?.remove();$('timeline').classList.remove('drop-ready');}
function isFileDrag(e){return [...(e.dataTransfer?.types||[])].includes('Files');}
document.addEventListener('dragenter',e=>{if(isFileDrag(e)){e.preventDefault();dropDepth++;if(!busy)document.body.classList.add('file-drag');}});
document.addEventListener('dragleave',e=>{if(isFileDrag(e)&&--dropDepth<=0)clearDrop();});
document.addEventListener('dragover',e=>{
  if(!isFileDrag(e)&&!draggedAsset)return;e.preventDefault();e.dataTransfer.dropEffect=busy?'none':'copy';
  if(!busy&&e.target.closest('#timeline')){const rect=$('timeline').getBoundingClientRect();if(e.clientX>rect.right-30)$('timeline').scrollLeft+=12;if(e.clientX<rect.left+50)$('timeline').scrollLeft-=12;showDrop(e.clientX,assets.get(draggedAsset)?.type==='audio');}
  else {$('insertionGuide')?.remove();$('timeline').classList.remove('drop-ready');}
});
document.addEventListener('drop',async e=>{
  const files=[...(e.dataTransfer?.files||[])],asset=assets.get(draggedAsset||e.dataTransfer?.getData('application/x-clippo-asset'));
  if(!files.length&&!asset)return;e.preventDefault();const onTimeline=!!e.target.closest('#timeline'),position=onTimeline?dropPosition(e.clientX):null;clearDrop();draggedAsset=null;
  if(busy)return;
  if(files.length)await importFiles(files,position);
  else if(onTimeline){addAsset(asset,position.index,position.time);toast('この場所に追加しました。元に戻すこともできます。');}
});
window.addEventListener('blur',clearDrop);
function wireMediaTouch(button,asset){
  button.onpointerdown=e=>{
    if(e.pointerType!=='touch'||busy)return;
    let armed=false,ghost,position=null;
    const timer=setTimeout(()=>{armed=true;button.setPointerCapture(e.pointerId);ghost=document.createElement('div');ghost.className='drag-ghost';ghost.textContent=asset.name;document.body.append(ghost);move(e);},350);
    const move=ev=>{
      if(!armed){if(Math.hypot(ev.clientX-e.clientX,ev.clientY-e.clientY)>8)clearTimeout(timer);return;}
      ev.preventDefault();ghost.style.left=ev.clientX+'px';ghost.style.top=ev.clientY+'px';
      if(ev.clientY<80)window.scrollBy(0,-18);else if(ev.clientY>innerHeight-100)window.scrollBy(0,18);
      const rect=$('timeline').getBoundingClientRect();
      position=ev.clientY>=rect.top&&ev.clientY<=rect.bottom?showDrop(ev.clientX,asset.type==='audio'):null;
      if(!position)clearDrop();
    };
    const end=ev=>{clearTimeout(timer);button.removeEventListener('pointermove',move);button.removeEventListener('pointerup',end);button.removeEventListener('pointercancel',end);ghost?.remove();clearDrop();if(armed){ev.preventDefault();button.onclick=()=>{};if(position&&ev.type!=='pointercancel')addAsset(asset,position.index,position.time);else {renderMedia();toast('素材はタップでも追加できます。');}}};
    button.addEventListener('pointermove',move);button.addEventListener('pointerup',end);button.addEventListener('pointercancel',end);
  };
}

const guide=document.createElement('section');guide.className='workflow-guide';guide.setAttribute('aria-label','編集の3ステップ');
guide.innerHTML='<div class="workflow-steps"><button id="guideImport"><b>1</b><span>素材を入れる</span></button><button id="guideEdit"><b>2</b><span>切って並べる</span></button><button id="guideExport"><b>3</b><span>動画にする</span></button></div><p id="guideMessage" role="status"></p>';
document.querySelector('.topbar').after(guide);
$('guideImport').onclick=()=>$('mediaInput').click();$('guideEdit').onclick=()=>{if(!project.clips.length){$('mediaInput').click();return;}setPanel('edit');toast('上の目盛りで場所を選び、「分割」。クリップの端を動かすと短くできます。');};$('guideExport').onclick=()=>$('exportBtn').click();
function updateGuide(){
  if(!$('guideMessage'))return;
  const has=project.clips.length>0;$('guideExport').disabled=!has||busy;$('guideImport').disabled=busy;
  $('guideMessage').textContent=busy?'素材を準備しています…':has?'失敗しても「元に戻す」で大丈夫。できたら右上の「書き出す」。':'まずは動画か写真を選ぼう。パソコンなら、この画面にファイルを落としてもOK。';
  $('guideImport').classList.toggle('done',has);$('guideEdit').classList.toggle('current',has);
}
const welcome=document.createElement('div');welcome.className='welcome-actions';welcome.innerHTML='<button id="welcomeImport" class="button primary">動画・写真を選ぶ</button><button id="welcomeDemo" class="text-button">お手本で試してみる →</button>';$('previewEmpty').append(welcome);
$('welcomeImport').onclick=()=>$('mediaInput').click();$('welcomeDemo').onclick=()=>$('demoBtn').click();
document.querySelector('.panel-caption').textContent='タップで追加。ドラッグなら好きな場所へ。';
document.querySelector('.inspector-panel h2').textContent='クリップの調整';
document.querySelector('#addTextBtn span:last-child').textContent='文字を入れる';
document.querySelector('#addMusicBtn span').textContent='音楽を入れる';
const dropOverlay=document.createElement('div');dropOverlay.className='file-drop-overlay';dropOverlay.innerHTML='<strong>ここに素材をドロップ</strong><span>動画・写真・音楽をまとめて追加できます</span><small>タイムラインに落とすと、その場所に挿入します</small>';document.body.append(dropOverlay);

const extraTools=document.createElement('div');extraTools.className='precision-tools';extraTools.innerHTML='<button id="trimStartBtn" title="再生位置より前を切り落とす（Q）">ここから使う</button><button id="trimEndBtn" title="再生位置より後を切り落とす（W）">ここまで使う</button><button id="snapBtn" aria-pressed="true" title="文字や音楽を映像の切れ目に吸着">ぴたっと合わせる ON</button><button id="moreActionsBtn" aria-label="クリップのその他の操作">その他 ⋯</button>';
document.querySelector('.timeline-toolbar').after(extraTools);
function trimSide(side){
  if(busy||selected?.kind!=='clips')return;
  const candidate=clone(project.clips);
  if(!trimToPlayhead(candidate,selected.id,time,side)){toast('選んだクリップの途中に再生位置を合わせてください。切り替え効果の中は避けてください。');return;}
  const start=layoutClips(project.clips).find(c=>c.clip.id===selected.id).start;
  edit(()=>{project.clips=candidate;if(side==='start')time=start;});toast(side==='start'?'ここより前を切りました。元に戻すこともできます。':'ここより後を切りました。元に戻すこともできます。');
}
$('trimStartBtn').onclick=()=>trimSide('start');$('trimEndBtn').onclick=()=>trimSide('end');
$('snapBtn').onclick=()=>{snapping=!snapping;$('snapBtn').setAttribute('aria-pressed',String(snapping));$('snapBtn').textContent='ぴたっと合わせる '+(snapping?'ON':'OFF');};
const clipMenu=document.createElement('div');clipMenu.id='clipMenu';clipMenu.className='clip-menu';clipMenu.hidden=true;clipMenu.setAttribute('role','group');clipMenu.setAttribute('aria-label','クリップの操作');
for(const [id,label]of [['splitBtn','ここで分割  ·  S'],['trimStartBtn','ここから使う  ·  Q'],['trimEndBtn','ここまで使う  ·  W'],['duplicateBtn','同じものをもう1つ'],['mergeBtn','分割した部分をつなぎ直す'],['copyBtn','コピー'],['pasteBtn','貼り付け'],['deleteBtn','削除']]){const b=document.createElement('button');b.dataset.action=id;b.textContent=label;b.onclick=()=>{clipMenu.hidden=true;$(id).click();};clipMenu.append(b);}document.body.append(clipMenu);
function openClipMenu(x,y){if(busy)return;clipMenu.hidden=false;for(const b of clipMenu.children)b.disabled=$(b.dataset.action).disabled;clipMenu.style.left=Math.max(8,Math.min(x,innerWidth-240))+'px';clipMenu.style.top=Math.max(8,Math.min(y,innerHeight-clipMenu.offsetHeight-12))+'px';clipMenu.querySelector('button:not(:disabled)')?.focus();}
$('moreActionsBtn').onclick=e=>{const r=e.currentTarget.getBoundingClientRect();openClipMenu(r.left,r.bottom);};
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#clipMenu,#moreActionsBtn'))clipMenu.hidden=true;});

const editorAdd=document.createElement('button');editorAdd.id='editorImportBtn';editorAdd.className='button editor-add';editorAdd.textContent='＋ 素材追加';editorAdd.title='編集画面のまま、再生位置の近くに動画・写真・音楽を追加';document.querySelector('.timeline-toolbar').prepend(editorAdd);
const editorInput=document.createElement('input');editorInput.id='editorMediaInput';editorInput.type='file';editorInput.multiple=true;editorInput.accept='video/*,image/*,audio/*,.mov,.mp4,.m4v,.m4a';editorInput.hidden=true;document.body.append(editorInput);
editorAdd.onclick=()=>{if(!busy)editorInput.click();};editorInput.onchange=async e=>{const insertion={index:insertionAt(project.clips,time),time};await importFiles([...e.target.files],insertion);e.target.value='';};
const importReport=document.createElement('div');importReport.id='importReport';importReport.className='import-report';importReport.hidden=true;importReport.setAttribute('role','alert');importReport.innerHTML='<strong>読み込めなかった素材があります</strong><p id="importReportMessage"></p><button class="text-button">閉じる</button>';importReport.querySelector('button').onclick=()=>importReport.hidden=true;document.body.append(importReport);
const closeMedia=document.createElement('button');closeMedia.className='icon-button media-close';closeMedia.textContent='×';closeMedia.setAttribute('aria-label','素材パネルを閉じる');closeMedia.onclick=()=>setPanel('edit');document.querySelector('.media-panel .panel-heading').append(closeMedia);
setPanel('edit');

// Music stays local: built-ins, imported files and beat-maker exports share one shelf.
let audition=null,auditionUrl=null,beatTimer=null;
function stopAudition(){audition?.pause();audition=null;if(auditionUrl)URL.revokeObjectURL(auditionUrl);auditionUrl=null;clearInterval(beatTimer);document.querySelectorAll('.beat-cell.playing').forEach(b=>b.classList.remove('playing'));}
async function previewMusic(file,loop=false){stopAudition();stop();auditionUrl=URL.createObjectURL(file);audition=new Audio(auditionUrl);audition.loop=loop;await audition.play();}
function dialogShell(id,title,copy){const dialog=document.createElement('dialog');dialog.id=id;dialog.innerHTML='<div class="dialog-heading"><div><span class="eyebrow">CLIPPO CREATIVE TOOLS</span><h2>'+title+'</h2></div><button class="icon-button dialog-close" aria-label="閉じる">×</button></div><p class="dialog-description">'+copy+'</p>';dialog.querySelector('.dialog-close').onclick=()=>dialog.close();dialog.addEventListener('close',stopAudition);document.body.append(dialog);return dialog;}
const musicDialog=dialogShell('musicDialog','音楽を選ぼう','お手本を使う、自分の音楽を入れる、リズムをつくる。どれでもOK。');
musicDialog.insertAdjacentHTML('beforeend','<div class="music-actions"><button id="importMusicBtn" class="button">音楽を読み込む</button><button id="openBeatBtn" class="button primary">BGMをつくる</button><button id="stopMusicBtn" class="text-button">試聴を止める</button></div><h3>お手本のBGM</h3><div id="presetMusicList"></div><h3>この端末の音楽</h3><div id="savedMusicList"></div><p class="inspector-note">このブラウザ内に保存します。別の端末とは共有されません。ブラウザのデータ削除や容量不足で消える場合があるため、大切な音楽は元ファイルも保管してください。</p><input id="localMusicInput" type="file" accept="audio/*,.wav,.mp3,.m4a,.aac" multiple hidden>');
const presetFiles=new Map();function presetFile(style){if(!presetFiles.has(style))presetFiles.set(style,makePresetMusic(style));return presetFiles.get(style);}
async function audioAsset(file){const existing=[...assets.values()].find(a=>a.type==='audio'&&a.file.name===file.name&&a.file.size===file.size&&a.file.lastModified===file.lastModified);if(existing)return existing;const asset=await inspectFile(file);assets.set(asset.id,asset);return asset;}
function fillMusic(asset,total,start=0){const result=[];for(let at=start;at<total;at+=asset.duration){result.push({id:uid(),assetId:asset.id,start:at,in:0,out:Math.min(asset.duration,total-at),volume:.35,fadeIn:at===start?.15:0,fadeOut:at+asset.duration>=total?.5:0});}return result;}
async function placeMusic(file){if(busy)return;try{const asset=await audioAsset(file);edit(()=>{const list=fillMusic(asset,duration()>time?duration():time+asset.duration,time);project.music.push(...list);selected={kind:'music',id:list[0].id};});musicDialog.close();toast('音楽を追加しました。音量や長さは「調整」で変えられます。');}catch(error){toast(error.message);}}
function musicRow(file,key){const row=document.createElement('div');row.className='music-row';row.innerHTML='<span>'+escape(file.name.replace(/\.wav$/i,''))+'</span><button class="text-button">試聴</button><button class="button">追加</button>';
  row.children[1].onclick=()=>previewMusic(file).catch(e=>toast(e.message));row.children[2].onclick=()=>placeMusic(file);
  if(key){const remove=document.createElement('button');remove.className='text-button';remove.textContent='端末から削除';remove.onclick=async()=>{if(!confirm('「'+file.name+'」を端末の音楽棚から削除しますか？元ファイルや現在の編集内容は残ります。'))return;try{await musicStore('remove',{key});await refreshMusic();}catch{toast('削除できませんでした。');}};row.append(remove);}return row;
}
async function refreshMusic(){
  $('presetMusicList').replaceChildren(...['bright','calm'].map(style=>musicRow(presetFile(style))));
  try{const saved=await musicStore('list');$('savedMusicList').replaceChildren(...saved.map(track=>musicRow(track.file,track.key)));if(!saved.length)$('savedMusicList').innerHTML='<p class="shelf-empty">読み込んだ音楽と、つくったBGMがここに並びます。</p>';}
  catch{$('savedMusicList').textContent='このブラウザでは端末保存を利用できません。音楽の読み込みはできます。';}
}
$('addMusicBtn').onclick=()=>{refreshMusic();musicDialog.showModal();};$('importMusicBtn').onclick=()=>$('localMusicInput').click();$('stopMusicBtn').onclick=stopAudition;
$('localMusicInput').onchange=async e=>{const files=[...e.target.files];e.target.value='';for(const file of files){try{await audioAsset(file);try{await musicStore('put',file);}catch{toast('端末保存ができませんでした。素材一覧から今回の編集には使えます。');}}catch(error){toast(file.name+': '+error.message);}}renderMedia();refreshMusic();};

const templateDialog=dialogShell('templateDialog','テンプレートでつくる','長さ・つなぎ・文字・BGMをまとめて配置。できあがった後は、自由に直せます。');
templateDialog.insertAdjacentHTML('beforeend','<div id="templateCards" class="template-cards"></div><label class="field"><span>最初に出すタイトル</span><input id="templateTitle" maxlength="100"></label><button id="templateFilesBtn" class="button full-width">動画・写真を選ぶ</button><input id="templateFiles" type="file" accept="video/*,image/*,.mov,.mp4" multiple hidden><p id="templateSources" class="inspector-note"></p><label class="field"><span>BGM</span><select id="templateMusic"><option value="preset">テンプレートのお手本BGM</option><option value="none">音楽なし</option></select></label><p class="inspector-note">選んだ順に最大12素材を使用。各素材の冒頭をテンプレートの長さで使います。自動でベストシーンを探す機能ではありません。今の編集は置き換わりますが「元に戻す」で戻せます。</p><button id="applyTemplateBtn" class="button primary full-width">この内容で動画をつくる</button><p id="templateStatus" role="status"></p>');
let templateChoice=templates[0],templateSaved=[];
for(const item of templates){const b=document.createElement('button');b.className='template-card';b.dataset.template=item.id;b.innerHTML='<span class="template-art art-'+item.id+'">'+({travel:'↗',short:'▶',diary:'☀'}[item.id])+'</span><strong>'+item.name+'</strong><small>'+item.tag+'</small><p>'+item.description+'</p>';b.onclick=()=>{templateChoice=item;$('templateTitle').value=item.title;for(const card of $('templateCards').children)card.setAttribute('aria-pressed',String(card===b));};$('templateCards').append(b);}
async function openTemplates(){
  $('templateFiles').value='';$('templateSources').textContent='新しく素材を選ぶか、読み込み済みの映像・写真を使います。';$('templateStatus').textContent='';$('templateCards').firstChild.click();
  $('templateMusic').innerHTML='<option value="preset">テンプレートのお手本BGM</option><option value="none">音楽なし</option>';
  try{templateSaved=await musicStore('list');for(const [i,track]of templateSaved.entries()){const o=document.createElement('option');o.value='saved:'+i;o.textContent=track.name;$('templateMusic').append(o);}}catch{templateSaved=[];}
  templateDialog.showModal();
}
$('templateFilesBtn').onclick=()=>$('templateFiles').click();$('templateFiles').onchange=e=>$('templateSources').textContent=e.target.files.length+'個の素材をセットしました（最大12個）';
$('applyTemplateBtn').onclick=async()=>{
  if(busy)return;const button=$('applyTemplateBtn');button.disabled=true;const loaded=[];
  try{
    const files=[...$('templateFiles').files].slice(0,12);
    if(files.length)for(const file of files){const asset=await inspectFile(file);if(asset.type==='audio'){URL.revokeObjectURL(asset.url);throw new Error('ここには動画・写真を選んでください。音楽はBGM欄から選べます。');}loaded.push(asset);}
    const sources=files.length?loaded:[...assets.values()].filter(a=>a.type!=='audio').slice(0,12);
    if(!sources.length)throw new Error('まず「動画・写真を選ぶ」から素材をセットしてください。');
    const mode=$('templateMusic').value,music=mode==='none'?null:await audioAsset(mode==='preset'?presetFile(templateChoice.music):templateSaved[Number(mode.split(':')[1])].file);
    edit(()=>{for(const asset of loaded)assets.set(asset.id,asset);project.name=templateChoice.name;project.aspect=templateChoice.aspect;project.clips=sources.map(asset=>({...newClip(asset),out:Math.min(asset.type==='image'?templateChoice.seconds:asset.duration,templateChoice.seconds),fit:templateChoice.aspect==='9:16'?'cover':'contain',transition:{type:templateChoice.effect,duration:.35}}));project.texts=[];const total=duration();if($('templateTitle').value.trim())project.texts.push({id:uid(),text:$('templateTitle').value.trim(),start:0,end:Math.min(3,total),size:54,color:templateChoice.color,position:'bottom',background:true,fade:.25});project.music=music?fillMusic(music,total):[];time=0;selected={kind:'clips',id:project.clips[0].id};transitionSelection=null;});
    templateDialog.close();$('fitTimelineBtn').click();toast('できあがり！ 再生してみよう。文字や順番はあとから変えられます。');
  }catch(error){for(const asset of loaded)if(!assets.has(asset.id))URL.revokeObjectURL(asset.url);$('templateStatus').textContent=error.message;}finally{button.disabled=false;}
};
for(const parent of [document.querySelector('.media-footer'),document.querySelector('.welcome-actions')]){const b=document.createElement('button');b.className='button template-launch';b.textContent='テンプレートでつくる';b.onclick=openTemplates;parent.prepend(b);}

const beatDialog=dialogShell('beatDialog','かんたんBGMづくり','光っているマスで音が鳴ります。お手本を選んで、好きな音を足したり消したりしよう。');
beatDialog.insertAdjacentHTML('beforeend','<div class="beat-options"><label>お手本 <select id="beatPreset"><option value="pop">ポップ</option><option value="chill">ゆったり</option><option value="dance">ダンス</option></select></label><label>速さ <select id="beatTempo"><option value="90">ゆっくり</option><option value="110" selected>ふつう</option><option value="130">はやい</option></select></label></div><div id="beatGrid" class="beat-grid"></div><p class="inspector-note">4拍のリズムを8回くり返して保存します。ベースの音程はおまかせ。音の重なりは自動で抑えます。</p><div class="music-actions"><button id="playBeatBtn" class="button">▶ 聴いてみる</button><button id="stopBeatBtn" class="button">■ 止める</button><button id="saveBeatBtn" class="button primary">保存して動画に使う</button></div><label class="replace-music"><input id="replaceBeatMusic" type="checkbox" checked> 今の音楽と入れ替える（元に戻せます）</label><p id="beatStatus" role="status"></p>');
let pattern=beatPattern('pop');
function drawBeat(){
  const grid=$('beatGrid');grid.replaceChildren();
  for(const [lane,[key,name]]of beatTracks.entries()){const row=document.createElement('div');row.className='beat-row';const label=document.createElement('strong');label.textContent=name;row.append(label);const cells=document.createElement('div');cells.className='beat-cells';
    for(let step=0;step<16;step++){const cell=document.createElement('button');cell.className='beat-cell';cell.dataset.step=step;cell.setAttribute('aria-label',name+' '+(step+1)+'番目');cell.setAttribute('aria-pressed',String(pattern[lane][step]));cell.textContent=step%4===0?String(step/4+1):'·';cell.onclick=()=>{stopAudition();pattern[lane][step]=!pattern[lane][step];cell.setAttribute('aria-pressed',String(pattern[lane][step]));};cells.append(cell);}row.append(cells);grid.append(row);}
}
$('openBeatBtn').onclick=()=>{musicDialog.close();drawBeat();$('beatStatus').textContent='';beatDialog.showModal();};
$('beatPreset').onchange=e=>{stopAudition();pattern=beatPattern(e.target.value);drawBeat();};$('beatTempo').onchange=stopAudition;
$('playBeatBtn').onclick=async()=>{try{const bpm=Number($('beatTempo').value);await previewMusic(renderBeat(pattern,bpm),true);beatTimer=setInterval(()=>{const step=Math.floor((audition?.currentTime||0)/(60/bpm/4))%16;document.querySelectorAll('.beat-cell').forEach(cell=>cell.classList.toggle('playing',Number(cell.dataset.step)===step));},50);}catch(error){$('beatStatus').textContent=error.message;}};
$('stopBeatBtn').onclick=stopAudition;
$('saveBeatBtn').onclick=async()=>{const button=$('saveBeatBtn');if(!pattern.some(row=>row.some(Boolean))){$('beatStatus').textContent='音がまだありません。マスを押して音を入れてみよう。';return;}button.disabled=true;try{const file=renderBeat(pattern,Number($('beatTempo').value));const asset=await audioAsset(file);let saved=true;try{await musicStore('put',file);}catch{saved=false;}edit(()=>{const music=fillMusic(asset,duration()||asset.duration);if($('replaceBeatMusic').checked)project.music=[];project.music.push(...music);selected={kind:'music',id:music[0].id};});beatDialog.close();toast(saved?'BGMを動画に追加し、この端末の音楽にも保存しました。':'動画に追加しました。端末保存はできなかったため、プロジェクトを保存してください。');}catch(error){$('beatStatus').textContent=error.message;}finally{button.disabled=false;}};
refresh();
