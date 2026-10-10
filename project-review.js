import { projectDuration } from './timeline.js';
import { recoveryLimit } from './project-store.js';

const number = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value));
const validRange = item => item && number(item.in) && number(item.out) && Number(item.in) >= 0 && Number(item.out) > Number(item.in);
const object = item => item !== null && typeof item === 'object';

// A lightweight preflight, not a codec/device benchmark or a review of meaning.
// Nothing is changed, decoded, sent to a server, or marked "AI analysed" here.
export function reviewProject(project, assets = new Map()) {
  const grouped = new Map(), referenced = new Set();
  let assetBytes = 0;
  const report = (code, level, message, kind, id) => {
    const existing = grouped.get(code);
    if (existing) { existing.count++; return; }
    const issue = { code, level, message, count: 1 };
    if (kind) issue.kind = kind;
    if (typeof id === 'string') issue.id = id;
    grouped.set(code, issue);
  };
  const finish = () => {
    const issues = [...grouped.values()].map(({ count, message, ...issue }) => ({ ...issue, message: typeof message === 'function' ? message(count) : message }));
    issues.sort((a, b) => (a.level === 'error' ? 0 : 1) - (b.level === 'error' ? 0 : 1));
    return { ready: !issues.some(issue => issue.level === 'error'), issues, assetBytes };
  };
  if (!object(project) || !Array.isArray(project.clips) || project.music != null && !Array.isArray(project.music) || project.texts != null && !Array.isArray(project.texts)) {
    report('invalid_project', 'error', '編集データを読み取れません。保存したプロジェクトを開き直してください。');
    return finish();
  }
  const clips = project.clips, music = project.music || [], texts = project.texts || [];
  if (!clips.length) report('empty_project', 'error', '先に動画または写真をタイムラインに追加してください。');
  const getAsset = id => typeof assets?.get === 'function' ? assets.get(id) : undefined;
  const inspectSource = (item, kind) => {
    const asset = getAsset(item?.assetId);
    if (!asset || !asset.url) report('missing_asset', 'error', count => `読み込めない素材を使っている項目が${count}個あります。該当する動画・写真・音楽を追加し直してください。`, kind, item?.id);
    if (asset && !referenced.has(item.assetId)) {
      referenced.add(item.assetId);
      const bytes = Number(asset.file?.size);
      if (Number.isFinite(bytes) && bytes > 0) assetBytes += bytes;
    }
    const inRange = validRange(item);
    const beyondSource = inRange && asset?.type !== 'image' && number(asset?.duration) && Number(item.out) > Number(asset.duration) + .05;
    if (!inRange || beyondSource || kind === 'music' && (!number(item.start) || Number(item.start) < 0)) {
      report(kind === 'clips' ? 'invalid_clip_range' : 'invalid_music_range', 'error', count => `${kind === 'clips' ? '映像' : '音楽'}の使用範囲が正しくない項目が${count}個あります。開始・終了位置を調整してください。`, kind, item?.id);
      return false;
    }
    return true;
  };
  for (const clip of clips) inspectSource(clip, 'clips');
  const playableMusic = music.filter(item => inspectSource(item, 'music'));
  if (assetBytes > recoveryLimit) report('save_limit', 'warning', '素材の合計が150MBを超えています。この端末の自動保存・素材込みプロジェクト保存はできません。完成動画の書き出し自体はこの上限の対象ではありません。');
  const total = projectDuration({ clips: clips.filter(object) });
  for (const text of texts) {
    if (!object(text) || !String(text.text || '').trim()) continue;
    if (!number(text.start) || !number(text.end) || Number(text.end) <= Number(text.start)) {
      report('invalid_text_range', 'warning', count => `表示時間が正しくないテロップが${count}個あります。文字の開始・終了位置を確認してください。`, 'texts', text.id);
      continue;
    }
    const visibleStart = Math.max(0, Number(text.start)), visibleEnd = Math.min(total, Number(text.end));
    if (visibleEnd <= visibleStart) {
      report('text_outside', 'warning', count => `作品の範囲外にあるテロップが${count}個あり、完成動画には表示されません。表示時間を確認してください。`, 'texts', text.id);
    } else if (visibleEnd - visibleStart < .6 - 1e-9) {
      report('text_short', 'warning', count => `表示が0.6秒未満のテロップが${count}個あります。意図した演出か、再生して確認してください。`, 'texts', text.id);
    }
  }
  // Sweep visible audible intervals, retaining only the two longest ends from
  // distinct sources. This detects same-source doubles and mixed music in
  // O(n log n), without enumerating all possible pairs in a large project.
  const intervals = playableMusic.filter(item => item.volume == null || !number(item.volume) || Number(item.volume) > 0).map(item => ({
    item, start: Math.max(0, Number(item.start)), end: Math.min(total, Number(item.start) + Number(item.out) - Number(item.in))
  })).filter(item => item.end > item.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const sourceEnds = new Map(); let first, second;
  for (const { item, start, end } of intervals) {
    if ((sourceEnds.get(item.assetId) ?? -Infinity) > start + 1e-6) report('music_duplicate', 'warning', '同じ音楽が重なって再生される箇所があります。音が二重になるため、意図した重なりか確認してください。', 'music', item.id);
    const other = first?.assetId === item.assetId ? second : first;
    if (other?.end > start + 1e-6) report('music_overlap', 'warning', '複数の音楽が同時に流れる箇所があります。意図したミックスか、音量を聞いて確認してください。', 'music', item.id);
    sourceEnds.set(item.assetId, Math.max(end, sourceEnds.get(item.assetId) ?? -Infinity));
    if (first?.assetId === item.assetId) first.end = Math.max(first.end, end);
    else if (second?.assetId === item.assetId) { second.end = Math.max(second.end, end); if (second.end > first.end) [first, second] = [second, first]; }
    else if (!first || end > first.end) { second = first; first = { assetId: item.assetId, end }; }
    else if (!second || end > second.end) second = { assetId: item.assetId, end };
  }
  return finish();
}
