// Move the real controls, preserving their handlers, disabled state and IDs.
export function installMobileEditor(){
  const media=matchMedia('(max-width:580px)');
  const toolbar=document.createElement('div');toolbar.id='mobileEditorToolbar';toolbar.className='mobile-editor-toolbar';toolbar.setAttribute('aria-label','編集の基本操作');document.querySelector('.timeline-toolbar').before(toolbar);
  const sheet=document.createElement('dialog');sheet.id='mobileToolsDialog';sheet.innerHTML='<div class="dialog-heading"><h2>編集ツール</h2><button class="icon-button" aria-label="編集ツールを閉じる">×</button></div><p class="dialog-description">クリップを選んでから、使いたい操作をタップ。</p><div class="mobile-tools-grid"></div>';document.body.append(sheet);sheet.querySelector('.icon-button').onclick=()=>sheet.close();
  const primary=['editorImportBtn','autoEditBtn','splitBtn','addTextBtn','addMusicBtn','deleteBtn','moreActionsBtn'];
  const inspector=document.querySelector('.inspector-panel'),inspectorAnchor=document.createComment('desktop inspector');inspector.before(inspectorAnchor);
  const library=document.createElement('button');library.textContent='素材一覧';library.onclick=()=>{sheet.close();document.body.dataset.panel='media';};sheet.querySelector('.mobile-tools-grid').append(library);
  const extras=['editorFilesImportBtn','adjustBtn','duplicateBtn','copyBtn','pasteBtn','mergeBtn','trimStartBtn','trimEndBtn','snapBtn'];
  const history=['undoBtn','redoBtn'];
  const moves=['moveLeftBtn','moveRightBtn'];
  const originals=new Map([...primary,...extras,...moves,...history].map(id=>{const node=document.getElementById(id),anchor=document.createComment('control '+id);node.before(anchor);return [id,{node,anchor}];}));
  const labels={editorImportBtn:'追加',autoEditBtn:'おまかせ',splitBtn:'分割',addTextBtn:'文字',addMusicBtn:'音楽',deleteBtn:'削除',moreActionsBtn:'その他'};
  for(const [id,label]of Object.entries(labels)){const node=originals.get(id).node;node.dataset.mobileLabel=label;if(!node.getAttribute('aria-label'))node.setAttribute('aria-label',node.textContent.trim()||label);}
  const moveGroup=document.createElement('div');moveGroup.className='mobile-move-controls';moveGroup.setAttribute('aria-label','選択したクリップの並び替え');document.querySelector('.timeline-heading').append(moveGroup);
  const historyGroup=document.createElement('div');historyGroup.className='mobile-history-controls';historyGroup.setAttribute('aria-label','操作を戻す・やり直す');document.querySelector('.transport').append(historyGroup);
  const more=originals.get('moreActionsBtn').node,oldMore=more.onclick;
  more.onclick=e=>{if(media.matches){if(document.getElementById('exportBtn').disabled&&document.getElementById('importActivity')&&!document.getElementById('importActivity').hidden)return;sheet.showModal();}else oldMore(e);};
  sheet.querySelector('.mobile-tools-grid').addEventListener('click',e=>{if(e.target.closest('button')?.id!=='snapBtn')sheet.close();},true);
  const toggle=document.createElement('button');toggle.id='togglePreviewBtn';toggle.className='text-button preview-toggle';toggle.textContent='映像をたたむ';toggle.setAttribute('aria-expanded','true');document.querySelector('.viewer-heading').append(toggle);
  toggle.onclick=()=>{const collapsed=document.body.classList.toggle('preview-collapsed');toggle.textContent=collapsed?'映像を表示':'映像をたたむ';toggle.setAttribute('aria-expanded',String(!collapsed));};
  function arrange(){
    if(media.matches){for(const id of primary)toolbar.append(originals.get(id).node);for(const id of extras)sheet.querySelector('.mobile-tools-grid').append(originals.get(id).node);for(const id of moves)moveGroup.append(originals.get(id).node);for(const id of history)historyGroup.append(originals.get(id).node);toolbar.after(inspector);}
    else{sheet.close();for(const {node,anchor}of originals.values())anchor.after(node);inspectorAnchor.after(inspector);document.body.classList.remove('preview-collapsed');toggle.textContent='映像をたたむ';toggle.setAttribute('aria-expanded','true');}
  }
  media.addEventListener('change',arrange);arrange();
  const workspace=document.querySelector('.workspace');
  const divider=document.createElement('div');divider.id='workspaceDivider';divider.setAttribute('role','separator');divider.setAttribute('aria-label','プレビューとタイムラインの高さを調整');divider.setAttribute('aria-orientation','horizontal');divider.tabIndex=0;document.querySelector('.timeline-panel').prepend(divider);
  let fraction=.43;
  function resize(value){fraction=Math.max(.25,Math.min(.62,value));workspace.style.setProperty('--preview-share',`${fraction*100}%`);divider.setAttribute('aria-valuenow',String(Math.round(fraction*100)));}
  divider.setAttribute('aria-valuemin','25');divider.setAttribute('aria-valuemax','62');resize(fraction);
  divider.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();divider.setPointerCapture(e.pointerId);divider.classList.add('resizing');};
  divider.onpointermove=e=>{if(!divider.hasPointerCapture(e.pointerId))return;const rect=workspace.getBoundingClientRect();resize((e.clientY-rect.top)/rect.height);};
  divider.onpointerup=divider.onpointercancel=()=>divider.classList.remove('resizing');
  divider.onkeydown=e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();resize(fraction+(e.key==='ArrowUp'?-.04:.04));}else if(e.key==='Home'){e.preventDefault();resize(.43);}};
  divider.ondblclick=()=>resize(.43);
}
