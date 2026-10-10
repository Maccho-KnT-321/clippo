import { installMobileDock, dockIcon } from './mobile-dock.js?v=20261010-reference';
// Move the real controls, preserving their handlers, disabled state and IDs.
export function installMobileEditor(){
  const media=matchMedia('(max-width:580px)');
  const toolbar=document.createElement('div');toolbar.id='mobileEditorToolbar';toolbar.className='mobile-editor-toolbar';toolbar.setAttribute('aria-label','編集の基本操作');document.querySelector('.timeline-toolbar').before(toolbar);
  const sheet=document.createElement('dialog');sheet.id='mobileToolsDialog';sheet.innerHTML='<div class="dialog-heading"><h2>編集ツール</h2><button class="icon-button" aria-label="編集ツールを閉じる">×</button></div><p class="dialog-description">クリップを選んでから、使いたい操作をタップ。</p><div class="mobile-tools-grid"></div>';document.body.append(sheet);sheet.querySelector('.icon-button').onclick=()=>sheet.close();
  const primary=['editorImportBtn','autoEditBtn','splitBtn','addTextBtn','addMusicBtn','deleteBtn','moreActionsBtn'];
  const inspector=document.querySelector('.inspector-panel'),inspectorAnchor=document.createComment('desktop inspector');inspector.before(inspectorAnchor);
  const context=document.createElement('div');context.className='mobile-context';inspector.prepend(context);
  const controls=document.getElementById('inspector');
  installMobileDock({controls,context,media});
  const library=document.createElement('button');library.textContent='素材一覧';library.onclick=()=>{sheet.close();document.body.dataset.panel='media';};sheet.querySelector('.mobile-tools-grid').append(library);
  const help=document.createElement('button');help.textContent='使い方';help.onclick=()=>{sheet.close();document.getElementById('helpBtn').click();};sheet.querySelector('.mobile-tools-grid').append(help);
  const extras=['editorFilesImportBtn','adjustBtn','duplicateBtn','copyBtn','pasteBtn','mergeBtn','trimStartBtn','trimEndBtn','snapBtn'];
  const history=['undoBtn','redoBtn'];
  const moves=['moveLeftBtn','moveRightBtn'];
  const originals=new Map([...primary,...extras,...moves,...history].map(id=>{const node=document.getElementById(id),anchor=document.createComment('control '+id);node.before(anchor);return [id,{node,anchor}];}));
  const labels={editorImportBtn:'追加',autoEditBtn:'おまかせ',splitBtn:'分割',addTextBtn:'文字',addMusicBtn:'音楽',deleteBtn:'削除',moreActionsBtn:'その他'};
  for(const [id,label]of Object.entries(labels)){const node=originals.get(id).node;node.dataset.mobileLabel=label;if(!node.getAttribute('aria-label'))node.setAttribute('aria-label',node.textContent.trim()||label);}
  const moveGroup=document.createElement('div');moveGroup.className='mobile-move-controls';moveGroup.setAttribute('aria-label','選択したクリップの並び替え');document.querySelector('.timeline-heading').append(moveGroup);
  const historyGroup=document.createElement('div');historyGroup.className='mobile-history-controls';historyGroup.setAttribute('aria-label','操作を戻す・やり直す');document.querySelector('.transport').append(historyGroup);
  const focusPreview=document.createElement('button');focusPreview.id='previewFocusBtn';focusPreview.type='button';focusPreview.className='icon-button';focusPreview.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg>';focusPreview.setAttribute('aria-label','プレビューを大きく表示');focusPreview.setAttribute('aria-pressed','false');document.querySelector('.transport').append(focusPreview);
  function previewFocus(active){document.body.classList.toggle('preview-focused',active);focusPreview.setAttribute('aria-pressed',String(active));focusPreview.setAttribute('aria-label',active?'編集画面に戻る':'プレビューを大きく表示');}
  focusPreview.onclick=()=>previewFocus(!document.body.classList.contains('preview-focused'));
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.body.classList.contains('preview-focused'))previewFocus(false);});
  const quality=document.createElement('select');quality.id='quickExportQuality';quality.setAttribute('aria-label','書き出しの解像度');quality.innerHTML='<option value="720">720P</option><option value="1080">1080P</option>';quality.value=document.getElementById('exportQuality').value;document.getElementById('saveProjectBtn').before(quality);
  quality.onchange=()=>{const original=document.getElementById('exportQuality');original.value=quality.value;original.dispatchEvent(new Event('change',{bubbles:true}));};
  document.getElementById('exportQuality').addEventListener('change',event=>quality.value=event.target.value);
  const more=originals.get('moreActionsBtn').node,oldMore=more.onclick;
  more.onclick=e=>{if(media.matches){if(document.getElementById('exportBtn').disabled&&document.getElementById('importActivity')&&!document.getElementById('importActivity').hidden)return;sheet.showModal();}else oldMore(e);};
  sheet.querySelector('.mobile-tools-grid').addEventListener('click',e=>{if(e.target.closest('button')?.id!=='snapBtn')sheet.close();},true);
  const toggle=document.createElement('button');toggle.id='togglePreviewBtn';toggle.className='text-button preview-toggle';toggle.textContent='映像をたたむ';toggle.setAttribute('aria-expanded','true');document.querySelector('.viewer-heading').append(toggle);
  toggle.onclick=()=>{const collapsed=document.body.classList.toggle('preview-collapsed');toggle.textContent=collapsed?'映像を表示':'映像をたたむ';toggle.setAttribute('aria-expanded',String(!collapsed));};
  function arrange(){
    quality.hidden=!media.matches;focusPreview.hidden=!media.matches;
    if(media.matches){for(const id of primary)toolbar.append(originals.get(id).node);for(const id of extras)sheet.querySelector('.mobile-tools-grid').append(originals.get(id).node);for(const id of moves)moveGroup.append(originals.get(id).node);for(const id of history)historyGroup.append(originals.get(id).node);toolbar.after(inspector);}
    else{sheet.close();for(const {node,anchor}of originals.values())anchor.after(node);inspectorAnchor.after(inspector);previewFocus(false);document.body.classList.remove('preview-collapsed');toggle.textContent='映像をたたむ';toggle.setAttribute('aria-expanded','true');}
    // Field types and gesture handlers also depend on the breakpoint.
    document.dispatchEvent(new Event('clippo:layoutchange'));
  }
  media.addEventListener('change',arrange);arrange();
  const workspace=document.querySelector('.workspace');
  const divider=document.createElement('div');divider.id='workspaceDivider';divider.setAttribute('role','separator');divider.setAttribute('aria-label','プレビューとタイムラインの高さを調整');divider.setAttribute('aria-orientation','horizontal');divider.tabIndex=0;document.querySelector('.timeline-panel').prepend(divider);
  let fraction=.43,mobileHeight=null,drag=null;
  const mobileLimits=()=>({min:120,max:Math.max(120,workspace.clientHeight-376)});
  function expanded(){if(document.body.classList.contains('preview-collapsed'))document.body.classList.remove('preview-collapsed');toggle.textContent='映像をたたむ';toggle.setAttribute('aria-expanded','true');}
  function resizeDesktop(value){fraction=Math.max(.25,Math.min(.62,value));workspace.style.setProperty('--preview-share',`${fraction*100}%`);updateResizeLabel();}
  function resizeMobile(value){const {min,max}=mobileLimits();mobileHeight=Math.round(Math.max(min,Math.min(max,value)));workspace.style.setProperty('--mobile-preview-height',`${mobileHeight}px`);expanded();updateResizeLabel();}
  function updateResizeLabel(){const {min,max}=media.matches?mobileLimits():{min:25,max:62};const value=media.matches?Math.round(document.querySelector('.viewer-panel').getBoundingClientRect().height):Math.round(fraction*100);divider.setAttribute('aria-valuemin',String(Math.min(min,value)));divider.setAttribute('aria-valuemax',String(Math.round(max)));divider.setAttribute('aria-valuenow',String(value));divider.setAttribute('aria-valuetext',media.matches?'プレビューの高さ '+value+'ピクセル。上下にドラッグ、上下キーで調整。':'プレビュー '+value+'%。上下キーで調整。');}
  function resetResize(){if(media.matches){mobileHeight=null;workspace.style.removeProperty('--mobile-preview-height');expanded();updateResizeLabel();}else resizeDesktop(.43);}
  resizeDesktop(fraction);
  divider.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();drag={y:e.clientY,height:document.querySelector('.viewer-panel').getBoundingClientRect().height,mobileHeight,fraction,collapsed:document.body.classList.contains('preview-collapsed')};divider.setPointerCapture(e.pointerId);divider.classList.add('resizing');};
  divider.onpointermove=e=>{if(!drag||!divider.hasPointerCapture(e.pointerId))return;if(media.matches)resizeMobile(drag.height+e.clientY-drag.y);else{const rect=workspace.getBoundingClientRect();resizeDesktop((e.clientY-rect.top)/rect.height);}};
  divider.onpointerup=e=>{drag=null;divider.classList.remove('resizing');if(divider.hasPointerCapture(e.pointerId))divider.releasePointerCapture(e.pointerId);};
  divider.onpointercancel=e=>{if(drag){if(media.matches){mobileHeight=drag.mobileHeight;if(mobileHeight===null)workspace.style.removeProperty('--mobile-preview-height');else workspace.style.setProperty('--mobile-preview-height',`${mobileHeight}px`);if(drag.collapsed){document.body.classList.add('preview-collapsed');toggle.textContent='映像を表示';toggle.setAttribute('aria-expanded','false');}}else resizeDesktop(drag.fraction);}drag=null;divider.classList.remove('resizing');updateResizeLabel();};
  divider.onlostpointercapture=()=>{drag=null;divider.classList.remove('resizing');};
  divider.onkeydown=e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();const sign=e.key==='ArrowUp'?-1:1;if(media.matches)resizeMobile(document.querySelector('.viewer-panel').getBoundingClientRect().height+sign*24);else resizeDesktop(fraction+sign*.04);}else if(e.key==='Home'){e.preventDefault();resetResize();}};
  divider.ondblclick=resetResize;
  const updateLayout=()=>{if(document.body.classList.contains('preview-focused'))return;if(media.matches&&mobileHeight!==null&&!document.body.classList.contains('preview-collapsed'))resizeMobile(mobileHeight);else updateResizeLabel();};
  media.addEventListener('change',updateLayout);window.addEventListener('resize',updateLayout);
  new MutationObserver(updateLayout).observe(document.body,{attributes:true,attributeFilter:['class']});
}
