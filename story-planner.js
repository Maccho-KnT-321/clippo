import { layoutClips, projectDuration } from './timeline.js';

// These are editing recipes, not content recognition or an AI-generated script.
export const storyRecipes = [
  { id: 'memory', name: '思い出を残す', description: 'ゆっくり始まり、思い出を重ねて、余韻で終える。', style: 'calm', aspect: '16:9', defaultTitle: 'たいせつな、ひととき' },
  { id: 'social', name: 'SNSで見せる', description: '最初は少し長く、中盤は短く軽快に。最後にひと呼吸。', style: 'bright', aspect: '9:16', defaultTitle: '今日のハイライト' },
  { id: 'explain', name: 'もの・場所を紹介', description: '導入・紹介・まとめ。文字を読みやすい、長めのカット。', style: 'calm', aspect: '16:9', defaultTitle: 'ここを、紹介します' }
];

const rhythms = {
  memory: { min: 1.5, normal: 4, max: 7, transition: .35, opening: 1.45, ending: 1.55 },
  social: { min: .9, normal: 2.2, max: 4, transition: 0, opening: 1.3, ending: 1.35 },
  explain: { min: 2.5, normal: 5, max: 9, transition: .25, opening: 1.35, ending: 1.45 }
};
const sectionNames = { opening: '導入', middle: '展開', ending: '結び' };
const sectionOrder = ['opening', 'middle', 'ending'];
const maximumSources = 24, maximumCuts = 60;

function stages(count) {
  if (count === 1) return ['opening'];
  if (count === 2) return ['opening', 'ending'];
  const opening = Math.max(1, Math.round(count * .17));
  const ending = Math.max(1, Math.round(count * .15));
  return Array.from({ length: count }, (_, index) => index < opening ? 'opening' : index >= count - ending ? 'ending' : 'middle');
}

function weights(count, rhythm) {
  const chapters = stages(count), variation = [.88, 1.06, .94, 1.18, .82, 1.02];
  let middle = 0;
  return chapters.map((chapter, index) => {
    if (chapter === 'opening') return rhythm.opening * (index === 0 ? 1.12 : 1);
    if (chapter === 'ending') return rhythm.ending * (index === count - 1 ? 1.08 : 1);
    return variation[middle++ % variation.length];
  });
}

// If a short film cannot give every source a readable shot, retain relative order
// and both ends of the selected sequence rather than creating flashing cuts.
function orderedSubset(sources, count) {
  if (count >= sources.length) return sources.slice();
  if (count === 1) return [sources[0]];
  return Array.from({ length: count }, (_, index) => sources[Math.round(index * (sources.length - 1) / (count - 1))]);
}

function makeCuts(picks, rhythm, scale) {
  const counts = new Map(), occurrences = new Map(), shotWeights = weights(picks.length, rhythm);
  for (const source of picks) counts.set(source.id, (counts.get(source.id) || 0) + 1);
  return picks.map((source, index) => {
    const available = source.type === 'image' ? rhythm.max : source.duration;
    const minimum = Math.min(rhythm.min, available), maximum = Math.min(rhythm.max, available);
    const span = Math.max(minimum, Math.min(maximum, scale * shotWeights[index]));
    const occurrence = occurrences.get(source.id) || 0, count = counts.get(source.id);
    occurrences.set(source.id, occurrence + 1);
    // Subsequent excerpts move forward through each original recording. With a
    // single excerpt the centre is a neutral rule, not a claim about its contents.
    let offset = source.type === 'image' ? 0 : (available - span) * (count === 1 ? .5 : occurrence / (count - 1));
    if (offset + span <= offset) offset = 0;
    const canDissolve = rhythm.transition > 0 && available >= rhythm.min && index < picks.length - 1;
    return { assetId: source.id, in: offset, out: Math.min(available, offset + span), speed: 1,
      transition: { type: canDissolve ? 'dissolve' : 'none', duration: canDissolve ? rhythm.transition : 0 } };
  });
}

function chapterLayout(clips) {
  const entries = layoutClips(clips), chapters = stages(clips.length), total = projectDuration({ clips });
  const boundary = index => index === 0 ? 0 : index === clips.length ? total : (entries[index - 1].end + entries[index].start) / 2;
  return sectionOrder.flatMap(id => {
    const first = chapters.indexOf(id);
    if (first < 0) return [];
    const end = chapters.lastIndexOf(id) + 1;
    return [{ id, label: sectionNames[id], clipStart: first, clipEnd: end, start: boundary(first), end: boundary(end) }];
  });
}

export function planStoryEdit(sources, { seconds = 30, recipe = 'memory' } = {}) {
  if (!Array.isArray(sources) || !sources.length) throw new Error('動画・写真を選んでください。');
  const target = Number(seconds), rhythm = typeof recipe === 'string' && Object.hasOwn(rhythms, recipe) ? rhythms[recipe] : null;
  if (!Number.isFinite(target) || target < 5 || target > 120) throw new Error('長さは5〜120秒にしてください。');
  if (!rhythm) throw new Error('作りたい動画の用途を選んでください。');
  const unique = new Set();
  const valid = sources.filter(source => {
    if (!source || typeof source.id !== 'string' || !source.id || unique.has(source.id)) return false;
    if (source.type !== 'image' && !(source.type === 'video' && Number.isFinite(source.duration) && source.duration > 0)) return false;
    unique.add(source.id); return true;
  });
  if (!valid.length) throw new Error('使用できる動画・写真がありません。');
  const candidates = valid.slice(0, maximumSources);
  let chosen = candidates.slice();
  while (chosen.length > 1 && projectDuration({ clips: makeCuts(chosen, rhythm, 0) }) > target) chosen = orderedSubset(candidates, chosen.length - 1);
  const pick = count => Array.from({ length: count }, (_, index) => chosen[index % chosen.length]);
  let count = Math.min(maximumCuts, Math.max(chosen.length, Math.ceil(target / (rhythm.normal - rhythm.transition))));
  while (count > chosen.length && projectDuration({ clips: makeCuts(pick(count), rhythm, 0) }) > target) count--;
  const ceiling = rhythm.max / .82;
  while (count < maximumCuts && projectDuration({ clips: makeCuts(pick(count), rhythm, ceiling) }) < target) {
    // Protect readable minimum shot lengths. If one more cut would exceed the
    // target even at its minimum, an honestly shorter film is preferable.
    if (projectDuration({ clips: makeCuts(pick(count + 1), rhythm, 0) }) > target) break;
    count++;
  }
  const picks = pick(count), maximum = makeCuts(picks, rhythm, ceiling);
  let clips = maximum;
  if (projectDuration({ clips }) > target) {
    let low = 0, high = ceiling;
    for (let iteration = 0; iteration < 45; iteration++) {
      const middle = (low + high) / 2;
      if (projectDuration({ clips: makeCuts(picks, rhythm, middle) }) <= target) low = middle;
      else high = middle;
    }
    clips = makeCuts(picks, rhythm, low);
  }
  const duration = projectDuration({ clips }), sections = chapterLayout(clips), used = chosen.length;
  const notes = [`${used}素材・${clips.length}カット・約${duration.toFixed(1)}秒。${sections.map(section => section.label).join(' → ')}で構成しました。`];
  if (candidates.length > used) notes.push(`${candidates.length}素材のうち${used}素材を使用。短すぎるカットを避け、選んだ順序を保って配置しました。`);
  if (valid.length > maximumSources) notes.push('読み込み済み素材の先頭24個を対象にしています。');
  if (clips.length > used) notes.push('同じ素材を再使用し、動画の切り出し位置を分散しています。');
  if (duration < target - .01) notes.push(`素材の長さ・読みやすい最短カット・最大60カットの範囲では、指定の${target}秒に届きませんでした。`);
  return { clips, duration, target, sections, summary: notes.join(' ') };
}
