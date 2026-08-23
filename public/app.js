/**
 * Kimi-Audio Console
 *
 * Talks to a Kimi-Audio server (see ./server in this repo) either directly
 * from the browser or through this site's Netlify function proxy.
 *
 * Kimi-Audio wants 16 kHz mono PCM. Browsers hand us Opus/WebM from
 * MediaRecorder and arbitrary containers from <input type=file>, so every
 * clip is decoded with WebAudio and re-encoded to WAV before it is sent.
 */

const TARGET_SAMPLE_RATE = 16_000;
const STORAGE_KEY = "kimi-audio-console/settings";

const KIMI_DEFAULT_PARAMS = Object.freeze({
  audio_temperature: 0.8,
  audio_top_k: 10,
  text_temperature: 0.0,
  text_top_k: 5,
  audio_repetition_penalty: 1.0,
  audio_repetition_window_size: 64,
  text_repetition_penalty: 1.0,
  text_repetition_window_size: 16,
});

const TASKS = {
  asr: {
    blurb: "Convert speech in the audio to text.",
    defaultPrompt: "Please transcribe the spoken content into text.",
    outputType: "text",
    promptRequired: false,
    keepsHistory: false,
  },
  qa: {
    blurb: "Ask a question about the audio and get a text answer.",
    defaultPrompt: "",
    outputType: "text",
    promptRequired: false,
    keepsHistory: false,
  },
  chat: {
    blurb: "Speak to Kimi and get spoken audio plus text back. Turns carry over as context.",
    defaultPrompt: "",
    outputType: "both",
    promptRequired: false,
    keepsHistory: true,
  },
};

// ── DOM ─────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const el = {
  statusPill: $("statusPill"), statusText: $("statusText"),
  connBtn: $("connBtn"), connPanel: $("connPanel"),
  backendUrl: $("backendUrl"), apiKey: $("apiKey"),
  testBtn: $("testBtn"), forgetBtn: $("forgetBtn"), connResult: $("connResult"),
  taskBlurb: $("taskBlurb"), promptBox: $("promptBox"), promptOpt: $("promptOpt"),
  recBtn: $("recBtn"), recLabel: $("recLabel"), recTimer: $("recTimer"),
  fileInput: $("fileInput"),
  clipBox: $("clipBox"), clipPlayer: $("clipPlayer"), clipInfo: $("clipInfo"),
  clearClip: $("clearClip"), audioEmpty: $("audioEmpty"),
  runBtn: $("runBtn"), runTimer: $("runTimer"),
  turns: $("turns"), clearConv: $("clearConv"),
  resetParams: $("resetParams"),
};

const paramInputs = {
  audio_temperature: $("p_audio_temp"),
  audio_top_k: $("p_audio_topk"),
  text_temperature: $("p_text_temp"),
  text_top_k: $("p_text_topk"),
  audio_repetition_penalty: $("p_audio_rep"),
  text_repetition_penalty: $("p_text_rep"),
};

// ── State ───────────────────────────────────────────────────
const state = {
  task: "asr",
  clip: null,          // { wavBase64, blobUrl, seconds, bytes, sourceLabel }
  history: [],         // Kimi-format messages retained for voice chat
  busy: false,
  recorder: null,
  recChunks: [],
  recStarted: 0,
  recInterval: null,
  serverConfig: null,  // /api/status payload
};

// ── Settings persistence ────────────────────────────────────
function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveSettings() {
  const data = {
    backendUrl: el.backendUrl.value.trim(),
    apiKey: el.apiKey.value,
    mode: currentMode(),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* private mode — settings just won't persist */
  }
}

const currentMode = () =>
  document.querySelector('input[name="mode"]:checked')?.value || "direct";

// ── WAV encoding ────────────────────────────────────────────

/** Decode any browser-readable audio blob, downmix to mono, resample, encode WAV. */
async function blobToWav(blob, sampleRate = TARGET_SAMPLE_RATE) {
  const bytes = await blob.arrayBuffer();

  const DecodeCtx = window.AudioContext || window.webkitAudioContext;
  const decodeCtx = new DecodeCtx();
  let decoded;
  try {
    decoded = await decodeCtx.decodeAudioData(bytes.slice(0));
  } finally {
    decodeCtx.close();
  }

  // Resample + downmix to mono in one offline pass.
  const frames = Math.max(1, Math.ceil(decoded.duration * sampleRate));
  const offline = new OfflineAudioContext(1, frames, sampleRate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();

  return {
    wav: encodeWav(rendered.getChannelData(0), sampleRate),
    seconds: decoded.duration,
  };
}

/** Float32 [-1,1] -> 16-bit PCM WAV blob. */
function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeAscii = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);          // PCM header size
  view.setUint16(20, 1, true);           // format = PCM
  view.setUint16(22, 1, true);           // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);           // block align
  view.setUint16(34, 16, true);          // bits per sample
  writeAscii(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  // Chunked to avoid blowing the argument limit on long clips.
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBlobUrl(b64, mime = "audio/wav") {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

// ── Clip handling ───────────────────────────────────────────
async function adoptClip(blob, sourceLabel) {
  setStatus("busy", "Encoding audio…");
  try {
    const { wav, seconds } = await blobToWav(blob);
    if (state.clip?.blobUrl) URL.revokeObjectURL(state.clip.blobUrl);

    state.clip = {
      wavBase64: await blobToBase64(wav),
      blobUrl: URL.createObjectURL(wav),
      seconds,
      bytes: wav.size,
      sourceLabel,
    };

    el.clipPlayer.src = state.clip.blobUrl;
    el.clipInfo.textContent =
      `${sourceLabel} · ${formatDuration(seconds)} · ${(wav.size / 1024).toFixed(0)} KB · ${TARGET_SAMPLE_RATE / 1000} kHz mono`;
    el.clipBox.hidden = false;
    el.audioEmpty.hidden = true;
    refreshStatus();
  } catch (err) {
    setStatus("bad", "Could not decode audio");
    addTurn({
      role: "Error",
      body: `Could not decode that audio: ${err?.message || err}`,
      hint: "Try a WAV, MP3, M4A, or FLAC file.",
      isError: true,
    });
  } finally {
    updateRunButton();
  }
}

function clearClip() {
  if (state.clip?.blobUrl) URL.revokeObjectURL(state.clip.blobUrl);
  state.clip = null;
  el.clipPlayer.removeAttribute("src");
  el.clipBox.hidden = true;
  el.audioEmpty.hidden = false;
  updateRunButton();
}

const formatDuration = (s) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// ── Recording ───────────────────────────────────────────────
async function toggleRecording() {
  if (state.recorder?.state === "recording") {
    state.recorder.stop();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("bad", "Microphone unavailable");
    addTurn({
      role: "Error",
      body: "This browser will not expose a microphone here.",
      hint: "Microphone capture needs HTTPS (or localhost). Upload a file instead.",
      isError: true,
    });
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
  } catch (err) {
    setStatus("bad", "Microphone blocked");
    addTurn({
      role: "Error",
      body: `Microphone access was refused: ${err?.message || err}`,
      hint: "Allow microphone permission for this site, or upload a file.",
      isError: true,
    });
    return;
  }

  state.recChunks = [];
  const recorder = new MediaRecorder(stream);
  state.recorder = recorder;

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) state.recChunks.push(e.data);
  };

  recorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    clearInterval(state.recInterval);
    el.recBtn.classList.remove("is-recording");
    el.recLabel.textContent = "Record";
    state.recorder = null;

    if (state.recChunks.length) {
      await adoptClip(new Blob(state.recChunks, { type: recorder.mimeType }), "Recording");
    }
  };

  recorder.start();
  state.recStarted = Date.now();
  el.recBtn.classList.add("is-recording");
  el.recLabel.textContent = "Stop";
  el.recTimer.textContent = "0:00";
  state.recInterval = setInterval(() => {
    el.recTimer.textContent = formatDuration((Date.now() - state.recStarted) / 1000);
  }, 200);
}

// ── Backend calls ───────────────────────────────────────────
function readParams() {
  const params = { ...KIMI_DEFAULT_PARAMS };
  for (const [key, input] of Object.entries(paramInputs)) {
    const value = Number(input.value);
    if (Number.isFinite(value)) params[key] = value;
  }
  return params;
}

function buildRequest() {
  const task = TASKS[state.task];
  const prompt = el.promptBox.value.trim() || task.defaultPrompt;

  const turn = [];
  if (prompt) {
    turn.push({ role: "user", message_type: "text", content: prompt });
  }
  turn.push({
    role: "user",
    message_type: "audio",
    content: { format: "wav", sample_rate: TARGET_SAMPLE_RATE, data_base64: state.clip.wavBase64 },
  });

  return {
    messages: task.keepsHistory ? [...state.history, ...turn] : turn,
    output_type: task.outputType,
    sampling_params: readParams(),
    _turn: turn,
  };
}

async function callBackend(payload) {
  const mode = currentMode();
  const backend = el.backendUrl.value.trim();
  const key = el.apiKey.value.trim();

  const body = JSON.stringify({
    messages: payload.messages,
    output_type: payload.output_type,
    sampling_params: payload.sampling_params,
    ...(mode === "proxy" && backend ? { backend } : {}),
  });

  const url = mode === "proxy" ? "/api/generate" : `${backend.replace(/\/+$/, "")}/v1/generate`;

  const headers = { "content-type": "application/json" };
  // In proxy mode the key lives in Netlify env vars, not the browser.
  if (mode === "direct" && key) headers.authorization = `Bearer ${key}`;

  const res = await fetch(url, { method: "POST", headers, body });
  const text = await res.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Backend returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const detail = data.message || data.error || `HTTP ${res.status}`;
    const err = new Error(detail);
    err.hint = data.hint;
    throw err;
  }
  return data;
}

async function run() {
  if (state.busy || !state.clip) return;

  const backend = el.backendUrl.value.trim();
  if (currentMode() === "direct" && !backend) {
    openConnPanel();
    setConnResult("bad", "Enter a backend URL first.");
    return;
  }

  state.busy = true;
  updateRunButton();
  setStatus("busy", "Generating…");

  const payload = buildRequest();

  // Echo the user's turn, then a live placeholder for the answer.
  addTurn({
    role: "You",
    body: el.promptBox.value.trim() || TASKS[state.task].defaultPrompt || "(audio only)",
    audioUrl: state.clip.blobUrl,
    isUser: true,
  });
  const pending = addTurn({ role: "Kimi", body: "", pending: true });

  const started = Date.now();
  const tick = setInterval(() => {
    el.runTimer.textContent = `${((Date.now() - started) / 1000).toFixed(1)}s`;
  }, 100);

  try {
    const result = await callBackend(payload);
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);

    const answerText = result.text ?? "(no text returned)";
    const audioUrl = result.audio?.data_base64
      ? base64ToBlobUrl(result.audio.data_base64)
      : null;

    fillTurn(pending, {
      role: "Kimi",
      body: answerText,
      audioUrl,
      time: `${elapsed}s`,
      downloadName: audioUrl ? `kimi-reply-${Date.now()}.wav` : null,
    });

    if (TASKS[state.task].keepsHistory) {
      state.history.push(...payload._turn);
      state.history.push({
        role: "assistant",
        message_type: result.audio ? "audio-text" : "text",
        content: result.audio
          ? [{ format: "wav", data_base64: result.audio.data_base64 }, answerText]
          : answerText,
      });
      el.clearConv.hidden = false;
    }

    setStatus("ok", "Ready");
  } catch (err) {
    fillTurn(pending, {
      role: "Error",
      body: err?.message || String(err),
      hint: err?.hint,
      isError: true,
    });
    setStatus("bad", "Request failed");
  } finally {
    clearInterval(tick);
    el.runTimer.textContent = "";
    state.busy = false;
    updateRunButton();
  }
}

// ── Turn rendering ──────────────────────────────────────────
function addTurn(spec) {
  el.turns.querySelector(".placeholder")?.remove();
  const node = document.createElement("article");
  node.className = "turn";
  el.turns.append(node);
  fillTurn(node, spec);
  node.scrollIntoView({ block: "nearest", behavior: "smooth" });
  return node;
}

function fillTurn(node, { role, body, hint, audioUrl, time, isUser, isError, pending, downloadName }) {
  node.className = `turn${isUser ? " is-user" : ""}${isError ? " is-error" : ""}`;
  node.replaceChildren();

  const head = document.createElement("div");
  head.className = "turn-head";

  const roleEl = document.createElement("span");
  roleEl.className = "turn-role";
  roleEl.textContent = role;
  head.append(roleEl);

  if (pending) head.append(Object.assign(document.createElement("span"), { className: "spinner" }));
  if (time) {
    const t = document.createElement("span");
    t.className = "turn-time";
    t.textContent = time;
    head.append(t);
  }
  node.append(head);

  if (body) {
    const p = document.createElement("p");
    p.className = "turn-body";
    p.textContent = body;
    node.append(p);
  } else if (pending) {
    const p = document.createElement("p");
    p.className = "turn-hint";
    p.textContent = "Waiting on the model…";
    node.append(p);
  }

  if (hint) {
    const h = document.createElement("p");
    h.className = "turn-hint";
    h.textContent = hint;
    node.append(h);
  }

  if (audioUrl) {
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.preload = "metadata";
    audio.src = audioUrl;
    node.append(audio);

    if (downloadName) {
      const actions = document.createElement("div");
      actions.className = "turn-actions";
      const link = document.createElement("a");
      link.className = "link-btn";
      link.href = audioUrl;
      link.download = downloadName;
      link.textContent = "Download WAV";
      actions.append(link);
      node.append(actions);
    }
  }
}

// ── Status ──────────────────────────────────────────────────
function setStatus(kind, text) {
  el.statusPill.className = `pill pill-${kind}`;
  el.statusText.textContent = text;
}

function refreshStatus() {
  if (state.busy) return;
  const hasBackend = Boolean(el.backendUrl.value.trim()) || currentMode() === "proxy";
  if (!hasBackend) setStatus("idle", "Not connected");
  else setStatus("idle", "Backend set — untested");
}

function setConnResult(kind, text) {
  el.connResult.className = `conn-result ${kind}`;
  el.connResult.textContent = text;
}

async function testConnection() {
  const backend = el.backendUrl.value.trim();
  const mode = currentMode();

  if (mode === "direct" && !backend) {
    setConnResult("bad", "Enter a backend URL.");
    return;
  }

  el.testBtn.disabled = true;
  setConnResult("", "Checking…");
  setStatus("busy", "Checking backend…");

  try {
    let data;
    if (mode === "proxy") {
      const qs = backend ? `?backend=${encodeURIComponent(backend)}` : "";
      const res = await fetch(`/api/health${qs}`);
      data = await res.json();
      if (!res.ok) throw Object.assign(new Error(data.message || "Health check failed"), { hint: data.hint });
    } else {
      const key = el.apiKey.value.trim();
      const res = await fetch(`${backend.replace(/\/+$/, "")}/health`, {
        headers: key ? { authorization: `Bearer ${key}` } : {},
      });
      if (!res.ok) throw new Error(`Backend returned HTTP ${res.status}`);
      data = await res.json();
    }

    const bits = [
      data.model || "Kimi-Audio",
      data.device ? `on ${data.device}` : null,
      data.detokenizer_loaded === false ? "text-only (no audio out)" : null,
      data.latencyMs != null ? `${data.latencyMs}ms` : null,
    ].filter(Boolean);

    setConnResult("ok", `✓ ${bits.join(" · ")}`);
    setStatus("ok", "Connected");
  } catch (err) {
    setConnResult("bad", `✗ ${err?.message || err}`);
    setStatus("bad", "Not reachable");
    if (err?.hint) setConnResult("bad", `✗ ${err.message} — ${err.hint}`);
  } finally {
    el.testBtn.disabled = false;
  }
}

function updateRunButton() {
  el.runBtn.disabled = state.busy || !state.clip;
  el.runBtn.textContent = state.busy ? "Running…" : "Run";
}

function openConnPanel() {
  el.connPanel.hidden = false;
  el.connBtn.setAttribute("aria-expanded", "true");
}

// ── Wire up ─────────────────────────────────────────────────
function selectTask(task) {
  state.task = task;
  document.querySelectorAll(".tab").forEach((tab) => {
    const active = tab.dataset.task === task;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  el.taskBlurb.textContent = TASKS[task].blurb;
  el.promptBox.placeholder =
    task === "asr" ? "Leave blank to use the default transcription instruction."
    : task === "qa" ? "e.g. Summarise what the speaker is asking for."
    : "Leave blank to just talk — Kimi answers the audio directly.";
  el.clearConv.hidden = !(TASKS[task].keepsHistory && state.history.length);
}

function init() {
  const saved = loadSettings();
  if (saved.backendUrl) el.backendUrl.value = saved.backendUrl;
  if (saved.apiKey) el.apiKey.value = saved.apiKey;
  if (saved.mode) {
    const radio = document.querySelector(`input[name="mode"][value="${saved.mode}"]`);
    if (radio) radio.checked = true;
  }

  el.connBtn.addEventListener("click", () => {
    const open = el.connPanel.hidden;
    el.connPanel.hidden = !open;
    el.connBtn.setAttribute("aria-expanded", String(open));
  });

  el.testBtn.addEventListener("click", testConnection);

  el.forgetBtn.addEventListener("click", () => {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    el.backendUrl.value = "";
    el.apiKey.value = "";
    setConnResult("", "Settings cleared.");
    refreshStatus();
  });

  [el.backendUrl, el.apiKey].forEach((input) => {
    input.addEventListener("change", () => { saveSettings(); refreshStatus(); });
  });
  document.querySelectorAll('input[name="mode"]').forEach((radio) => {
    radio.addEventListener("change", () => { saveSettings(); refreshStatus(); });
  });

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => selectTask(tab.dataset.task));
  });

  el.recBtn.addEventListener("click", toggleRecording);
  el.clearClip.addEventListener("click", clearClip);
  el.fileInput.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) adoptClip(file, file.name);
    e.target.value = "";
  });

  el.runBtn.addEventListener("click", run);

  el.clearConv.addEventListener("click", () => {
    state.history = [];
    el.turns.replaceChildren();
    el.clearConv.hidden = true;
    el.turns.insertAdjacentHTML("beforeend",
      '<div class="placeholder"><p class="placeholder-title">Cleared</p><p>Context reset. The next voice-chat turn starts fresh.</p></div>');
  });

  el.resetParams.addEventListener("click", () => {
    for (const [key, input] of Object.entries(paramInputs)) {
      input.value = KIMI_DEFAULT_PARAMS[key];
    }
  });

  // Ctrl/Cmd+Enter runs.
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !el.runBtn.disabled) run();
  });

  selectTask("asr");
  bootstrapFromServer();
}

/** If the deployment ships a KIMI_BACKEND_URL, adopt it so the site works out of the box. */
async function bootstrapFromServer() {
  try {
    const res = await fetch("/api/status");
    if (!res.ok) return refreshStatus();
    const cfg = await res.json();
    state.serverConfig = cfg;

    if (cfg.backendConfigured) {
      if (!el.backendUrl.value.trim() && cfg.backendUrl) {
        el.backendUrl.value = cfg.backendUrl;
      }
      // A server-held key means proxy mode is the sane default.
      if (cfg.apiKeyConfigured && !loadSettings().mode) {
        document.querySelector('input[name="mode"][value="proxy"]').checked = true;
      }
      testConnection();
      return;
    }

    if (!el.backendUrl.value.trim()) {
      openConnPanel();
      setConnResult("", "No backend configured yet — point this at your Kimi-Audio server.");
    }
  } catch {
    /* status endpoint absent (e.g. plain static preview) — fall through */
  }
  refreshStatus();
}

init();
