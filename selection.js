// Selection is editor UI state, never part of a saved video project.
export const trackKinds=['clips','texts','music'];
export const selectionKey=(kind,id)=>`${kind}:${id}`;
export function selectedEntries(project,keys){
  return trackKinds.flatMap(kind=>project[kind].filter(item=>keys.has(selectionKey(kind,item.id))).map(item=>({kind,item})));
}
export function toggleTrackSelection(project,keys,kind){
  const items=project[kind]||[],all=items.length>0&&items.every(item=>keys.has(selectionKey(kind,item.id)));
  for(const item of items){const key=selectionKey(kind,item.id);if(all)keys.delete(key);else keys.add(key);}
  return keys;
}
export function removeSelected(project,keys){
  for(const kind of trackKinds)project[kind]=project[kind].filter(item=>!keys.has(selectionKey(kind,item.id)));
}
