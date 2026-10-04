import { layoutClips } from './timeline.js';

// Insert at a visible boundary, never accidentally overwrite a source clip.
export function insertionAt(clips, time) {
  const entries = layoutClips(clips);
  const index = entries.findIndex(entry => time < (entry.start + entry.end) / 2);
  return index < 0 ? clips.length : index;
}

export function trimToPlayhead(clips, id, time, side) {
  const entry = layoutClips(clips).find(entry => entry.clip.id === id);
  if (!entry || time <= entry.start + .05 || time >= entry.end - .05) return false;
  if (layoutClips(clips).filter(c => time >= c.start && time < c.end).length > 1) return false;
  const clip = entry.clip, sourceTime = clip.in + (time - entry.start) * clip.speed;
  if (side === 'start') { clip.in = sourceTime; clip.fadeIn = 0; }
  else { clip.out = sourceTime; clip.fadeOut = 0; }
  return true;
}
