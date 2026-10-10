// A mobile presentation layer over the editor's real controls. No duplicate
// inputs, proxy project state, or second settings screen are needed.
const paths={
  volume:'M4 9h4l5-4v14l-5-4H4z M17 8c3 2 3 6 0 8 M20 5c5 4 5 10 0 14',
  speed:'M4 17a9 9 0 1 1 16 0 M12 13l5-6 M11 17h2',
  color:'M12 3v2 M12 19v2 M3 12h2 M19 12h2 M5.6 5.6L7 7 M17 17l1.4 1.4 M5.6 18.4L7 17 M17 7l1.4-1.4 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  contrast:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 3v18 M12 3a9 9 0 0 1 0 18z',
  saturation:'M12 3s-7 8-7 12a7 7 0 0 0 14 0c0-4-7-12-7-12z M9 17c0 1 1 2 3 2',
  fit:'M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5 M8 8h8v8H8z',
  text:'M4 5h16 M12 5v15 M8 20h8',
  style:'M4 20l11-11 M12 4l1-3 1 3 3 1-3 1-1 3-1-3-3-1z M19 13l1-3 1 3 2 1-2 1-1 3-1-3-3-1z',
  timing:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5l4 2',
  fade:'M4 18l16-12 M4 18h16V6 M8 15v3 M12 12v6 M16 9v9',
  transition:'M4 5h16v14H4z M9 8l6 4-6 4 M12 5v14',
  details:'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6',
  back:'M15 5l-7 7 7 7',done:'M5 12l4 4L19 6',filters:'M4 4h16v16H4z M4 16l6-6 4 4 3-3 3 3 M15 7h1'
};
export const dockIcon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]||paths.details}"/></svg>`;
const groups={
  clips:[['volume','音量'],['speed','速度'],['color','調整'],['filters','フィルター'],['fit','画面'],['timing','長さ'],['fade','フェード'],['transition','切り替え'],['details','詳細']],
  texts:[['text','文字編集'],['style','スタイル'],['fit','配置'],['timing','長さ'],['fade','フェード'],['details','詳細']],
  music:[['volume','音量'],['fade','フェード'],['timing','長さ'],['style','音を仕上げる'],['details','詳細']]
};
const defaults={clips:'volume',texts:'text',music:'volume'};

export function installMobileDock({controls,context,media}){
  context.innerHTML=`<div class="mobile-context-header"><button id="mobileDockBack" type="button" aria-label="編集ツールに戻る">${dockIcon('back')}</button><span class="mobile-context-name"></span><button id="mobileDockDone" type="button" aria-label="調整欄を閉じる">${dockIcon('done')}</button></div><div class="mobile-context-actions" aria-label="素材の編集ツール"></div>`;
  const actions=context.querySelector('.mobile-context-actions'),name=context.querySelector('.mobile-context-name');
  const remembered=new Map(),detailsOpen=new WeakMap();
  let group='',colorKey='brightness',lastIdentity='',lastKind='',focus=null,movedApplyAll=null,leavingByKeyboard=false;
  const nativeField=key=>controls.querySelector(`.field[data-key="${key}"]`);
  const nativeInput=key=>nativeField(key)?.querySelector('input,select,textarea');
  function captureFocus(){
    if(leavingByKeyboard)return;
    const input=document.activeElement;
    if(controls.contains(input)&&input.dataset.key)focus={input,key:input.dataset.key,identity:controls.dataset.itemId,start:input.selectionStart,end:input.selectionEnd};
  }
  controls.addEventListener('focusin',captureFocus);
  controls.addEventListener('change',captureFocus,true);
  controls.addEventListener('keydown',event=>{if(event.key==='Tab'){focus=null;leavingByKeyboard=true;setTimeout(()=>leavingByKeyboard=false,0);}},true);
  document.addEventListener('focusin',event=>{if(!controls.contains(event.target))focus=null;});
  document.addEventListener('pointerdown',event=>{if(!controls.contains(event.target))focus=null;},true);
  function choose(next,{focusText=false}={}){
    focus=null;group=next;remembered.set(controls.dataset.kind,next);document.body.classList.remove('mobile-dock-collapsed');arrange();
    if(focusText)nativeInput('text')?.focus({preventScroll:true});
  }
  function tool(key,label,icon=key){
    const button=document.createElement('button');button.type='button';button.dataset.dockGroup=key;button.innerHTML='<span class="dock-tool-icon">'+dockIcon(icon)+'</span><span>'+label+'</span>';button.setAttribute('aria-label',label+'を調整');button.setAttribute('aria-pressed',String(group===key));
    button.onclick=()=>{
      if(key==='transition'){
        const launch=[...controls.querySelectorAll('button')].find(node=>node.textContent==='次のクリップへの切り替え効果');
        if(launch&&!launch.disabled){focus=null;document.body.classList.remove('mobile-dock-collapsed');launch.click();}
      }else choose(key,{focusText:key==='text'});
    };
    if(key==='transition')button.disabled=!![...controls.querySelectorAll('button')].find(node=>node.textContent==='次のクリップへの切り替え効果')?.disabled;
    return button;
  }
  context.querySelector('#mobileDockBack').onclick=()=>{
    focus=null;
    if(controls.dataset.mode==='transition')controls.querySelector('button.transition-return')?.click();
    else choose(defaults[controls.dataset.kind]||'volume');
  };
  context.querySelector('#mobileDockDone').onclick=()=>{focus=null;document.body.classList.add('mobile-dock-collapsed');};
  document.addEventListener('click',event=>{if(media.matches&&event.target.closest('.timeline-clip'))document.body.classList.remove('mobile-dock-collapsed');},true);
  function showField(key){const field=nativeField(key);if(field)field.dataset.dockVisible='true';}
  function resetControl(key){
    const field=nativeField(key);if(!field||field.querySelector('.dock-field-reset'))return;
    const button=document.createElement('button');button.type='button';button.className='dock-field-reset';button.textContent='リセット';button.setAttribute('aria-label',({'brightness':'明るさ','contrast':'コントラスト','saturation':'彩度'})[key]+'をリセット');button.disabled=!!nativeInput(key)?.disabled;
    button.onclick=()=>{const input=nativeInput(key);if(!input||input.disabled)return;input.value='1';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));};field.append(button);
  }
  function arrange(){
    observer.disconnect();
    try{
      if(movedApplyAll){if(movedApplyAll.anchor.isConnected){movedApplyAll.anchor.after(movedApplyAll.button);movedApplyAll.button.textContent='すべての切れ目に適用';movedApplyAll.button.classList.remove('mobile-context-apply-all');}else movedApplyAll.button.remove();movedApplyAll=null;}
      document.body.classList.toggle('mobile-reference',media.matches);
      if(!media.matches){
        context.hidden=true;document.body.classList.remove('mobile-dock-collapsed');delete document.body.dataset.dockGroup;
        controls.querySelectorAll('[data-dock-visible]').forEach(node=>delete node.dataset.dockVisible);
        controls.querySelectorAll('.dock-field-reset').forEach(node=>node.remove());
        controls.querySelectorAll('.advanced-controls').forEach(node=>{if(detailsOpen.has(node))node.open=detailsOpen.get(node);});return;
      }
      const kind=controls.dataset.kind,identity=controls.dataset.itemId||'',transition=controls.dataset.mode==='transition';
      const available=!!groups[kind]&&!controls.querySelector('.empty-inspector');context.hidden=!available;
      if(!available){group='';delete document.body.dataset.dockGroup;lastIdentity=identity;lastKind=kind;return;}
      if(identity!==lastIdentity)document.body.classList.remove('mobile-dock-collapsed');
      lastIdentity=identity;
      if(transition)group='transition';
      else if(kind!==lastKind||group==='transition'||!(groups[kind].some(([key])=>key===group)))group=remembered.get(kind)||defaults[kind];
      lastKind=kind;
      document.body.dataset.dockGroup=group;
      name.textContent=transition?'トランジション':group==='color'?'映像を調整':group==='filters'?'フィルター':controls.querySelector('.inspector-heading')?.textContent||'素材を編集';
      actions.hidden=transition;actions.classList.toggle('mobile-color-choices',group==='color'||group==='filters');
      const previousActions=actions.scrollLeft;
      if(group==='color'||group==='filters'){
        actions.replaceChildren(...[['brightness','明るさ','color'],['contrast','コントラスト','contrast'],['saturation','彩度','saturation']].map(([key,label,icon])=>{
          const button=tool('color',label,icon);delete button.dataset.dockGroup;button.dataset.colorKey=key;button.setAttribute('aria-pressed',String(group==='color'&&colorKey===key));button.onclick=()=>{colorKey=key;choose('color');};return button;
        }),tool('filters','フィルター'));
      }else actions.replaceChildren(...groups[kind].map(([key,label])=>tool(key,label)));
      actions.scrollLeft=previousActions;
      controls.querySelectorAll('.field,.quick-presets,.finishing-presets,.transition-presets,.inspector-heading,.inspector-section-title,.inspector-note,.panel-summary,.button').forEach(node=>node.dataset.dockVisible='false');
      controls.querySelectorAll('.advanced-controls').forEach(node=>{if(!detailsOpen.has(node))detailsOpen.set(node,node.open);node.open=true;});
      if(transition){
        controls.querySelector('.transition-presets').dataset.dockVisible='true';showField('transitionDuration');
        const button=controls.querySelector('#applyAllTransitions'),anchor=document.createComment('transition apply all');button.before(anchor);button.dataset.dockVisible='true';button.textContent='すべてに適用';button.classList.add('mobile-context-apply-all');context.querySelector('#mobileDockDone').before(button);movedApplyAll={button,anchor};
      }else if(group==='volume')showField('volume');
      else if(group==='speed'){showField('speed');}
      else if(group==='color'){showField(colorKey);resetControl(colorKey);}
      else if(group==='filters'){const presets=controls.querySelector('[data-preset-group=color]');if(presets)presets.dataset.dockVisible='true';}
      else if(group==='fit'){
        (kind==='texts'?['position','size']:['fit','zoom']).forEach(showField);
      }else if(group==='timing'){
        (kind==='texts'?['start','end']:kind==='music'?['start','in','out']:['in','out']).forEach(showField);
      }else if(group==='fade'){
        (kind==='texts'?['fade']:['fadeIn','fadeOut']).forEach(showField);
      }else if(group==='text')showField('text');
      else if(group==='style'){
        const presets=controls.querySelector('.finishing-presets');if(presets)presets.dataset.dockVisible='true';
        if(kind==='texts')['size','color','background'].forEach(showField);
      }else if(group==='details'){
        controls.querySelectorAll('.field,.quick-presets,.finishing-presets,.inspector-note').forEach(node=>node.dataset.dockVisible='true');
      }
      // Preserve keyboard/text focus on an edit refresh, never focus on selection.
      if(focus&&!focus.input.isConnected&&focus.identity===identity&&!document.body.classList.contains('mobile-dock-collapsed')){
        const input=nativeInput(focus.key);
        if(input&&input.closest('.field').dataset.dockVisible==='true'){
          input.focus({preventScroll:true});if(input.tagName==='TEXTAREA'&&focus.start!=null)input.setSelectionRange(focus.start,focus.end);
        }
      }
    }finally{observer.observe(controls,{childList:true});}
  }
  const observer=new MutationObserver(arrange);media.addEventListener('change',arrange);arrange();
  return {arrange};
}
