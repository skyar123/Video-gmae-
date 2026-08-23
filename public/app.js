/**
 * Whisper Studio — controller.
 *
 * Owns the UI, hands audio to whichever engine is selected, and renders the
 * transcript. Engine specifics live in lib/engines.mjs.
 */

import { decodeToMono16k, formatDuration, formatBytes } from "/lib/audio.mjs";
import { FORMATS } from "/lib/export.mjs";
import {
  BrowserEngine,
  GroqEngine,
  BROWSER_MODELS,
  GROQ_MODELS,
  LANGUAGES,
} from "/lib/engines.mjs";

const STORAGE_KEY = "whisper-studio/settings";

const $ = (id) => document.getElementById(id);
const el = {
  enginePill: $("enginePill"), engineText: $("engineText"),
  settingsBtn: $("settingsBtn"), settings: $("settings"),
  closeSettings: $("closeSettings"), forgetBtn: $("forgetBtn"), settingsNote: $("settingsNote"),
  browserModel: $("browserModel"), browserModelNote: $("browserModelNote"),
  quality: $("quality"), deviceNote: $("deviceNote"),
  groqModel: $("groqModel"), groqModelNote: $("groqModelNote"), groqKey: $("groqKey"),
  dropZone: $("dropZone"), fileInput: $("fileInput"),
  recBtn: $("recBtn"), recLabel: $("recLabel"), recTimer: $("recTimer"),
  clipCard: $("clipCard"), clipName: $("clipName"), clipMeta: $("clipMeta"),
  clipPlayer: $("clipPlayer"), clipRemove: $("clipRemove"),
  language: $("language"), task: $("task"), timestamps: $("timestamps"),
  runBtn: $("runBtn"),
  progress: $("progress"), progressLabel: $("progressLabel"), progressPct: $("progressPct"),
  progressBar: $("progressBar"), progressNote: $("progressNote"),
  resultTools: $("resultTools"), viewMode: $("viewMode"), copyBtn: $("copyBtn"),
  exportFormat: $("exportFormat"), downloadBtn: $("downloadBtn"),
  statsRow: $("statsRow"), result: $("result"), footNote: $("footNote"),
};

const state = {
  clip: null,        // { blob, blobUrl, name, samples, duration, bytes }
  transcript: null,  // engine result + meta
  busy: false,
  recorder: null,
  recChunks: [],
  recStart: 0,
  recTick: null,
  browserEngine: new BrowserEngine(),
  probe: null,
};

const currentEngine = () =>
  document.querySelector('input[name="engine"]:checked')?.value || "browser";

// ── Settings ────────────────────────────────────────────────
function loadSettings() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      engine: currentEngine(),
      browserModel: el.browserModel.value,
      quality: el.quality.value,
      groqModel: el.groqModel.value,
      groqKey: el.groqKey.value,
      language: el.language.value,
      task: el.task.value,
      timestamps: el.timestamps.checked,
      viewMode: el.viewMode.value,
      exportFormat: el.exportFormat.value,
    }));
  } catch { /* private browsing — settings simply won't persist */ }
}

// ── Clip handling ───────────────────────────────────────────
async function adoptClip(blob, name) {
  setProgress(true, "Reading audio…", null);
  try {
    const decoded = await decodeToMono16k(blob);
    clearClip({ keepResult: true });

    state.clip = {
      blob,
      blobUrl: URL.createObjectURL(blob),
      name,
      samples: decoded.samples,
      duration: decoded.duration,
      bytes: blob.size,
    };

    el.clipPlayer.src = state.clip.blobUrl;
    el.clipName.textContent = name;
    el.clipMeta.textContent = [
      formatDuration(decoded.duration),
      formatBytes(blob.size),
      `${decoded.originalSampleRate / 1000} kHz`,
      decoded.originalChannels === 1 ? "mono" : `${decoded.originalChannels} ch`,
    ].join(" · ");
    el.clipCard.hidden = false;
    el.dropZone.classList.add("has-clip");
  } catch (err) {
    showError(
      `Could not read that file: ${err?.message || err}`,
      "Try MP3, WAV, M4A, FLAC, OGG, or MP4. DRM-protected files can't be decoded."
    );
  } finally {
    setProgress(false);
    updateRunButton();
  }
}

function clearClip({ keepResult = false } = {}) {
  if (state.clip?.blobUrl) URL.revokeObjectURL(state.clip.blobUrl);
  state.clip = null;
  el.clipPlayer.removeAttribute("src");
  el.clipCard.hidden = true;
  el.dropZone.classList.remove("has-clip");
  if (!keepResult) updateRunButton();
}

// ── Recording ───────────────────────────────────────────────
async function toggleRecording() {
  if (state.recorder?.state === "recording") {
    state.recorder.stop();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    showError("This browser won't provide microphone access here.",
      "Microphone capture needs HTTPS (or localhost). Upload a file instead.");
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
  } catch (err) {
    showError(`Microphone access was refused: ${err?.message || err}`,
      "Allow microphone permission for this site, or upload a file.");
    return;
  }

  state.recChunks = [];
  const recorder = new MediaRecorder(stream);
  state.recorder = recorder;

  recorder.ondataavailable = (e) => { if (e.data.size) state.recChunks.push(e.data); };
  recorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    clearInterval(state.recTick);
    el.recBtn.classList.remove("is-recording");
    el.recLabel.textContent = "Record from microphone";
    el.recTimer.textContent = "";
    state.recorder = null;
    if (state.recChunks.length) {
      const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      await adoptClip(new Blob(state.recChunks, { type: recorder.mimeType }), `Recording ${stamp}`);
    }
  };

  recorder.start();
  state.recStart = Date.now();
  el.recBtn.classList.add("is-recording");
  el.recLabel.textContent = "Stop recording";
  state.recTick = setInterval(() => {
    el.recTimer.textContent = formatDuration((Date.now() - state.recStart) / 1000);
  }, 200);
}

// ── Progress ────────────────────────────────────────────────
function setProgress(visible, label, percent, note = "") {
  el.progress.hidden = !visible;
  if (!visible) return;
  el.progressLabel.textContent = label || "Working…";
  el.progressNote.textContent = note;
  if (percent == null) {
    el.progressBar.classList.add("indeterminate");
    el.progressBar.style.width = "100%";
    el.progressPct.textContent = "";
  } else {
    el.progressBar.classList.remove("indeterminate");
    el.progressBar.style.width = `${Math.max(2, Math.min(100, percent))}%`;
    el.progressPct.textContent = `${Math.round(percent)}%`;
  }
}

function onEngineProgress(p) {
  if (p.stage === "download") {
    const size = p.total ? ` (${formatBytes(p.loaded)} of ${formatBytes(p.total)})` : "";
    setProgress(true, "Downloading model", p.percent,
      `${p.file}${size} — this happens once, then it's cached.`);
  } else if (p.stage === "compile") {
    setProgress(true, "Preparing model", null, "Compiling for your GPU.");
  } else if (p.stage === "init") {
    setProgress(true, "Starting engine", null, p.message || "");
  } else if (p.stage === "ready") {
    setProgress(true, "Model ready", null, `Running on ${String(p.device || "").toUpperCase()}.`);
  } else if (p.stage === "infer") {
    setProgress(true, "Transcribing", null, "Speed depends on your hardware and clip length.");
  } else if (p.stage === "upload") {
    setProgress(true, "Uploading", p.percent, p.message || "");
  }
}

// ── Run ─────────────────────────────────────────────────────
async function run() {
  if (state.busy || !state.clip) return;

  const engineName = currentEngine();
  if (engineName === "groq" && !el.groqKey.value.trim()) {
    openSettings();
    el.settingsNote.textContent = "Add a Groq API key, or switch to the in-browser engine.";
    el.settingsNote.className = "settings-note bad";
    return;
  }

  state.busy = true;
  updateRunButton();
  el.result.replaceChildren();
  el.resultTools.hidden = true;
  el.statsRow.hidden = true;
  setProgress(true, "Starting…", null);

  const started = Date.now();
  const engine = engineName === "groq"
    ? new GroqEngine({ apiKey: el.groqKey.value, useProxy: false })
    : state.browserEngine;

  const job = {
    samples: state.clip.samples,
    duration: state.clip.duration,
    language: el.language.value,
    task: el.task.value,
    timestamps: el.timestamps.checked,
    model: engineName === "groq" ? el.groqModel.value : el.browserModel.value,
    quality: el.quality.value,
  };

  try {
    const result = await engine.run(job, { onProgress: onEngineProgress });
    const wall = Date.now() - started;

    if (!result.text) {
      showError("The model returned no text.",
        "The clip may be silent, or too quiet. Try another file.");
      return;
    }

    state.transcript = {
      ...result,
      meta: {
        filename: state.clip.name,
        duration: formatDuration(state.clip.duration),
        engine: engineName === "groq" ? "Groq" : `In-browser (${result.device || "wasm"})`,
        model: job.model,
        language: result.language || (job.language === "auto" ? "auto-detected" : job.language),
      },
      wallMs: wall,
      audioSec: state.clip.duration,
    };

    renderResult();
  } catch (err) {
    showError(err?.message || String(err), hintFor(err, engineName));
  } finally {
    setProgress(false);
    state.busy = false;
    updateRunButton();
  }
}

function hintFor(err, engineName) {
  const m = String(err?.message || "").toLowerCase();
  if (engineName === "browser") {
    if (m.includes("out of memory") || m.includes("oom")) {
      return "The model was too large for this device. Pick a smaller model in Settings.";
    }
    if (m.includes("fetch") || m.includes("network") || m.includes("import")) {
      return "The model files could not be downloaded. Check your connection and retry — partial downloads resume from cache.";
    }
    return "Try a smaller model in Settings, or switch to the Groq engine.";
  }
  if (m.includes("key")) return "Get a free key at console.groq.com/keys.";
  if (m.includes("rate limit")) return "Groq's free tier has hourly limits. Wait a moment, or use the in-browser engine.";
  return "You can switch to the in-browser engine, which has no quota.";
}

// ── Rendering ───────────────────────────────────────────────
function renderResult() {
  const t = state.transcript;
  if (!t) return;

  el.resultTools.hidden = false;
  renderStats(t);

  const mode = el.viewMode.value;
  el.result.replaceChildren();

  if (mode === "segments" && t.segments?.length) {
    const list = document.createElement("div");
    list.className = "segments";
    for (const seg of t.segments) {
      const row = document.createElement("div");
      row.className = "segment";

      const time = document.createElement("button");
      time.className = "seg-time";
      time.type = "button";
      time.textContent = formatDuration(seg.start);
      time.title = "Play from here";
      time.addEventListener("click", () => {
        el.clipPlayer.currentTime = seg.start;
        el.clipPlayer.play().catch(() => {});
      });

      const text = document.createElement("p");
      text.className = "seg-text";
      text.textContent = seg.text;

      row.append(time, text);
      list.append(row);
    }
    el.result.append(list);
    return;
  }

  const body = document.createElement("div");
  body.className = "transcript";
  const source = mode === "plain" ? FORMATS.txt.render(t) : FORMATS.paragraphs.render(t);
  for (const para of source.split("\n\n")) {
    const p = document.createElement("p");
    p.textContent = para;
    body.append(p);
  }
  el.result.append(body);
}

function renderStats(t) {
  const words = t.text.trim().split(/\s+/).filter(Boolean).length;
  const speed = t.audioSec && t.wallMs ? (t.audioSec / (t.wallMs / 1000)) : null;

  const stats = [
    [words.toLocaleString(), words === 1 ? "word" : "words"],
    [formatDuration(t.audioSec), "audio"],
    [`${(t.wallMs / 1000).toFixed(1)}s`, "elapsed"],
    speed ? [`${speed.toFixed(1)}×`, "realtime"] : null,
    t.meta.language ? [t.meta.language, "language"] : null,
  ].filter(Boolean);

  el.statsRow.replaceChildren();
  for (const [value, label] of stats) {
    const cell = document.createElement("div");
    cell.className = "stat";
    const v = document.createElement("span");
    v.className = "stat-value";
    v.textContent = value;
    const l = document.createElement("span");
    l.className = "stat-label";
    l.textContent = label;
    cell.append(v, l);
    el.statsRow.append(cell);
  }
  el.statsRow.hidden = false;
  el.footNote.textContent = `${t.meta.engine} · ${t.meta.model}`;
}

function showError(message, hint) {
  el.result.replaceChildren();
  const box = document.createElement("div");
  box.className = "error-box";
  const title = document.createElement("p");
  title.className = "error-title";
  title.textContent = message;
  box.append(title);
  if (hint) {
    const h = document.createElement("p");
    h.className = "error-hint";
    h.textContent = hint;
    box.append(h);
  }
  el.result.append(box);
}

// ── Export ──────────────────────────────────────────────────
function currentExport() {
  const fmt = FORMATS[el.exportFormat.value] || FORMATS.txt;
  const t = state.transcript;
  const text = fmt.render(t, t.meta);
  const base = (t.meta.filename || "transcript").replace(/\.[^.]+$/, "");
  return { fmt, text, filename: `${base}.${fmt.ext}` };
}

async function copyTranscript() {
  if (!state.transcript) return;
  const { text } = currentExport();
  try {
    await navigator.clipboard.writeText(text);
    flash(el.copyBtn, "Copied");
  } catch {
    // Clipboard API needs a secure context and permission; fall back to select.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.select();
    try { document.execCommand("copy"); flash(el.copyBtn, "Copied"); }
    catch { flash(el.copyBtn, "Press ⌘/Ctrl+C"); }
    ta.remove();
  }
}

function downloadTranscript() {
  if (!state.transcript) return;
  const { fmt, text, filename } = currentExport();
  const url = URL.createObjectURL(new Blob([text], { type: `${fmt.mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  flash(el.downloadBtn, "Saved");
}

function flash(button, text) {
  const original = button.textContent;
  button.textContent = text;
  button.disabled = true;
  setTimeout(() => { button.textContent = original; button.disabled = false; }, 1400);
}

// ── UI plumbing ─────────────────────────────────────────────
function updateRunButton() {
  el.runBtn.disabled = state.busy || !state.clip;
  el.runBtn.textContent = state.busy
    ? "Working…"
    : el.task.value === "translate" ? "Translate" : "Transcribe";
}

function syncEngineUi() {
  const engine = currentEngine();
  document.querySelectorAll(".engine-opts").forEach((node) => {
    node.hidden = node.dataset.engine !== engine;
  });

  if (engine === "groq") {
    el.engineText.textContent = "Groq";
    el.enginePill.className = `pill ${el.groqKey.value.trim() ? "pill-ok" : "pill-warn"}`;
  } else {
    const device = state.probe?.device === "webgpu" ? "WebGPU" : "WASM";
    el.engineText.textContent = `In-browser · ${device}`;
    el.enginePill.className = "pill pill-ok";
  }

  // Translation is a Whisper feature; turbo variants don't support it.
  const turbo = engine === "groq" && el.groqModel.value.includes("turbo");
  const translateOpt = el.task.querySelector('option[value="translate"]');
  translateOpt.disabled = turbo;
  if (turbo && el.task.value === "translate") el.task.value = "transcribe";
  translateOpt.textContent = turbo
    ? "Translate to English — needs Large v3"
    : "Translate to English";

  updateRunButton();
}

function openSettings() {
  el.settings.hidden = false;
  el.settingsBtn.setAttribute("aria-expanded", "true");
}

function populateSelects() {
  for (const m of BROWSER_MODELS) {
    el.browserModel.append(new Option(`${m.label} — ${m.downloadMb} MB`, m.id));
  }
  for (const m of GROQ_MODELS) {
    el.groqModel.append(new Option(m.label, m.id));
  }
  for (const [code, name] of LANGUAGES) {
    el.language.append(new Option(name, code));
  }
  for (const [key, f] of Object.entries(FORMATS)) {
    el.exportFormat.append(new Option(f.label, key));
  }
  el.browserModel.value = "onnx-community/whisper-base";
  el.groqModel.value = "whisper-large-v3-turbo";
  el.exportFormat.value = "txt";
}

function syncModelNotes() {
  const b = BROWSER_MODELS.find((m) => m.id === el.browserModel.value);
  el.browserModelNote.textContent = b ? `${b.note} Downloads once (${b.downloadMb} MB), then cached.` : "";
  const g = GROQ_MODELS.find((m) => m.id === el.groqModel.value);
  el.groqModelNote.textContent = g ? g.note : "";
}

function wireDropZone() {
  const open = () => el.fileInput.click();
  el.dropZone.addEventListener("click", open);
  el.dropZone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
  });

  el.fileInput.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) adoptClip(file, file.name);
    e.target.value = "";
  });

  for (const type of ["dragenter", "dragover"]) {
    el.dropZone.addEventListener(type, (e) => {
      e.preventDefault();
      el.dropZone.classList.add("is-over");
    });
  }
  for (const type of ["dragleave", "drop"]) {
    el.dropZone.addEventListener(type, (e) => {
      e.preventDefault();
      el.dropZone.classList.remove("is-over");
    });
  }
  el.dropZone.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) adoptClip(file, file.name);
  });

  // Dropping anywhere else shouldn't make the browser navigate to the file.
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());
}

async function init() {
  populateSelects();

  const saved = loadSettings();
  if (saved.engine) {
    const radio = document.querySelector(`input[name="engine"][value="${saved.engine}"]`);
    if (radio) radio.checked = true;
  }
  for (const [key, node] of Object.entries({
    browserModel: el.browserModel, quality: el.quality, groqModel: el.groqModel,
    groqKey: el.groqKey, language: el.language, task: el.task,
    viewMode: el.viewMode, exportFormat: el.exportFormat,
  })) {
    if (saved[key] != null && [...node.options ?? []].some((o) => o.value === saved[key])) {
      node.value = saved[key];
    } else if (saved[key] != null && node.type === "password") {
      node.value = saved[key];
    }
  }
  if (typeof saved.timestamps === "boolean") el.timestamps.checked = saved.timestamps;

  syncModelNotes();

  el.settingsBtn.addEventListener("click", () => {
    const open = el.settings.hidden;
    el.settings.hidden = !open;
    el.settingsBtn.setAttribute("aria-expanded", String(open));
  });
  el.closeSettings.addEventListener("click", () => {
    el.settings.hidden = true;
    el.settingsBtn.setAttribute("aria-expanded", "false");
  });
  el.forgetBtn.addEventListener("click", () => {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    el.groqKey.value = "";
    el.settingsNote.textContent = "Settings cleared.";
    el.settingsNote.className = "settings-note";
    syncEngineUi();
  });

  document.querySelectorAll('input[name="engine"]').forEach((r) =>
    r.addEventListener("change", () => { syncEngineUi(); saveSettings(); }));

  for (const node of [el.browserModel, el.groqModel]) {
    node.addEventListener("change", () => { syncModelNotes(); syncEngineUi(); saveSettings(); });
  }
  for (const node of [el.quality, el.language, el.task, el.timestamps]) {
    node.addEventListener("change", () => { updateRunButton(); saveSettings(); });
  }
  el.groqKey.addEventListener("input", () => { syncEngineUi(); saveSettings(); });

  el.viewMode.addEventListener("change", () => { renderResult(); saveSettings(); });
  el.exportFormat.addEventListener("change", saveSettings);
  el.copyBtn.addEventListener("click", copyTranscript);
  el.downloadBtn.addEventListener("click", downloadTranscript);

  wireDropZone();
  el.recBtn.addEventListener("click", toggleRecording);
  el.clipRemove.addEventListener("click", () => clearClip());
  el.runBtn.addEventListener("click", run);

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !el.runBtn.disabled) run();
  });

  state.probe = await BrowserEngine.probe();
  el.deviceNote.textContent = state.probe.device === "webgpu"
    ? "WebGPU detected — the model will run on your GPU."
    : `${state.probe.reason} Expect slower transcription; smaller models help.`;
  syncEngineUi();
}

init();
