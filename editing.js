import { layoutClips, transitionDuration } from './timeline.js';

// Insert at a visible boundary, never accidentally overwrite a source clip.
export function insertionAt(clips, time) {
  const entries = layoutClips(clips);
  const index = entries.findIndex(entry => time < (entry.start + entry.end) / 2);
  return index < 0 ? clips.length : index;
}

function trimEntry(clips,id,time){
  if(!Number.isFinite(time))return null;
  const entries=layoutClips(clips),entry=entries.find(entry=>entry.clip.id===id);
  if(!entry||time<=entry.start+.05||time>=entry.end-.05)return null;
  if(entries.filter(c=>time>=c.start&&time<c.end).length>1)return null;
  return entry;
}

// The UI and the actual trim share exactly the same safe region. This test
// does not clone or mutate a project while the playback clock is updating.
export function canTrimToPlayhead(clips,id,time){return !!trimEntry(clips,id,time);}

export function trimToPlayhead(clips, id, time, side) {
  const entry=trimEntry(clips,id,time);
  if(!entry)return false;
  const clip = entry.clip, sourceTime = clip.in + (time - entry.start) * clip.speed;
  if (side === 'start') { clip.in = sourceTime; clip.fadeIn = 0; }
  else { clip.out = sourceTime; clip.fadeOut = 0; }
  return true;
}

const splitMargin = .05;
const numeric = value => Number.isFinite(Number(value));
const copy = value => JSON.parse(JSON.stringify(value));

function splitTarget(project, selected, time) {
  if (!project || !Number.isFinite(time)) return null;
  const clips = project.clips || [], entries = layoutClips(clips);
  const kind = selected?.kind || 'clips';
  if (!['clips', 'texts', 'music'].includes(kind) || !Array.isArray(project[kind])) return null;
  const items = project[kind];
  let index = selected ? items.findIndex(item => item.id === selected.id) : entries.findIndex(entry => time > entry.start + splitMargin && time < entry.end - splitMargin);
  if (index < 0) return null;
  const item = items[index];
  const start = kind === 'clips' ? entries[index].start : Number(item.start);
  const end = kind === 'clips' ? entries[index].end : kind === 'texts' ? Number(item.end) : start + Number(item.out) - Number(item.in);
  if (!Number.isFinite(start) || !Number.isFinite(end) || time <= start + splitMargin || time >= end - splitMargin) return null;
  if (kind !== 'texts' && (!numeric(item.in) || !numeric(item.out) || Number(item.in) < 0 || Number(item.out) <= Number(item.in))) return null;
  const left = { ...item }, right = { ...item };
  if (kind === 'texts') {
    left.end = time; right.start = time;
    // A legacy text.fade applies at both ends. Explicit outer fades preserve
    // that look without introducing a second fade at the new internal cut.
    left.fadeIn = item.fadeIn ?? item.fade ?? 0; left.fadeOut = 0;
    right.fadeIn = 0; right.fadeOut = item.fadeOut ?? item.fade ?? 0;
  } else {
    const rate = kind === 'clips' ? Math.max(.25, Math.min(4, Number(item.speed) || 1)) : 1;
    const sourceTime = Number(item.in) + (time - start) * rate;
    left.out = sourceTime; right.in = sourceTime;
    left.fadeOut = 0; right.fadeIn = 0;
    if (kind === 'music') right.start = time;
    else {
      if (entries.filter(entry => time >= entry.start && time < entry.end).length > 1) return null;
      left.transition = { type: 'none', duration: .5 };
      const candidate = clips.slice(); candidate.splice(index, 1, left, right);
      // Splitting close to a transition can shrink the half-clip overlap limit
      // even outside the visible dissolve. Refuse that edit rather than silently
      // changing the whole film's duration and desynchronising text/music.
      if (Math.abs(transitionDuration(clips, index - 1) - transitionDuration(candidate, index - 1)) > 1e-9 ||
          Math.abs(transitionDuration(clips, index) - transitionDuration(candidate, index + 1)) > 1e-9) return null;
    }
  }
  return { kind, index, left, right };
}

// Selecting a caption or music segment must never cut the video behind it.
// Only an explicitly unselected editor falls back to the playhead's video.
export function canSplitAtPlayhead(project, selected, time) {
  return !!splitTarget(project, selected, time);
}

export function splitAtPlayhead(project, selected, time, makeId = () => crypto.randomUUID()) {
  const target = splitTarget(project, selected, time);
  if (!target) return null;
  const { kind, index, left, right } = target;
  const newId = makeId();
  if (typeof newId !== 'string' || !newId || project[kind].some(item => item.id === newId)) return null;
  right.id = newId;
  project[kind].splice(index, 1, copy(left), copy(right));
  return { kind, id: newId };
}
