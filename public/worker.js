/**
 * In-browser Whisper worker.
 *
 * Inference blocks whichever thread it runs on, so it lives here instead of
 * the main thread. Communicates via postMessage:
 *
 *   in  { type: "load",       model, quality }
 *   in  { type: "transcribe", audio: Float32Array, language, task, timestamps }
 *   out { type: "progress" | "ready" | "partial" | "done" | "error", … }
 */

import {
  pipeline,
  env,
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0";

// Weights come from the Hugging Face CDN and are cached by the browser.
env.allowLocalModels = false;

// Multi-threaded WASM needs SharedArrayBuffer, which needs COOP/COEP headers,
// which in turn block loading this library from a CDN. WebGPU is the fast path
// anyway, so keep the WASM fallback single-threaded and the page unisolated.
env.backends.onnx.wasm.numThreads = 1;

/** Per-quality dtype for the encoder/decoder pair. */
const QUALITY_DTYPE = {
  balanced: { encoder_model: "q4", decoder_model_merged: "q4" },
  accurate: { encoder_model: "fp16", decoder_model_merged: "q4" },
};

let pipe = null;
let loadedKey = null;

const post = (msg) => self.postMessage(msg);

async function ensureLoaded(model, quality) {
  const key = `${model}::${quality}`;
  if (pipe && loadedKey === key) return pipe;

  // Switching models: drop the old session so its VRAM is reclaimed.
  if (pipe) {
    try {
      await pipe.dispose();
    } catch {
      /* disposal is best-effort */
    }
    pipe = null;
    loadedKey = null;
  }

  const device = navigator.gpu ? "webgpu" : "wasm";
  post({ type: "progress", stage: "init", device, message: `Starting ${device.toUpperCase()} backend…` });

  pipe = await pipeline("automatic-speech-recognition", model, {
    dtype: QUALITY_DTYPE[quality] || QUALITY_DTYPE.balanced,
    device,
    progress_callback: (p) => {
      if (p.status === "progress" && p.file?.endsWith(".onnx")) {
        post({
          type: "progress",
          stage: "download",
          file: p.file,
          loaded: p.loaded,
          total: p.total,
          percent: p.progress || 0,
        });
      } else if (p.status === "ready") {
        post({ type: "progress", stage: "compile", message: "Compiling model…" });
      }
    },
  });

  loadedKey = key;
  post({ type: "ready", device, model });
  return pipe;
}

self.onmessage = async (event) => {
  const data = event.data;

  try {
    if (data.type === "load") {
      await ensureLoaded(data.model, data.quality);
      return;
    }

    if (data.type === "transcribe") {
      const transcriber = await ensureLoaded(data.model, data.quality);
      post({ type: "progress", stage: "infer", message: "Transcribing…" });

      const options = {
        // 30s windows with 5s overlap is Whisper's own long-form strategy.
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: data.timestamps ? true : false,
      };
      // whisper-*.en models reject these two arguments.
      if (!data.model.endsWith(".en")) {
        options.language = data.language === "auto" ? null : data.language;
        options.task = data.task || "transcribe";
      }

      const started = performance.now();
      const result = await transcriber(data.audio, options);
      post({
        type: "done",
        result,
        elapsedMs: Math.round(performance.now() - started),
      });
      return;
    }

    if (data.type === "dispose") {
      if (pipe) await pipe.dispose().catch(() => {});
      pipe = null;
      loadedKey = null;
      post({ type: "progress", stage: "idle", message: "Model unloaded." });
      return;
    }
  } catch (err) {
    post({
      type: "error",
      message: err?.message || String(err),
      stack: String(err?.stack || "").slice(0, 800),
    });
  }
};
