import { EditorEngine, supportedFormats } from './engine.js';
import { clipDuration, layoutClips, projectDuration, transitionDuration } from './timeline.js';

const $ = id => document.getElementById(id);
const assets = new Map();
let project = { version: 2, name: '名称未設定のプロジェクト', aspect: '16:9', clips: [], texts: [], music: [] };
let selected = null, time = 0, playing = false, busy = false, exportController = null, resultUrl = null;
let past = [], future = [], renderPending = false, renderAgain = false, toastTimer;
let timelineScale=60, clipboard=null, transitionSelection=null, suppressClickUntil=0;
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
function setPanel(name){ document.body.dataset.panel=name; for(const tab of document.querySelectorAll('[data-panel]')){tab.classList.toggle('active',tab.dataset.panel===name);tab.setAttribute('aria-pressed',String(tab.dataset.panel===name));} if(innerWidth<=580)document.querySelector(name==='edit'?'.timeline-panel':`[data-panel-view="${name}"]`)?.scrollIntoView({behavior:'smooth',block:'start'}); }
async function renderPreview() {
  if (renderPending) { renderAgain = true; return; }
  renderPending = true;
  try { await engine.render(project, time); } catch (error) { console.warn(error); toast('プレビューを表示できません。素材の形式をご確認ください。'); }
  finally { renderPending = false; if (renderAgain) { renderAgain = false; renderPreview(); } }
}
function refresh() {
  if(!busy){const [w,h]=project.aspect.split(':').map(Number); const height=540,width=Math.round(height*w/h);if($('preview').width!==width||$('preview').height!==height){$('preview').width=width;$('preview').height=height;}}
  $('projectName').value = project.name;
  $('aspect').value = project.aspect;
  $('previewEmpty').hidden = project.clips.length > 0;
  $('scrub').max = duration(); $('scrub').value = time;
  $('timeDisplay').textContent = fmt(time) + ' / ' + fmt(duration());
  $('undoBtn').disabled = !past.length || busy; $('redoBtn').disabled = !future.length || busy;
  $('exportBtn').disabled = !project.clips.length || busy;
  renderMedia(); renderTimeline(); renderInspector(); renderPreview();
}
function renderMedia() {
  $('mediaList').replaceChildren();
  if(!assets.size)$('mediaList').innerHTML='<div class="media-empty"><p>ここから、あなたの作品を。</p><span>動画・写真・音楽を追加してください。</span></div>';
  for (const asset of assets.values()) {
    const button = document.createElement('button'); button.className = 'media-card'; button.type = 'button';
    button.title = asset.name + ' — タイムラインに追加';
    button.innerHTML = '<div class="media-thumb">' + (asset.thumb ? '<img alt="" src="' + asset.thumb + '">' : '<span>♫</span>') + '<span class="media-duration">' + fmt(asset.duration) + '</span></div><span>' + escape(asset.name) + '</span>';
    button.onclick = () => addAsset(asset);
    $('mediaList').append(button);
  }
}
function newClip(asset) { return { id: uid(), assetId: asset.id, in: 0, out: asset.type === 'image' ? 4 : asset.duration, speed: 1, volume: 1, brightness: 1, contrast:1, saturation:1, zoom:1, rotation:0, flipX:false, fadeIn:0, fadeOut:0, transition:{type:'none',duration:.5}, fit: 'contain' }; }
function addAsset(asset) {
  edit(() => {
    if (asset.type === 'audio') { const item = { id: uid(), assetId: asset.id, start: time, in: 0, out: asset.duration, volume: .65, fadeIn: .2, fadeOut: .5 }; project.music.push(item); selected = { kind: 'music', id: item.id }; }
    else { const item = newClip(asset); project.clips.push(item); selected = { kind: 'clips', id: item.id }; }
  });
}
function snapTime(value, exclude=null) {
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
    const row=document.createElement('div');row.className='track';row.dataset.kind=kind;row.style.cssText='position:relative;height:76px;margin-bottom:8px';
    const title=document.createElement('span');title.className='track-label';title.textContent=label;title.style.cssText='position:absolute;left:-68px;top:20px';row.append(title);
    project[kind].forEach((item,index)=>{
      const entry=entries[index],start=kind==='clips'?entry.start:item.start,length=kind==='clips'?entry.duration:kind==='texts'?item.end-item.start:item.out-item.in,asset=assets.get(item.assetId);
      const b=document.createElement('button');b.type='button';b.dataset.id=item.id;b.className='timeline-clip'+(kind==='texts'?' text-clip':kind==='music'?' audio-clip':'')+(selected?.id===item.id?' selected':'');
      b.style.cssText='position:absolute;left:'+start*scale+'px;width:'+Math.max(26,length*scale-3)+'px;height:62px;top:5px;overflow:hidden';
      const titleText=kind==='texts'?item.text:asset?.name||'素材';
      b.innerHTML='<span class="clip-name">'+escape(titleText)+'</span><small>'+fmt(length)+(kind==='clips'?' · '+item.speed+'×':'')+'</small>';
      b.title=titleText+' — タップで選択、長押しで移動';
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
  $('splitBtn').disabled=!project.clips.length||busy;$('moveLeftBtn').disabled=selected?.kind!=='clips'||busy;$('moveRightBtn').disabled=selected?.kind!=='clips'||busy;
  if($('pasteBtn'))$('pasteBtn').disabled=!clipboard||busy;if($('mergeBtn'))$('mergeBtn').disabled=selected?.kind!=='clips'||busy;
  if($('selectionName'))$('selectionName').textContent=has?(selected.kind==='texts'?selection().text:assets.get(selection().assetId)?.name):'クリップを選択して編集';
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
    if (type === 'checkbox') input.checked = !!item[key]; else input.value = item[key] ?? options.default ?? '';
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
}
async function inspectFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const type = file.type.startsWith('audio/') || ['mp3','m4a','wav','aac','ogg','flac'].includes(ext) ? 'audio' : file.type.startsWith('image/') || ['jpg','jpeg','png','webp','gif'].includes(ext) ? 'image' : 'video';
  const url = URL.createObjectURL(file), asset = {id:uid(),file,url,name:file.name,type,duration:4,width:0,height:0,thumb:null};
  try {
    const element = type === 'image' ? new Image() : document.createElement(type);
    if (type !== 'image') { element.preload = 'auto'; element.muted = true; element.playsInline = true; }
    await new Promise((resolve,reject) => { const timeout = setTimeout(() => reject(new Error('読み込みが時間内に完了しませんでした')), 20000); const cleanup = () => { clearTimeout(timeout); element.onload = null; element.onloadeddata = null; element.onerror = null; }; const ready = () => { cleanup(); resolve(); }; element.onload = ready; element.onloadeddata = ready; element.onerror = () => {cleanup();reject(new Error('このブラウザでは再生できない形式です'));}; element.src = url; });
    if (type !== 'image') { if (!Number.isFinite(element.duration) || element.duration <= 0) throw new Error('長さを取得できませんでした'); asset.duration = element.duration; }
    asset.width = element.videoWidth || element.naturalWidth || 0; asset.height = element.videoHeight || element.naturalHeight || 0;
    if (type !== 'audio') { const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 144; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#141821'; ctx.fillRect(0,0,256,144); const ratio = Math.min(256/asset.width,144/asset.height); ctx.drawImage(element,(256-asset.width*ratio)/2,(144-asset.height*ratio)/2,asset.width*ratio,asset.height*ratio); asset.thumb = canvas.toDataURL('image/jpeg',.75); }
    if (type !== 'image') { element.removeAttribute('src'); element.load(); }
    return asset;
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}
async function importFiles(files) {
  if (busy || !files.length) return; stop(); busy = true; toast('素材を読み込んでいます…');
  const loaded = [], errors = [];
  for (const file of files) { try { loaded.push(await inspectFile(file)); } catch (error) { errors.push(file.name + ': ' + error.message); } }
  busy = false;
  if (loaded.length) edit(() => { for (const asset of loaded) { assets.set(asset.id, asset); if (asset.type === 'audio') project.music.push({id:uid(),assetId:asset.id,start:time,in:0,out:asset.duration,volume:.65,fadeIn:.2,fadeOut:.5}); else project.clips.push(newClip(asset)); } if (project.clips.length) selected = {kind:'clips',id:project.clips.at(-1).id}; });
  toast(errors.length ? errors.join(' / ') + '。HEVC素材は対応するSafariをお試しください。' : loaded.length + '個の素材を追加しました');
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
});
refresh();
