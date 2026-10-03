import { EditorEngine, supportedFormats } from './engine.js';

const $ = id => document.getElementById(id);
const assets = new Map();
let project = { version: 2, name: '名称未設定のプロジェクト', aspect: '16:9', clips: [], texts: [], music: [] };
let selected = null, time = 0, playing = false, busy = false, exportController = null, resultUrl = null;
let past = [], future = [], renderPending = false, renderAgain = false, toastTimer;
let timelineScale=60;
const engine = new EditorEngine($('preview'), assets);
$('projectInput').accept='.clippo,.json,application/json';
$('mediaInput').accept='video/*,audio/*,image/*,.mov,.m4v,.mp4,.m4a';
$('saveProjectBtn').setAttribute('aria-label','素材込みでプロジェクトを保存');
const uid = () => crypto.randomUUID();
const clone = value => JSON.parse(JSON.stringify(value));
const duration = () => project.clips.reduce((sum, c) => sum + (c.out - c.in) / c.speed, 0);
const fmt = value => { const s = Math.max(0, Number(value) || 0); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + (s % 60).toFixed(1).padStart(4, '0'); };
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toast = message => { $('toast').textContent = message; $('toast').hidden = false; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; $('toast').classList.remove('visible'); }, 4500); };
function stop() { engine.pause(); playing = false; $('playBtn').textContent = '▶'; $('playBtn').setAttribute('aria-label', '再生'); }
function remember() { stop(); past.push(clone(project)); if (past.length > 60) past.shift(); future = []; }
function edit(fn) { if (busy) return; remember(); fn(); time = Math.min(time, duration()); refresh(); }
function selection() { if (!selected) return null; return project[selected.kind].find(item => item.id === selected.id); }
function select(kind, id) { selected = { kind, id }; renderTimeline(); renderInspector(); if(innerWidth<=580)setPanel('settings'); }
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
function newClip(asset) { return { id: uid(), assetId: asset.id, in: 0, out: asset.type === 'image' ? 4 : asset.duration, speed: 1, volume: 1, brightness: 1, fit: 'contain' }; }
function addAsset(asset) {
  edit(() => {
    if (asset.type === 'audio') { const item = { id: uid(), assetId: asset.id, start: time, in: 0, out: asset.duration, volume: .65, fadeIn: .2, fadeOut: .5 }; project.music.push(item); selected = { kind: 'music', id: item.id }; }
    else { const item = newClip(asset); project.clips.push(item); selected = { kind: 'clips', id: item.id }; }
  });
}
function renderTimeline() {
  const target = $('timeline'); target.replaceChildren();
  const total = duration(), scale = timelineScale, width = Math.max(560, (total + 2) * scale);
  const board = document.createElement('div'); board.style.cssText = 'position:relative;min-width:' + width + 'px;padding-left:72px';
  const ruler = document.createElement('div'); ruler.className = 'timeline-ruler'; ruler.style.cssText = 'height:28px;position:relative';
  for (let second = 0; second <= total + 2; second += Math.max(1,Math.ceil(90/scale))) { const tick = document.createElement('span'); tick.style.cssText = 'position:absolute;left:' + second * scale + 'px;font-size:10px'; tick.textContent = fmt(second); ruler.append(tick); }
  board.append(ruler);
  const track = (label, items, kind) => {
    const row = document.createElement('div'); row.className = 'track'; row.style.cssText = 'position:relative;height:68px;margin-bottom:8px';
    const title = document.createElement('span'); title.className = 'track-label'; title.textContent = label; title.style.cssText = 'position:absolute;left:-68px;top:20px'; row.append(title);
    let offset = 0;
    for (const item of items) {
      const start = kind === 'clips' ? offset : item.start;
      const length = kind === 'texts' ? item.end - item.start : (item.out - item.in) / (item.speed || 1);
      const asset = assets.get(item.assetId);
      const button = document.createElement('button'); button.type = 'button';
      button.className = 'timeline-clip' + (kind === 'texts' ? ' text-clip' : kind === 'music' ? ' audio-clip' : '') + (selected?.id === item.id ? ' selected' : '');
      button.style.cssText = 'position:absolute;left:' + start * scale + 'px;width:' + Math.max(24, length * scale - 3) + 'px;height:58px;top:4px;overflow:hidden';
      button.textContent = kind === 'texts' ? item.text : asset?.name || '素材'; button.title = button.textContent;
      if(kind==='clips'&&asset?.thumb){button.style.backgroundImage=`linear-gradient(90deg,#14201199,#14201155),url("${asset.thumb}")`;button.style.backgroundSize='auto 100%';}
      const lengthLabel=document.createElement('small');lengthLabel.textContent=fmt(length)+(kind==='clips'?' · '+item.speed+'×':'');button.append(lengthLabel);
      button.onclick = event => { event.stopPropagation(); select(kind, item.id); };
      if (kind === 'clips') {
        button.draggable = true; button.ondragstart = e => e.dataTransfer.setData('text/plain', item.id);
        button.ondragover = e => e.preventDefault();
        button.ondrop = e => { e.preventDefault(); const source = e.dataTransfer.getData('text/plain'); const from = project.clips.findIndex(c => c.id === source), to = project.clips.findIndex(c => c.id === item.id); if (from >= 0 && from !== to) edit(() => { const [clip] = project.clips.splice(from, 1); project.clips.splice(to, 0, clip); }); };
        for(const edge of ['in','out']){const handle=document.createElement('span');handle.className='trim-handle trim-'+edge;handle.title=edge==='in'?'開始位置をドラッグで調整':'終了位置をドラッグで調整';handle.onpointerdown=e=>{if(busy)return;e.preventDefault();e.stopPropagation();button.draggable=false;handle.setPointerCapture(e.pointerId);const origin=e.clientX,before=item[edge],oldWidth=button.style.width;remember();const move=ev=>{const delta=(ev.clientX-origin)/scale*item.speed;item[edge]=edge==='in'?Math.max(0,Math.min(item.out-.05,before+delta)):Math.max(item.in+.05,Math.min(asset.type==='image'?600:asset.duration,before+delta));button.style.width=Math.max(24,(item.out-item.in)/item.speed*scale-3)+'px';};const end=()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',end);handle.removeEventListener('pointercancel',end);button.draggable=true;selected={kind,id:item.id};time=Math.min(time,duration());refresh();};handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);};handle.onclick=e=>e.stopPropagation();button.append(handle);}
      }
      row.append(button); offset += length;
    }
    board.append(row);
  };
  track('映像', project.clips, 'clips'); track('テロップ', project.texts, 'texts'); track('音楽', project.music, 'music');
  const head = document.createElement('div'); head.className = 'playhead'; head.style.cssText = 'position:absolute;pointer-events:none;top:0;bottom:0;width:2px;background:#ff805c;left:' + (72 + time * scale) + 'px'; board.append(head);
  board.onclick = event => { const rect = board.getBoundingClientRect(); stop(); time = Math.max(0, Math.min(duration(), (event.clientX - rect.left - 72) / scale)); updateTime(); renderPreview(); };
  target.append(board);
  const has = !!selection(); for (const id of ['duplicateBtn', 'deleteBtn']) $(id).disabled = !has || busy;
  $('splitBtn').disabled = !project.clips.length || busy; $('moveLeftBtn').disabled = selected?.kind !== 'clips' || busy; $('moveRightBtn').disabled = selected?.kind !== 'clips' || busy;
}
function updateTime() { $('scrub').value = time; $('timeDisplay').textContent = fmt(time) + ' / ' + fmt(duration()); const head = document.querySelector('.playhead'); if (head) head.style.left = (72 + time * timelineScale) + 'px'; }
function renderInspector() {
  const panel = $('inspector'), item = selection(); panel.replaceChildren();
  if (!item) { panel.innerHTML = '<div class="empty-inspector">タイムラインの素材を選ぶと、ここで調整できます。</div>'; return; }
  const heading = document.createElement('h3'); heading.className = 'inspector-heading'; heading.textContent = selected.kind === 'texts' ? 'テロップを編集' : assets.get(item.assetId)?.name || '素材を編集'; panel.append(heading);
  const field = (label, key, type, options = {}) => {
    const wrap = document.createElement('label'); wrap.className = 'field';
    const caption = document.createElement('span'); caption.textContent = label; wrap.append(caption);
    const input = document.createElement(type === 'select' ? 'select' : type === 'textarea' ? 'textarea' : 'input');
    if (type === 'select') for (const [value, text] of options.choices) { const option = document.createElement('option'); option.value = value; option.textContent = text; input.append(option); }
    else if (type !== 'textarea') input.type = type;
    for (const key of ['min', 'max', 'step']) if (options[key] != null) input[key] = options[key];
    if (type === 'checkbox') input.checked = !!item[key]; else input.value = item[key];
    input.onchange = () => {
      const value = type === 'checkbox' ? input.checked : type === 'number' || type === 'range' ? Number(input.value) : input.value;
      if (typeof value === 'number' && (!Number.isFinite(value) || (options.min != null && value < options.min) || (options.max != null && value > options.max))) { toast('範囲内の数値を入力してください。'); renderInspector(); return; }
      if (key === 'in' && value >= item.out || key === 'out' && value <= item.in || key === 'end' && value <= item.start || key === 'start' && selected.kind === 'texts' && value >= item.end) { toast('終了は開始より後に設定してください。'); renderInspector(); return; }
      edit(() => item[key] = value);
    };
    wrap.append(input); panel.append(wrap);
  };
  if (selected.kind === 'texts') {
    field('テキスト', 'text', 'textarea'); field('表示開始（秒）', 'start', 'number', {min:0,step:.1}); field('表示終了（秒）', 'end', 'number', {min:.1,step:.1});
    field('文字サイズ', 'size', 'number', {min:12,max:160,step:1}); field('文字色', 'color', 'color');
    field('配置', 'position', 'select', {choices:[['top','上'],['center','中央'],['bottom','下']]}); field('背景を表示', 'background', 'checkbox');
  } else {
    const asset = assets.get(item.assetId), max = asset.type === 'image' ? 600 : asset.duration;
    field('素材の開始（秒）', 'in', 'number', {min:0,max:max,step:.05}); field('素材の終了（秒）', 'out', 'number', {min:.05,max:max,step:.05});
    if (selected.kind === 'clips') {
      field('再生速度', 'speed', 'number', {min:.25,max:4,step:.25}); field('音量（1 = 100%）', 'volume', 'number', {min:0,max:2,step:.1});
      field('明るさ（1 = 標準）', 'brightness', 'number', {min:.2,max:2,step:.1}); field('画面への収め方', 'fit', 'select', {choices:[['contain','全体を表示'],['cover','画面いっぱい']]});
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
  let start = 0, index = -1;
  for (let i=0;i<project.clips.length;i++) { const end = start+(project.clips[i].out-project.clips[i].in)/project.clips[i].speed; if(time>start+.05 && time<end-.05){index=i;break;} start=end; }
  if(index<0){toast('クリップの途中に再生位置を合わせてください');return;}
  edit(() => { const clip=project.clips[index], cut=clip.in+(time-start)*clip.speed; const right={...clip,id:uid(),in:cut};clip.out=cut;project.clips.splice(index+1,0,right);selected={kind:'clips',id:right.id}; });
};
$('duplicateBtn').onclick = () => {const item=selection();if(!item)return;edit(()=>{const list=project[selected.kind], copy={...item,id:uid()};list.splice(list.indexOf(item)+1,0,copy);selected={kind:selected.kind,id:copy.id};});};
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
    for(const c of p.clips){const a=map.get(c.assetId);if(!a||a.type==='audio'||!validNumber(c.in,0,600000)||!validNumber(c.out,c.in+.001,a.type==='image'?600:a.duration+.1)||!validNumber(c.speed,.25,4)||!validNumber(c.volume,0,2)||!validNumber(c.brightness,.2,2)||!['contain','cover'].includes(c.fit))throw new Error('クリップ設定が不正です');c.id=uid();}
    for(const m of p.music){const a=map.get(m.assetId);if(!a||a.type!=='audio'||!validNumber(m.in,0,a.duration)||!validNumber(m.out,m.in+.001,a.duration+.1)||!validNumber(m.start,0,600000)||!validNumber(m.volume,0,2)||!validNumber(m.fadeIn,0,30)||!validNumber(m.fadeOut,0,30))throw new Error('音楽設定が不正です');m.id=uid();}
    for(const t of p.texts){if(typeof t.text!=='string'||t.text.length>10000||!validNumber(t.start,0,600000)||!validNumber(t.end,t.start+.001,600000)||!validNumber(t.size,12,160)||!/^#[0-9a-f]{6}$/i.test(t.color)||!['top','center','bottom'].includes(t.position))throw new Error('テロップ設定が不正です');t.id=uid();}
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
const zoom=document.createElement('label');zoom.className='timeline-zoom';zoom.innerHTML='表示倍率 <input type="range" min="8" max="140" value="60" aria-label="タイムラインの表示倍率">';zoom.querySelector('input').oninput=e=>{timelineScale=Number(e.target.value);renderTimeline();};document.querySelector('.timeline-heading').append(zoom);
refresh();
