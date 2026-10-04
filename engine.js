// Browser-native compositor. Exports run in real time and require a visible tab.
import { layoutClips, projectDuration as duration } from './timeline.js';
export function supportedFormats() {
  if (!globalThis.MediaRecorder) return [];
  return ['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].filter(t => MediaRecorder.isTypeSupported(t));
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, Number(v) || 0));
const envelope = (elapsed, duration, fadeIn = 0, fadeOut = 0) => Math.min(1, fadeIn > 0 ? Math.max(0, elapsed / fadeIn) : 1, fadeOut > 0 ? Math.max(0, (duration - elapsed) / fadeOut) : 1);

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
  mediaContainer() {
    if (!this.mediaHost) {
      this.mediaHost = document.createElement('div');
      this.mediaHost.setAttribute('aria-hidden', 'true');
      // Keep decoders in the rendered DOM, including inside the modal top layer.
      // display:none / detached videos can fail to deliver fresh frames on iOS.
      this.mediaHost.style.cssText = 'position:fixed;right:1px;top:1px;width:4px;height:4px;opacity:.01;pointer-events:none;overflow:hidden';
    }
    const parent = document.querySelector('dialog[open]') || document.body;
    if (this.mediaHost.parentNode !== parent) parent.append(this.mediaHost);
    return this.mediaHost;
  }
  async audio() {
    if (!this.audioContext) {
      const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Audio) throw new Error('このブラウザは音声編集に対応していません。');
      this.audioContext = new Audio(); this.streamDestination = this.audioContext.createMediaStreamDestination();
      // Keep the recording audio clock running even for silent/photo-only projects.
      // An idle destination can otherwise leave MP4 timestamps with missing frames.
      this.silentClock = this.audioContext.createOscillator();
      this.silentGain = this.audioContext.createGain(); this.silentGain.gain.value = 0;
      this.silentClock.connect(this.silentGain).connect(this.streamDestination); this.silentClock.start();
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
    if (asset.type !== 'image') {
      el.preload = 'auto'; el.playsInline = true; el.setAttribute('playsinline', ''); el.setAttribute('webkit-playsinline', '');
      el.style.cssText='position:absolute;inset:0;width:4px;height:4px';
      this.mediaContainer().append(el);
    }
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
    const layout = layoutClips(project.clips);
    let visible = layout.filter(item => time >= item.start && time < item.end);
    if (!visible.length && layout.length) visible = [time < 0 ? layout[0] : layout.at(-1)];
    const progress = visible.length > 1 ? clamp((time - visible[1].start) / visible[0].overlap, 0, 1) : 0;
    const active = new Set();
    for (const item of visible) active.add(`clip:${item.clip.id}`);
    for (const m of project.music || []) if (time >= m.start && time < m.start + m.out - m.in) active.add(`music:${m.id}`);
    for (const [key, entry] of this.media) if (!active.has(key)) entry.el.pause?.();
    const visuals = [];
    for (const [index, item] of visible.entries()) {
      const clip = item.clip, elapsed = clamp(time - item.start, 0, item.duration);
      const key = `clip:${clip.id}`, visual = await this.element(clip.assetId, key);
      if (!current()) return;
      const fade = envelope(elapsed, item.duration, clip.fadeIn, clip.fadeOut);
      visuals.push({ visual, clip, fade });
      if (!(visual instanceof HTMLImageElement)) {
        if (visual.error) throw new Error('動画の再生中にエラーが発生しました。素材の形式をご確認ください。');
        const sourceTime = clip.in + elapsed * clamp(clip.speed || 1, .25, 4);
        visual.playbackRate = clamp(clip.speed || 1, .25, 4);
        const crossfade = visible.length > 1 ? (index === 0 ? 1 - progress : progress) : 1;
        const gain = this.node(visual, key); if (gain) gain.gain.value = clamp(clip.volume ?? 1, 0, 2) * fade * crossfade;
        // Seeking an already playing decoder every 220ms turns slow decoding
        // into a seek/stall loop. Align at activation, then let it play normally.
        if (!this.playing || visual.paused) await this.seek(visual, sourceTime);
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
    ctx.save();
    try {
    ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, w, h);
    if (visuals.length === 1) ctx.drawImage(this.visualFrame(visuals[0], 0), 0, 0);
    else if (visuals.length > 1) {
      const outgoing = this.visualFrame(visuals[0], 0), incoming = this.visualFrame(visuals[1], 1);
      const type = visible[0].clip.transition.type;
      if (type === 'black' || type === 'white') {
        ctx.fillStyle = type === 'white' ? '#ffffff' : '#000000'; ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = Math.abs(progress * 2 - 1); ctx.drawImage(progress < .5 ? outgoing : incoming, 0, 0); ctx.globalAlpha = 1;
      } else {
        ctx.drawImage(outgoing, 0, 0);
        if (type === 'wipe') { ctx.save(); ctx.beginPath(); ctx.rect(w * (1 - progress), 0, w * progress, h); ctx.clip(); ctx.drawImage(incoming, 0, 0); ctx.restore(); }
        else { ctx.globalAlpha = progress; ctx.drawImage(incoming, 0, 0); ctx.globalAlpha = 1; }
      }
    }
    for (const text of project.texts || []) {
      if (time < text.start || time >= text.end || !text.text) continue;
      ctx.globalAlpha = envelope(time - text.start, text.end - text.start, text.fadeIn ?? text.fade, text.fadeOut ?? text.fade);
      const size = clamp(text.size || 42, 12, 200) * Math.min(w, h) / 720;
      ctx.font = `700 ${size}px -apple-system, BlinkMacSystemFont, "Noto Sans JP", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const lines = [];
      for (const paragraph of text.text.split('\n')) {
        let line = ''; for (const char of paragraph) { if (line && ctx.measureText(line + char).width > w * .86) { lines.push(line); line = ''; } line += char; } lines.push(line);
      }
      const lineHeight = size * 1.4, block = lines.length * lineHeight;
      const x = text.x == null ? w / 2 : clamp(text.x, 0, 1) * w;
      const y = text.y != null ? clamp(text.y, 0, 1) * h : text.position === 'top' ? h * .12 + block / 2 : text.position === 'center' ? h / 2 : h * .86 - block / 2;
      if (text.background) { ctx.fillStyle = 'rgba(0,0,0,.64)'; const bw = Math.min(w * .94, Math.max(...lines.map(l => ctx.measureText(l).width)) + size); ctx.fillRect(x - bw / 2, y - block / 2 - size * .15, bw, block + size * .3); }
      ctx.fillStyle = text.color || '#ffffff'; ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = size * .15;
      lines.forEach((line, i) => ctx.fillText(line, x, y + (i - (lines.length - 1) / 2) * lineHeight)); ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
    } finally { ctx.restore(); }
  }
  visualFrame({ visual, clip, fade }, index) {
    this.layers ||= [];
    const layer = this.layers[index] ||= document.createElement('canvas');
    const w = this.canvas.width, h = this.canvas.height;
    if (layer.width !== w || layer.height !== h) { layer.width = w; layer.height = h; }
    const ctx = layer.getContext('2d');
    const vw = visual.videoWidth || visual.naturalWidth, vh = visual.videoHeight || visual.naturalHeight;
    if (!vw || !vh) throw new Error('映像フレームを読み込めません。');
    ctx.save(); ctx.clearRect(0, 0, w, h);
    const rotation = ((Number(clip.rotation) || 0) % 360 + 360) % 360, sideways = rotation === 90 || rotation === 270;
    const rw = sideways ? vh : vw, rh = sideways ? vw : vh;
    const scale = (clip.fit === 'cover' ? Math.max(w / rw, h / rh) : Math.min(w / rw, h / rh)) * clamp(clip.zoom ?? 1, 1, 3);
    const brightness = clamp(clip.brightness ?? 1, 0, 2), contrast = clamp(clip.contrast ?? 1, 0, 2), saturation = clamp(clip.saturation ?? 1, 0, 2);
    ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(rotation * Math.PI / 180); ctx.scale(clip.flipX ? -1 : 1, 1);
    if ('filter' in ctx && (brightness !== 1 || contrast !== 1 || saturation !== 1)) ctx.filter = `brightness(${brightness}) contrast(${contrast}) saturate(${saturation})`;
    ctx.drawImage(visual, -vw * scale / 2, -vh * scale / 2, vw * scale, vh * scale); ctx.restore();
    if (!('filter' in ctx) && (brightness !== 1 || contrast !== 1 || saturation !== 1)) {
      // Older Safari lacks canvas filters. Apply equivalent color math to opaque pixels.
      const pixels = ctx.getImageData(0, 0, w, h), data = pixels.data;
      for (let i = 0; i < data.length; i += 4) {
        const r = (data[i] * brightness - 127.5) * contrast + 127.5, g = (data[i + 1] * brightness - 127.5) * contrast + 127.5, b = (data[i + 2] * brightness - 127.5) * contrast + 127.5;
        const gray = r * .2126 + g * .7152 + b * .0722;
        data[i] = gray + (r - gray) * saturation; data[i + 1] = gray + (g - gray) * saturation; data[i + 2] = gray + (b - gray) * saturation;
      }
      ctx.putImageData(pixels, 0, 0);
    }
    ctx.save(); ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, w, h); ctx.restore();
    if (fade < 1) { ctx.fillStyle = `rgba(0,0,0,${1 - fade})`; ctx.fillRect(0, 0, w, h); }
    ctx.restore(); return layer;
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
    const start = performance.now(), total = duration(project);let lastRender=start-34;
    const tick = async () => {
      if (generation !== this.generation) return;
      const now=performance.now();
      if(this.exporting&&now-lastRender<1000/30-1){this.frame=requestAnimationFrame(tick);return;}
      lastRender=now;
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
      this.mediaContainer();
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
        let windowStart=performance.now(), renderedFrames=0;
        const decoderSamples=new Map();
        recorder.start(1000);
        this.play(project, 0, t => {
          renderedFrames++;
          const now=performance.now();
          if(now-windowStart>=1500){
            const fps=renderedFrames*1000/(now-windowStart);
            if(fps<15){stop(new Error('この端末では映像処理が追いつかず、滑らかに書き出せませんでした。720pを選び、ほかのアプリを閉じて再試行してください。'));return;}
            windowStart=now;renderedFrames=0;
          }
          for(const [key,{el}]of this.media){
            if(!(el instanceof HTMLVideoElement)||el.paused)continue;
            const frames=el.getVideoPlaybackQuality?.().totalVideoFrames;
            if(frames==null)continue;
            const previous=decoderSamples.get(key);
            if(!previous||previous.frames!==frames)decoderSamples.set(key,{frames,at:now});
            else if(now-previous.at>1000){stop(new Error('動画のフレーム更新が止まったため書き出しを中止しました。720pで再試行するか、素材をH.264のMP4に変換してください。'));return;}
          }
          // captureStream(30) already samples canvas changes. Explicitly requesting
          // every rAF adds up to 60/120fps work on high-refresh phones.
          onProgress(t/duration(project));
        }, error => stop(error)).catch(stop);
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
    if (entry) { entry.el.removeAttribute('src'); entry.el.load?.(); entry.el.remove(); }
    this.nodes.delete(key); this.media.delete(key);
  }
  dispose() { this.pause(); for (const key of this.media.keys()) this.release(key); this.mediaHost?.remove(); this.silentClock?.stop(); this.silentGain?.disconnect(); this.audioContext?.close(); }
}
