// Move the real controls, preserving their handlers, disabled state and IDs.
export function installMobileEditor(){
  const media=matchMedia('(max-width:580px)');
  const toolbar=document.createElement('div');toolbar.id='mobileEditorToolbar';toolbar.className='mobile-editor-toolbar';toolbar.setAttribute('aria-label','編集の基本操作');document.querySelector('.timeline-toolbar').before(toolbar);
  const sheet=document.createElement('dialog');sheet.id='mobileToolsDialog';sheet.innerHTML='<div class="dialog-heading"><h2>編集ツール</h2><button class="icon-button" aria-label="編集ツールを閉じる">×</button></div><p class="dialog-description">クリップを選んでから、使いたい操作をタップ。</p><div class="mobile-tools-grid"></div>';document.body.append(sheet);sheet.querySelector('.icon-button').onclick=()=>sheet.close();
  const primary=['editorImportBtn','splitBtn','undoBtn','moreActionsBtn'];
  const extras=['editorFilesImportBtn','addTextBtn','addMusicBtn','adjustBtn','redoBtn','deleteBtn','duplicateBtn','copyBtn','pasteBtn','mergeBtn','trimStartBtn','trimEndBtn','snapBtn'];
  const originals=new Map([...primary,...extras].map(id=>{const node=document.getElementById(id),anchor=document.createComment('control '+id);node.before(anchor);return [id,{node,anchor}];}));
  const more=originals.get('moreActionsBtn').node,oldMore=more.onclick;
  more.onclick=e=>{if(media.matches){if(document.getElementById('exportBtn').disabled&&document.getElementById('importActivity')&&!document.getElementById('importActivity').hidden)return;sheet.showModal();}else oldMore(e);};
  sheet.querySelector('.mobile-tools-grid').addEventListener('click',e=>{if(e.target.closest('button')?.id!=='snapBtn')sheet.close();},true);
  const toggle=document.createElement('button');toggle.id='togglePreviewBtn';toggle.className='text-button preview-toggle';toggle.textContent='映像をたたむ';toggle.setAttribute('aria-expanded','true');document.querySelector('.viewer-heading').append(toggle);
  toggle.onclick=()=>{const collapsed=document.body.classList.toggle('preview-collapsed');toggle.textContent=collapsed?'映像を表示':'映像をたたむ';toggle.setAttribute('aria-expanded',String(!collapsed));};
  function arrange(){
    if(media.matches){for(const id of primary)toolbar.append(originals.get(id).node);for(const id of extras)sheet.querySelector('.mobile-tools-grid').append(originals.get(id).node);}
    else{sheet.close();for(const {node,anchor}of originals.values())anchor.after(node);document.body.classList.remove('preview-collapsed');toggle.textContent='映像をたたむ';toggle.setAttribute('aria-expanded','true');}
  }
  media.addEventListener('change',arrange);arrange();
}
