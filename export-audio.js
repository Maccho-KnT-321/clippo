// A bounded, sample-clocked mixer. It never allocates the whole project's PCM.
// Output is stereo / 48 kHz; each call mixes at most one second.
export const EXPORT_SAMPLE_RATE = 48000;
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

export function segmentGain(segment, time) {
  const elapsed = time - segment.start, length = segment.end - segment.start;
  if (elapsed < 0 || elapsed >= length) return 0;
  let gain = clamp(segment.volume ?? 1, 0, 2);
  gain *= Math.min(1, segment.fadeIn > 0 ? elapsed / segment.fadeIn : 1, segment.fadeOut > 0 ? (length - elapsed) / segment.fadeOut : 1);
  // Video crossfades are independent of the clip's own fade handles.
  if (segment.crossIn > 0) gain *= Math.min(1, elapsed / segment.crossIn);
  if (segment.crossOut > 0) gain *= Math.min(1, (length - elapsed) / segment.crossOut);
  return gain;
}

export function mixDecodedBuffer(channels, blockStart, sampleRate, segment, wrapped) {
  const buffer = wrapped.buffer, speed = segment.speed || 1;
  const sourceEnd = wrapped.timestamp + buffer.length / buffer.sampleRate;
  const start = Math.max(blockStart, segment.start, segment.start + (wrapped.timestamp - segment.in) / speed);
  const end = Math.min(blockStart + channels[0].length / sampleRate, segment.end, segment.start + (sourceEnd - segment.in) / speed);
  const first = Math.max(0, Math.ceil((start - blockStart) * sampleRate - 1e-7));
  const last = Math.min(channels[0].length, Math.ceil((end - blockStart) * sampleRate - 1e-7));
  const sources = Array.from({ length: channels.length }, (_, channel) => buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1)));
  for (let index = first; index < last; index++) {
    const time = blockStart + index / sampleRate;
    const position = (segment.in + (time - segment.start) * speed - wrapped.timestamp) * buffer.sampleRate;
    const left = Math.max(0, Math.min(buffer.length - 1, Math.floor(position)));
    const right = Math.min(buffer.length - 1, left + 1), fraction = clamp(position - left, 0, 1);
    const gain = segmentGain(segment, time);
    for (let channel = 0; channel < channels.length; channel++) {
      const source = sources[channel];
      channels[channel][index] += (source[left] + (source[right] - source[left]) * fraction) * gain;
    }
  }
}

export function limitAudio(channels) {
  // Keep ordinary levels unchanged. A fixed, monotonic soft knee prevents
  // overlapping BGM / 200% volume from creating hard digital clipping.
  for (const channel of channels) for (let index = 0; index < channel.length; index++) {
    const sample = channel[index], level = Math.abs(sample);
    if (level > .9) channel[index] = Math.sign(sample) * (.9 + .1 * Math.tanh((level - .9) / .1));
  }
}
