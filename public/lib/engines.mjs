/**
 * Transcription engines behind one interface.
 *
 *   run({ samples, duration, language, task, timestamps }, hooks)
 *     -> { text, segments: [{start, end, text}], language, engine, model }
 *
 * `hooks.onProgress({ stage, message, percent })` reports back to the UI.
 */

import { encodeWav, splitSamples, WHISPER_SAMPLE_RATE } from "./audio.mjs";

// ── Model catalogue ─────────────────────────────────────────

export const BROWSER_MODELS = [
  {
    id: "onnx-community/whisper-tiny",
    label: "Tiny",
    downloadMb: 92,
    note: "Fastest. Fine for clear speech and quick drafts.",
  },
  {
    id: "onnx-community/whisper-base",
    label: "Base",
    downloadMb: 136,
    note: "Good default on modest hardware.",
  },
  {
    id: "onnx-community/whisper-small",
    label: "Small",
    downloadMb: 285,
    note: "Noticeably better on accents and noise.",
  },
  {
    id: "onnx-community/whisper-large-v3-turbo",
    label: "Large v3 Turbo",
    downloadMb: 724,
    note: "Best accuracy available. Needs a capable GPU and a big first download.",
  },
];

export const GROQ_MODELS = [
  {
    id: "whisper-large-v3-turbo",
    label: "Large v3 Turbo",
    note: "Fastest. Best price/accuracy on Groq's free tier.",
  },
  {
    id: "whisper-large-v3",
    label: "Large v3",
    note: "Highest accuracy, slightly slower. Supports translation.",
  },
];

export const LANGUAGES = [
  ["auto", "Detect automatically"], ["en", "English"], ["es", "Spanish"],
  ["fr", "French"], ["de", "German"], ["it", "Italian"], ["pt", "Portuguese"],
  ["nl", "Dutch"], ["ru", "Russian"], ["zh", "Chinese"], ["ja", "Japanese"],
  ["ko", "Korean"], ["ar", "Arabic"], ["hi", "Hindi"], ["tr", "Turkish"],
  ["pl", "Polish"], ["uk", "Ukrainian"], ["vi", "Vietnamese"], ["id", "Indonesian"],
  ["sv", "Swedish"], ["da", "Danish"], ["no", "Norwegian"], ["fi", "Finnish"],
  ["he", "Hebrew"], ["el", "Greek"], ["cs", "Czech"], ["ro", "Romanian"],
  ["hu", "Hungarian"], ["th", "Thai"], ["fa", "Persian"],
];

// ── Shared helpers ──────────────────────────────────────────

/** transformers.js returns `chunks` with `timestamp: [start, end]`. */
function normaliseBrowserChunks(result, offset = 0) {
  if (!result.chunks?.length) return [];
  return result.chunks
    .map((c) => ({
      start: (c.timestamp?.[0] ?? 0) + offset,
      end: c.timestamp?.[1] == null ? null : c.timestamp[1] + offset,
      text: (c.text || "").trim(),
    }))
    .filter((c) => c.text);
}

/** Drop segments a window-overlap produced twice. */
function dedupeSegments(segments) {
  const out = [];
  for (const seg of segments) {
    const prev = out[out.length - 1];
    if (prev && seg.text === prev.text && Math.abs(seg.start - prev.start) < 2) continue;
    out.push(seg);
  }
  return out;
}

const joinText = (segments, fallback) =>
  segments.length ? segments.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim() : fallback;

// ── In-browser engine (transformers.js in a worker) ─────────

export class BrowserEngine {
  constructor() {
    this.worker = null;
    this.pending = null;
    this.device = null;
  }

  /** WebGPU is dramatically faster; WASM still works on anything. */
  static async probe() {
    if (!("gpu" in navigator)) return { device: "wasm", reason: "WebGPU not available in this browser." };
    try {
      const adapter = await navigator.gpu.requestAdapter();
      return adapter
        ? { device: "webgpu" }
        : { device: "wasm", reason: "No WebGPU adapter — falling back to WASM." };
    } catch {
      return { device: "wasm", reason: "WebGPU probe failed — falling back to WASM." };
    }
  }

  #ensureWorker() {
    if (this.worker) return this.worker;
    this.worker = new Worker("/worker.js", { type: "module" });

    this.worker.onmessage = (e) => {
      const msg = e.data;
      if (!this.pending) return;

      if (msg.type === "progress") {
        this.pending.hooks?.onProgress?.(msg);
      } else if (msg.type === "ready") {
        this.device = msg.device;
        this.pending.hooks?.onProgress?.({ stage: "ready", device: msg.device });
      } else if (msg.type === "done") {
        const { resolve } = this.pending;
        this.pending = null;
        resolve(msg);
      } else if (msg.type === "error") {
        const { reject } = this.pending;
        this.pending = null;
        reject(new Error(msg.message));
      }
    };

    // A module worker that fails to load reports an ErrorEvent with no
    // message, so say what actually tends to cause it.
    this.worker.onerror = (e) => {
      const p = this.pending;
      this.pending = null;
      const detail = e?.message || e?.error?.message;
      p?.reject(new Error(
        detail
          ? `Worker error: ${detail}`
          : "The transcription worker could not load. This usually means the " +
            "transformers.js CDN was unreachable — check your connection and retry."
      ));
    };

    return this.worker;
  }

  #send(payload, hooks) {
    const worker = this.#ensureWorker();
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject, hooks };
      worker.postMessage(payload);
    });
  }

  async run(job, hooks = {}) {
    const { samples, language, task, timestamps, model, quality } = job;

    // The worker takes ownership of the buffer, so hand it a copy.
    const audio = new Float32Array(samples);
    const msg = await this.#send(
      { type: "transcribe", audio, model, quality, language, task, timestamps },
      hooks
    );

    const segments = dedupeSegments(normaliseBrowserChunks(msg.result));
    return {
      text: joinText(segments, (msg.result.text || "").trim()),
      segments,
      engine: "browser",
      model,
      device: this.device,
      elapsedMs: msg.elapsedMs,
    };
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.pending = null;
  }
}

// ── Groq engine ─────────────────────────────────────────────

/**
 * Groq caps uploads at 25MB. 16 kHz mono WAV is 32 KB/s, so ~13 minutes fits;
 * anything longer is windowed and stitched back together.
 */
const GROQ_WINDOW_SEC = 10 * 60;
const GROQ_OVERLAP_SEC = 2;
const GROQ_DIRECT_URL = "https://api.groq.com/openai/v1/audio";

export class GroqEngine {
  constructor({ apiKey, useProxy }) {
    this.apiKey = (apiKey || "").trim();
    this.useProxy = Boolean(useProxy);
  }

  async #call(endpoint, form, hooks) {
    const url = this.useProxy ? `/api/transcribe?endpoint=${endpoint}` : `${GROQ_DIRECT_URL}/${endpoint}`;
    const headers = {};
    if (!this.useProxy) {
      if (!this.apiKey) throw new Error("No Groq API key set. Add one in Settings, or switch to the in-browser engine.");
      headers.authorization = `Bearer ${this.apiKey}`;
    }

    const res = await fetch(url, { method: "POST", headers, body: form });
    const raw = await res.text();

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new Error(`Groq returned a non-JSON response (HTTP ${res.status}): ${raw.slice(0, 200)}`);
    }

    if (!res.ok) {
      const detail = body?.error?.message || body?.message || `HTTP ${res.status}`;
      if (res.status === 401) throw new Error(`Groq rejected the API key: ${detail}`);
      if (res.status === 429) throw new Error(`Groq rate limit reached: ${detail}`);
      throw new Error(detail);
    }
    return body;
  }

  async run(job, hooks = {}) {
    const { samples, language, task, model } = job;
    const endpoint = task === "translate" ? "translations" : "transcriptions";
    const windows = splitSamples(samples, GROQ_WINDOW_SEC, GROQ_OVERLAP_SEC);

    const allSegments = [];
    const texts = [];
    let detected = null;

    for (const [i, part] of windows.entries()) {
      hooks.onProgress?.({
        stage: "upload",
        message: windows.length > 1 ? `Uploading part ${i + 1} of ${windows.length}…` : "Uploading to Groq…",
        percent: (i / windows.length) * 100,
      });

      const form = new FormData();
      form.append("file", encodeWav(part.samples, WHISPER_SAMPLE_RATE), `audio-${i}.wav`);
      form.append("model", model);
      form.append("response_format", "verbose_json");
      // The translations endpoint always targets English and rejects `language`.
      if (endpoint === "transcriptions" && language && language !== "auto") {
        form.append("language", language);
      }

      const body = await this.#call(endpoint, form, hooks);
      detected = detected || body.language;
      if (body.text) texts.push(body.text.trim());

      for (const seg of body.segments || []) {
        allSegments.push({
          start: (seg.start || 0) + part.offset,
          end: (seg.end ?? seg.start ?? 0) + part.offset,
          text: (seg.text || "").trim(),
        });
      }
    }

    const segments = dedupeSegments(allSegments.filter((s) => s.text));
    return {
      text: joinText(segments, texts.join(" ").trim()),
      segments,
      language: detected,
      engine: "groq",
      model,
    };
  }

  dispose() {}
}
