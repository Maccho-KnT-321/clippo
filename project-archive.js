// Portable project: a bounded JSON manifest followed by the original file bytes.
// Blob parts and slices avoid turning large iPhone videos into base64 strings.
const MAGIC = 'CLIPPO3\n';
const HEADER_BYTES = 12;
const MANIFEST_LIMIT = 4 * 1024 * 1024;
const LEGACY_LIMIT = 220 * 1024 * 1024;
const encoder = new TextEncoder();
const invalid = message => new Error(message || '対応するClippoプロジェクトではありません');
const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 200;
const validMime = type => typeof type === 'string' && (type === '' || /^(video\/|audio\/|image\/|application\/octet-stream$)/.test(type));

function validateManifest(data, version) {
  const p = data?.project;
  if (data?.format !== 'clippo' || data.version !== version || !p ||
      !['16:9', '9:16', '1:1', '4:5'].includes(p.aspect) ||
      !Array.isArray(data.assets) || data.assets.length > 200 ||
      !['clips', 'texts', 'music'].every(key => Array.isArray(p[key]) && p[key].length <= 1000)) throw invalid();
  const ids = new Set();
  for (const asset of data.assets) {
    if (!asset || !validId(asset.id) || ids.has(asset.id) || typeof asset.name !== 'string' || asset.name.length > 1024) throw invalid('素材データが不正です');
    ids.add(asset.id);
  }
  for (const item of [...p.clips, ...p.music]) if (!item || !ids.has(item.assetId)) throw invalid('プロジェクトの素材が不足しています');
}

export function createProjectArchive(project, assets) {
  const used = new Set([...project.clips, ...project.music].map(item => item.assetId));
  const source = [...used].map(id => {
    const asset = assets.get(id);
    if (!asset || !(asset.file instanceof Blob) || !asset.file.size) throw invalid('保存する素材が見つかりません');
    return asset;
  });
  let offset = 0;
  const packed = source.map(asset => {
    const entry = { id: asset.id, name: asset.file.name || asset.name, type: asset.file.type,
      lastModified: asset.file.lastModified || 0, offset, size: asset.file.size };
    offset += asset.file.size;
    if (!Number.isSafeInteger(offset)) throw invalid('素材の合計サイズが大きすぎます');
    return entry;
  });
  const data = { format: 'clippo', version: 3, project: structuredClone(project), assets: packed };
  validateManifest(data, 3);
  const manifest = encoder.encode(JSON.stringify(data));
  if (manifest.byteLength > MANIFEST_LIMIT) throw invalid('編集情報が大きすぎます');
  const header = new Uint8Array(HEADER_BYTES);
  header.set(encoder.encode(MAGIC));
  new DataView(header.buffer).setUint32(8, manifest.byteLength, true);
  return new Blob([header, manifest, ...source.map(asset => asset.file)], { type: 'application/x-clippo-project' });
}

export async function readProjectArchive(file) {
  if (!(file instanceof Blob) || !file.size) throw invalid('プロジェクトファイルが空です');
  const header = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
  if (new TextDecoder().decode(header.subarray(0, 8)) !== MAGIC) return readLegacy(file);
  if (header.length !== HEADER_BYTES) throw invalid('プロジェクトファイルが途中で切れています');
  const length = new DataView(header.buffer).getUint32(8, true), start = HEADER_BYTES + length;
  if (!length || length > MANIFEST_LIMIT || start > file.size) throw invalid('プロジェクトの編集情報が壊れています');
  let data;
  try { data = JSON.parse(await file.slice(HEADER_BYTES, start).text()); }
  catch { throw invalid('プロジェクトの編集情報を読み取れません'); }
  validateManifest(data, 3);
  let end = 0;
  const files = [];
  for (const asset of data.assets) {
    if (!validMime(asset.type) || !Number.isSafeInteger(asset.offset) || asset.offset !== end ||
        !Number.isSafeInteger(asset.size) || asset.size <= 0 || !Number.isSafeInteger(asset.offset + asset.size) ||
        asset.offset + asset.size > file.size - start) throw invalid('素材データが不足しているか、壊れています');
    end += asset.size;
    files.push({ id: asset.id, file: new File([file.slice(start + asset.offset, start + end)], asset.name,
      { type: asset.type, lastModified: Number.isFinite(asset.lastModified) ? asset.lastModified : 0 }) });
  }
  if (start + end !== file.size) throw invalid('プロジェクトファイルのサイズが一致しません');
  return { project: data.project, assets: files, version: 3 };
}

async function readLegacy(file) {
  // Old JSON/base64 projects still open, but reading unbounded JSON is unsafe.
  if (file.size > LEGACY_LIMIT) throw invalid('旧形式のプロジェクトが大きすぎます。元のアプリで開いて新形式で保存してください');
  let data;
  try { data = JSON.parse(await file.text()); } catch { throw invalid(); }
  validateManifest(data, 2);
  const files = [];
  for (const asset of data.assets) {
    if (typeof asset.data !== 'string') throw invalid('素材データが不正です');
    const match = /^data:([^;,]*);base64,([A-Za-z0-9+/]*={0,2})$/.exec(asset.data);
    if (!match || !validMime(match[1])) throw invalid('素材データが不正です');
    let bytes;
    try { bytes = Uint8Array.from(atob(match[2]), character => character.charCodeAt(0)); }
    catch { throw invalid('素材データが不正です'); }
    if (!bytes.length) throw invalid('素材ファイルが空です');
    files.push({ id: asset.id, file: new File([bytes], asset.name, { type: match[1] }) });
  }
  return { project: data.project, assets: files, version: 2 };
}
