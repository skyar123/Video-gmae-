/**
 * Audio ingest. Whisper wants 16 kHz mono float32, so everything the browser
 * can decode is normalised to that before it reaches an engine.
 */

export const WHISPER_SAMPLE_RATE = 16_000;

/** Decode any browser-supported container to mono 16 kHz Float32. */
export async function decodeToMono16k(blob) {
  const bytes = await blob.arrayBuffer();

  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  let decoded;
  try {
    decoded = await ctx.decodeAudioData(bytes.slice(0));
  } finally {
    ctx.close();
  }

  const frames = Math.max(1, Math.ceil(decoded.duration * WHISPER_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, frames, WHISPER_SAMPLE_RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();

  return {
    samples: rendered.getChannelData(0),
    duration: decoded.duration,
    originalSampleRate: decoded.sampleRate,
    originalChannels: decoded.numberOfChannels,
  };
}

/** Float32 [-1,1] -> 16-bit PCM WAV. Used to hand audio to remote engines. */
export function encodeWav(samples, sampleRate = WHISPER_SAMPLE_RATE) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * Split long audio into windows for engines with an upload ceiling.
 * Overlap gives the model context either side of a cut; `offset` lets the
 * caller shift returned timestamps back onto the original timeline.
 */
export function splitSamples(samples, windowSec, overlapSec = 2, rate = WHISPER_SAMPLE_RATE) {
  const windowLen = Math.floor(windowSec * rate);
  const overlapLen = Math.floor(overlapSec * rate);

  if (samples.length <= windowLen) {
    return [{ samples, offset: 0 }];
  }

  const parts = [];
  let start = 0;
  while (start < samples.length) {
    const end = Math.min(start + windowLen, samples.length);
    parts.push({ samples: samples.subarray(start, end), offset: start / rate });
    if (end === samples.length) break;
    start = end - overlapLen;
  }
  return parts;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
