const $ = (selector) => document.querySelector(selector);
const fileInput = $("#fileInput");
const video = $("#video");
const emptyState = $("#emptyState");
const editor = $("#editor");
const startRange = $("#startRange");
const endRange = $("#endRange");
const playButton = $("#playButton");
let objectUrl = null;
let sourceFile = null;
let exporting = false;

const formatTime = (seconds, precise = false) => {
  if (!Number.isFinite(seconds)) return precise ? "0:00.0" : "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = precise ? (seconds % 60).toFixed(1).padStart(4, "0") : Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
};

function updateSelection(changed) {
  let start = Number(startRange.value);
  let end = Number(endRange.value);
  if (end - start < 0.4) {
    if (changed === "start") startRange.value = Math.max(0, end - 0.4);
    else endRange.value = Math.min(video.duration, start + 0.4);
  }
  start = Number(startRange.value);
  end = Number(endRange.value);
  const startPct = (start / video.duration) * 100;
  const endPct = (end / video.duration) * 100;
  $("#rangeFill").style.left = `${startPct}%`;
  $("#rangeFill").style.right = `${100 - endPct}%`;
  $("#startTime").textContent = formatTime(start, true);
  $("#endTime").textContent = formatTime(end, true);
  $("#selectionLength").textContent = formatTime(end - start);
}

function updatePlaybackUi() {
  $("#previewTime").textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
  playButton.innerHTML = video.paused
    ? '<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7z"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zm6 0h4v14h-4z"/></svg>';
  playButton.setAttribute("aria-label", video.paused ? "再生" : "一時停止");
  if (!exporting && video.currentTime >= Number(endRange.value)) {
    video.pause();
    video.currentTime = Number(startRange.value);
  }
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  sourceFile = file;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  video.src = objectUrl;
  video.addEventListener("loadedmetadata", () => {
    startRange.max = endRange.max = video.duration;
    startRange.value = 0;
    endRange.value = video.duration;
    emptyState.hidden = true;
    editor.hidden = false;
    updateSelection();
    updatePlaybackUi();
  }, { once: true });
});

startRange.addEventListener("input", () => { updateSelection("start"); video.currentTime = Number(startRange.value); });
endRange.addEventListener("input", () => { updateSelection("end"); video.currentTime = Number(endRange.value); });
video.addEventListener("timeupdate", updatePlaybackUi);
video.addEventListener("play", updatePlaybackUi);
video.addEventListener("pause", updatePlaybackUi);
playButton.addEventListener("click", () => {
  if (video.paused) {
    if (video.currentTime < Number(startRange.value) || video.currentTime >= Number(endRange.value)) video.currentTime = Number(startRange.value);
    video.play();
  } else video.pause();
});
$("#setStart").addEventListener("click", () => { startRange.value = Math.min(video.currentTime, Number(endRange.value) - 0.4); updateSelection("start"); });
$("#setEnd").addEventListener("click", () => { endRange.value = Math.max(video.currentTime, Number(startRange.value) + 0.4); updateSelection("end"); });
$("#brightness").addEventListener("input", (event) => {
  const value = event.target.value;
  $("#brightnessValue").textContent = `${value}%`;
  video.style.setProperty("--brightness", value / 100);
});
$("#changeVideo").addEventListener("click", () => fileInput.click());

function canvasSize() {
  const sourceRatio = video.videoWidth / video.videoHeight;
  const selected = $("#aspect").value;
  const ratio = selected === "source" ? sourceRatio : ({ "9:16": 9 / 16, "1:1": 1, "16:9": 16 / 9 })[selected];
  const max = 1080;
  return ratio >= 1 ? { width: max, height: Math.round(max / ratio) } : { width: Math.round(max * ratio), height: max };
}

function drawFrame(ctx, canvas) {
  const sourceRatio = video.videoWidth / video.videoHeight;
  const targetRatio = canvas.width / canvas.height;
  let sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight;
  if (sourceRatio > targetRatio) { sw = video.videoHeight * targetRatio; sx = (video.videoWidth - sw) / 2; }
  else { sh = video.videoWidth / targetRatio; sy = (video.videoHeight - sh) / 2; }
  ctx.filter = `brightness(${$("#brightness").value}%)`;
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
}

$("#exportButton").addEventListener("click", async () => {
  if (!sourceFile || exporting) return;
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
    alert("このブラウザは動画の書き出しに対応していません。最新版の Chrome または Edge をお試しください。");
    return;
  }
  exporting = true;
  const button = $("#exportButton");
  button.disabled = true;
  $("#exportStatus").hidden = false;
  const canvas = $("#renderCanvas");
  Object.assign(canvas, canvasSize());
  const ctx = canvas.getContext("2d", { alpha: false });
  const canvasStream = canvas.captureStream(30);
  let exportStream = canvasStream;
  let audioContext;
  if ($("#audioToggle").checked) {
    try {
      audioContext = new AudioContext();
      const source = audioContext.createMediaElementSource(video);
      const destination = audioContext.createMediaStreamDestination();
      source.connect(destination);
      source.connect(audioContext.destination);
      exportStream = new MediaStream([...canvasStream.getVideoTracks(), ...destination.stream.getAudioTracks()]);
    } catch (_) { /* Some browsers only allow one media source connection. */ }
  }
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm";
  const recorder = new MediaRecorder(exportStream, { mimeType, videoBitsPerSecond: 5_000_000 });
  const chunks = [];
  recorder.addEventListener("dataavailable", (event) => { if (event.data.size) chunks.push(event.data); });
  const finished = new Promise((resolve) => recorder.addEventListener("stop", resolve, { once: true }));
  video.currentTime = Number(startRange.value);
  await new Promise((resolve) => video.addEventListener("seeked", resolve, { once: true }));
  recorder.start(250);
  await video.play();
  const start = Number(startRange.value);
  const end = Number(endRange.value);
  await new Promise((resolve) => {
    const render = () => {
      drawFrame(ctx, canvas);
      const pct = Math.min(100, ((video.currentTime - start) / (end - start)) * 100);
      $("#progress").value = pct;
      $("#progressText").textContent = `${Math.round(pct)}%`;
      if (video.currentTime >= end || video.ended) { video.pause(); recorder.stop(); resolve(); }
      else requestAnimationFrame(render);
    };
    render();
  });
  await finished;
  const blob = new Blob(chunks, { type: mimeType });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${sourceFile.name.replace(/\.[^.]+$/, "")}-clippo.webm`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 3000);
  if (audioContext) await audioContext.close();
  button.disabled = false;
  $("#exportStatus").hidden = true;
  exporting = false;
});
