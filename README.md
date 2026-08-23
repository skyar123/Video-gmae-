# Whisper Studio

Free speech-to-text on Netlify. Transcribe audio with OpenAI's Whisper — either
entirely inside your browser on your own GPU, or through Groq's free tier.

**No paid API required.** No account required for the in-browser engine.

---

## Why there are two engines

Whisper is a model, not a service, so something has to run it. Netlify serves
static files and short-lived functions — it has no GPU and a 26-second function
ceiling, so the model cannot run *on* Netlify. Both engines here work around
that in different ways.

| | **In your browser** | **Groq** |
| --- | --- | --- |
| Cost | Free, always | Free tier |
| API key | None | Free key required |
| Privacy | Audio never leaves your device | Audio uploaded to Groq |
| Speed | Depends on your GPU | ~100× realtime |
| First use | Downloads the model once | Instant |
| Offline | Yes, once cached | No |
| Best model | `whisper-large-v3-turbo` | `whisper-large-v3-turbo` |

The in-browser engine uses [transformers.js](https://github.com/huggingface/transformers.js)
with WebGPU, falling back to WASM. The model is fetched from the Hugging Face
CDN on first run and cached by the browser thereafter.

### About the OpenAI API

OpenAI's hosted Whisper endpoint costs $0.006/minute — it is not free, and this
project does not use it. **Groq is the free equivalent**: same `whisper-large-v3`
family, an OpenAI-compatible API, and a free tier that covers ordinary personal
use. Get a key at [console.groq.com/keys](https://console.groq.com/keys).

---

## Deploy

```bash
npm install -g netlify-cli
netlify login
netlify init
netlify deploy --build --prod
```

No build step and no dependencies — `public/` is vanilla HTML, CSS, and ES
modules. It runs on Netlify's free tier.

### Optional environment variables

| Variable | Effect |
| --- | --- |
| `GROQ_API_KEY` | Lets visitors use Groq without their own key, via `/api/transcribe`. |

Leave it unset for personal use: the console talks to Groq directly from the
browser with a key the visitor supplies, which avoids Netlify's function limits
entirely. Set it only when you're hosting for other people and want to supply
the quota yourself — note that the proxy path inherits Netlify's 26-second and
~5 MB caps, so it suits short clips only.

---

## Using it

Drop in a file (MP3, WAV, M4A, FLAC, OGG, MP4) or record from the microphone,
then press **Transcribe**. Everything is decoded to 16 kHz mono in the browser
first, which is the format Whisper expects.

- **Language** — auto-detect, or pin it when you already know.
- **Translate to English** — available on `whisper-large-v3`; the turbo variants
  are transcription-only.
- **Timestamps** — on by default, and required for subtitle export.
- **Views** — paragraphs (split on speech pauses), timestamped segments
  (click a timestamp to play from that point), or plain text.
- **Export** — plain text, paragraphs, SRT, WebVTT, Markdown, or JSON.

Ctrl/Cmd+Enter runs the current input. Settings persist in `localStorage`.

### Picking an in-browser model

| Model | Download | Notes |
| --- | --- | --- |
| Tiny | 92 MB | Fastest. Fine for clear speech. |
| Base | 136 MB | Good default on modest hardware. |
| Small | 285 MB | Noticeably better on accents and noise. |
| Large v3 Turbo | 724 MB | Best accuracy. Wants a real GPU. |

Sizes are the q4-quantised weights, downloaded once and then cached. On a
machine without WebGPU the WASM fallback still works but is much slower — the
Settings panel tells you which backend you got.

Long audio is handled automatically: the in-browser engine uses Whisper's own
30-second windowing, and the Groq engine splits anything over ten minutes and
stitches the timestamps back together.

---

## Layout

```
public/
  index.html
  styles.css
  app.js            UI controller
  worker.js         In-browser Whisper (Web Worker, so the UI stays responsive)
  lib/
    audio.mjs       Decode / resample / WAV encode / windowing
    engines.mjs     BrowserEngine + GroqEngine behind one interface
    export.mjs      TXT, SRT, VTT, Markdown, JSON serialisers
netlify/functions/
  status.mjs        Reports how this deployment is configured
  transcribe.mjs    Optional Groq proxy for shared deployments
netlify.toml
server/             Optional: Kimi-Audio GPU backend (see below)
```

Inference runs in a Web Worker. On the main thread it would freeze the page for
the duration of the transcription.

---

## Also in this repo: Kimi-Audio

`server/` holds a FastAPI wrapper around
[Kimi-Audio](https://github.com/MoonshotAI/Kimi-Audio), MoonshotAI's 7B
audio-language model. It does things Whisper cannot — spoken question answering
and voice-to-voice conversation — but needs a CUDA GPU with ~24 GB VRAM, so it
cannot run on Netlify and is not wired into the console.

```bash
cd server && docker compose up --build
python server/test_app.py    # contract tests, model stubbed — no GPU needed
```

See the comments in `server/app.py` for the API and environment variables.

---

## Tests

```bash
netlify dev                  # http://localhost:8888
python server/test_app.py    # Kimi-Audio server contract tests
```

---

## Licence

MIT for the code here. Whisper is MIT-licensed by OpenAI; the ONNX weights are
published by [onnx-community](https://huggingface.co/onnx-community).
Kimi-Audio is licensed separately by MoonshotAI.
