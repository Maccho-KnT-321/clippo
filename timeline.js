const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
export function clipDuration(clip) {
  const speed = Math.max(.25, Math.min(4, finite(clip.speed, 1) || 1));
  return Math.max(0, finite(clip.out) - finite(clip.in)) / speed;
}
export function transitionDuration(clips, index) {
  const clip = clips[index], next = clips[index + 1];
  if (!clip || !next || !['dissolve', 'black', 'white', 'wipe'].includes(clip.transition?.type)) return 0;
  return Math.max(0, Math.min(finite(clip.transition.duration, .5), clipDuration(clip) / 2, clipDuration(next) / 2));
}
export function layoutClips(clips) {
  let start = 0;
  return clips.map((clip, index) => {
    const duration = clipDuration(clip), overlap = transitionDuration(clips, index);
    const item = { clip, start, end: start + duration, duration, overlap };
    start = item.end - overlap;
    return item;
  });
}
export function projectDuration(project) { return layoutClips(project.clips || []).at(-1)?.end || 0; }

// Disjoint BGM segments reuse a decoder; simultaneous segments need separate lanes.
export function musicLanes(music=[]){
  const ends=[],keys=new Map();
  for(const item of [...music].sort((a,b)=>a.start-b.start)){
    let lane=ends.findIndex(end=>end<=item.start);if(lane<0)lane=ends.length;
    ends[lane]=item.start+Math.max(0,item.out-item.in);keys.set(item.id,`music:lane:${lane}`);
  }
  return keys;
}
