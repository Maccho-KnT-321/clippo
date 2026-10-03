// Browser-native compositor. Exports run in real time and require a visible tab.
export function supportedFormats() {
  if (!globalThis.MediaRecorder) return [];
  return ['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].filter(t => MediaRecorder.isTypeSupported(t));
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, Number(v) || 0));
const length = c => Math.max(0, (c.out - c.in) / (c.speed || 1));
const duration = p => p.clips.reduce((n, c) => n + length(c), 0);

function eventReady(element, event, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('メディアの読み込みがタイムアウトしました。対応する形式か確認してください。')), timeout);
    const good = () => finish();
    const bad = () => finish(new Error('この端末ではメディアを再生できません。MP4（H.264/AAC）に変換してお試しください。'));
    function finish(error) { clearTimeout(timer); element.removeEventListener(event, good); element.removeEventListener('error', bad); error ? reject(error) : resolve(); }
    element.addEventListener(event, good, { once: true }); element.addEventListener('error', bad, { once: true });
  });
}

export class EditorEngine {
  constructor(canvas, assets) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d', { alpha: false }); this.assets = assets;
    this.media = new Map(); this.nodes = new Map(); this.playing = false; this.generation = 0; this.renderQueue = Promise.resolve();
  }
  async audio() {
    if (!this.audioContext) {
      const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Audio) throw new Error('このブラウザは音声編集に対応していません。');
      this.audioContext = new Audio(); this.streamDestination = this.audioContext.createMediaStreamDestination();
      this.speaker = this.audioContext.createGain(); this.speaker.connect(this.audioContext.destination);
    }
    if (this.audioContext.state !== 'running') await this.audioContext.resume();
    if (this.audioContext.state !== 'running') throw new Error('音声を有効にできませんでした。画面をタップして再試行してください。');
  }
  async element(assetId, key) {
    const asset = this.assets.get(assetId);
    if (!asset) throw new Error('素材が見つかりません。動画を読み込み直してください。');
    if (this.media.has(key)) {
      const entry = this.media.get(key);
      if (entry.assetId === assetId) { await entry.ready; return entry.el; }
      this.release(key);
    }
    const el = asset.type === 'image' ? new Image() : document.createElement(asset.type === 'audio' ? 'audio' : 'video');
    if (asset.type !== 'image') { el.preload = 'auto'; el.playsInline = true; el.setAttribute('playsinline', ''); el.setAttribute('webkit-playsinline', ''); }
    const ready = eventReady(el, asset.type === 'image' ? 'load' : 'loadeddata');
    this.media.set(key, { el, assetId, ready }); el.src = asset.url;
    if (asset.type !== 'image') el.load();
    await ready; return el;
  }
  node(el, key) {
    if (!this.audioContext || el instanceof HTMLImageElement) return;
    if (!this.nodes.has(key)) {
      const source = this.audioContext.createMediaElementSource(el), gain = this.audioContext.createGain();
      source.connect(gain); gain.connect(this.speaker); gain.connect(this.streamDestination);
      this.nodes.set(key, { source, gain });
    }
    return this.nodes.get(key).gain;
  }
  async seek(el, value) {
    if (el instanceof HTMLImageElement) return;
    const t = Math.min(Math.max(0, value), Math.max(0, (el.duration || value + 1) - .001));
    if (Math.abs(el.currentTime - t) < .025 && el.readyState >= 2) return;
    const pending = eventReady(el, 'seeked'); el.currentTime = t; await pending;
  }
  render(project, time) {
    const generation = this.generation;
    const operation = () => generation === this.generation ? this.draw(project, time, generation) : undefined;
    this.renderQueue = this.renderQueue.then(operation, operation);
    return this.renderQueue;
  }
  async draw(project, time, generation = this.generation) {
    const current = () => generation === this.generation;
    const retained = new Set([...project.clips.map(c => `clip:${c.id}`), ...(project.music || []).map(m => `music:${m.id}`)]);
    for (const key of this.media.keys()) if (!retained.has(key)) this.release(key);
    let offset = 0, clip;
    for (const c of project.clips) { if (time < offset + length(c)) { clip = c; break; } offset += length(c); }
    if (!clip && project.clips.length) { clip = project.clips.at(-1); offset = duration(project) - length(clip); }
    const active = new Set();
    if (clip) active.add(`clip:${clip.id}`);
    for (const m of project.music || []) if (time >= m.start && time < m.start + m.out - m.in) active.add(`music:${m.id}`);
    for (const [key, entry] of this.media) if (!active.has(key)) entry.el.pause?.();
    let visual;
    if (clip) {
      const key = `clip:${clip.id}`; active.add(key); visual = await this.element(clip.assetId, key);
      if (!current()) return;
      if (!(visual instanceof HTMLImageElement)) {
        if (visual.error) throw new Error('動画の再生中にエラーが発生しました。素材の形式をご確認ください。');
        const sourceTime = clip.in + clamp(time - offset, 0, length(clip)) * (clip.speed || 1);
        visual.playbackRate = clamp(clip.speed || 1, .25, 4);
        const gain = this.node(visual, key); if (gain) gain.gain.value = clamp(clip.volume ?? 1, 0, 2);
        if (!this.playing || Math.abs(visual.currentTime - sourceTime) > .22) await this.seek(visual, sourceTime);
        if (!current()) return;
        if (this.playing && visual.paused) await visual.play();
        if (!current()) { visual.pause(); return; }
      }
    }
    for (const music of project.music || []) {
      const elapsed = time - music.start, len = music.out - music.in;
      if (elapsed < 0 || elapsed >= len) continue;
      const key = `music:${music.id}`; active.add(key);
      const el = await this.element(music.assetId, key);
      if (!current()) return;
      const gain = this.node(el, key);
      if (el.error) throw new Error('音楽の再生中にエラーが発生しました。素材の形式をご確認ください。');
      let volume = clamp(music.volume ?? 1, 0, 2);
      if (music.fadeIn) volume *= Math.min(1, elapsed / music.fadeIn);
      if (music.fadeOut) volume *= Math.min(1, (len - elapsed) / music.fadeOut);
      if (gain) gain.gain.value = volume;
      if (!this.playing || Math.abs(el.currentTime - (music.in + elapsed)) > .22) await this.seek(el, music.in + elapsed);
      if (!current()) return;
      if (this.playing && el.paused) await el.play();
      if (!current()) { el.pause(); return; }
    }
    for (const [key, entry] of this.media) if (!active.has(key)) entry.el.pause?.();
    const ctx = this.ctx, w = this.canvas.width, h = this.canvas.height;
    ctx.save(); ctx.fillStyle = '#080a0e'; ctx.fillRect(0, 0, w, h);
    if (visual) {
      const vw = visual.videoWidth || visual.naturalWidth, vh = visual.videoHeight || visual.naturalHeight;
      if (!vw || !vh) { ctx.restore(); throw new Error('映像フレームを読み込めません。'); }
      const scale = clip.fit === 'cover' ? Math.max(w / vw, h / vh) : Math.min(w / vw, h / vh);
      const brightness = clamp(clip.brightness ?? 1, 0, 2);
      if ('filter' in ctx) ctx.filter = `brightness(${brightness})`;
      ctx.drawImage(visual, (w - vw * scale) / 2, (h - vh * scale) / 2, vw * scale, vh * scale);
      if ('filter' in ctx) ctx.filter = 'none';
      else if (brightness !== 1) {
        ctx.globalCompositeOperation = brightness < 1 ? 'source-over' : 'screen';
        ctx.fillStyle = brightness < 1 ? `rgba(0,0,0,${1 - brightness})` : `rgba(255,255,255,${brightness - 1})`;
        ctx.fillRect(0, 0, w, h); ctx.globalCompositeOperation = 'source-over';
      }
    }
    for (const text of project.texts || []) {
      if (time < text.start || time >= text.end || !text.text) continue;
      const size = clamp(text.size || 42, 12, 200) * Math.min(w, h) / 720;
      ctx.font = `700 ${size}px -apple-system, BlinkMacSystemFont, "Noto Sans JP", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const lines = [];
      for (const paragraph of text.text.split('\n')) {
        let line = ''; for (const char of paragraph) { if (line && ctx.measureText(line + char).width > w * .86) { lines.push(line); line = ''; } line += char; } lines.push(line);
      }
      const lineHeight = size * 1.4, block = lines.length * lineHeight;
      const y = text.position === 'top' ? h * .12 + block / 2 : text.position === 'center' ? h / 2 : h * .86 - block / 2;
      if (text.background) { ctx.fillStyle = 'rgba(0,0,0,.64)'; const bw = Math.min(w * .94, Math.max(...lines.map(l => ctx.measureText(l).width)) + size); ctx.fillRect((w - bw) / 2, y - block / 2 - size * .15, bw, block + size * .3); }
      ctx.fillStyle = text.color || '#ffffff'; ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = size * .15;
      lines.forEach((line, i) => ctx.fillText(line, w / 2, y + (i - (lines.length - 1) / 2) * lineHeight)); ctx.shadowBlur = 0;
    }
    ctx.restore();
  }
  pause() { this.playing = false; this.generation++; cancelAnimationFrame(this.frame); for (const { el } of this.media.values()) el.pause?.(); }
  async play(project, time = 0, onTime = () => {}, onEnd = () => {}) {
    this.pause();
    const generation = this.generation;
    await this.audio();
    if (generation !== this.generation) return;
    await this.render(project, time);
    if (generation !== this.generation) return;
    this.playing = true;
    const start = performance.now(), total = duration(project);
    const tick = async () => {
      if (generation !== this.generation) return;
      const t = Math.min(total, time + (performance.now() - start) / 1000);
      try {
        if (this.audioContext.state !== 'running') throw new Error('音声処理が中断されました。画面を表示して再試行してください。');
        await this.render(project, t); if (generation !== this.generation) return; onTime(t);
      }
      catch (error) { if (generation === this.generation) { this.pause(); onEnd(error); } return; }
      if (generation !== this.generation) return;
      if (t >= total) { this.pause(); onEnd(); } else this.frame = requestAnimationFrame(tick);
    };
    await tick();
  }
  async export(project, { height = 720, mimeType = supportedFormats()[0], onProgress = () => {}, signal } = {}) {
    if (this.exporting) throw new Error('書き出し中です。');
    if (!project.clips.length || duration(project) <= 0) throw new Error('タイムラインに素材を追加してください。');
    if (!mimeType || !globalThis.MediaRecorder || !this.canvas.captureStream) throw new Error('このブラウザでは書き出せません。最新のSafariまたはChromeをお試しください。');
    if (document.hidden) throw new Error('画面を表示した状態で書き出してください。');
    if (signal?.aborted) throw new DOMException('キャンセルしました', 'AbortError');
    this.exporting = true; this.pause(); const oldWidth = this.canvas.width, oldHeight = this.canvas.height;
    let stream, recorder, visibility, abort;
    try {
      await this.audio();
      // Let any cancelled preview seek settle before preparing export media.
      await this.renderQueue.catch(() => {});
      // Preload all timeline instances before starting the recording clock.
      for (const c of project.clips) {
        if (signal?.aborted) throw new DOMException('キャンセルしました', 'AbortError');
        const el = await this.element(c.assetId, `clip:${c.id}`); this.node(el, `clip:${c.id}`); await this.seek(el, c.in);
      }
      for (const m of project.music || []) {
        if (signal?.aborted) throw new DOMException('キャンセルしました', 'AbortError');
        const el = await this.element(m.assetId, `music:${m.id}`); this.node(el, `music:${m.id}`); await this.seek(el, m.in);
      }
      const [aw, ah] = project.aspect.split(':').map(Number);
      const ratio=aw/ah;
      this.canvas.height = Math.round((ratio>=1?height:height/ratio) / 2) * 2; this.canvas.width = Math.round((ratio>=1?height*ratio:height) / 2) * 2;
      await this.render(project, 0);
      stream = this.canvas.captureStream(30);
      for (const track of this.streamDestination.stream.getAudioTracks()) stream.addTrack(track.clone());
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: Math.max(3500000, height * height * 8), audioBitsPerSecond: 192000 });
      const chunks = [];
      await new Promise((resolve, reject) => {
        let failure, settled = false;
        const stop = error => { if (settled) return; failure ||= error; this.pause(); if (recorder.state !== 'inactive') recorder.stop(); else { settled = true; error ? reject(error) : resolve(); } };
        abort = () => stop(new DOMException('キャンセルしました', 'AbortError'));
        visibility = () => { if (document.hidden) stop(new Error('書き出し中に画面が非表示になりました。画面を開いたまま再試行してください。')); };
        recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
        recorder.onerror = event => stop(event.error || new Error('動画の書き出しに失敗しました。'));
        recorder.onstop = () => { settled = true; failure ? reject(failure) : resolve(); };
        document.addEventListener('visibilitychange', visibility); signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) { abort(); return; }
        if (document.hidden) { visibility(); return; }
        recorder.start(250);
        this.play(project, 0, t => onProgress(t / duration(project)), error => stop(error)).catch(stop);
      });
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType });
      if (!blob.size) throw new Error('書き出された動画が空でした。');
      onProgress(1); return blob;
    } finally {
      this.pause(); document.removeEventListener('visibilitychange', visibility); signal?.removeEventListener('abort', abort);
      if (recorder?.state !== 'inactive' && recorder) recorder.stop();
      stream?.getTracks().forEach(track => track.stop());
      this.canvas.width = oldWidth; this.canvas.height = oldHeight; this.exporting = false;
    }
  }
  release(key) {
    const entry = this.media.get(key), node = this.nodes.get(key);
    entry?.el.pause?.();
    node?.source.disconnect(); node?.gain.disconnect();
    if (entry) { entry.el.removeAttribute('src'); entry.el.load?.(); }
    this.nodes.delete(key); this.media.delete(key);
  }
  dispose() { this.pause(); for (const key of this.media.keys()) this.release(key); this.audioContext?.close(); }
}
