# Kimi-Audio on Netlify

A web console for [Kimi-Audio](https://github.com/MoonshotAI/Kimi-Audio) (MoonshotAI's
7B audio-language model) that deploys to Netlify, plus the GPU server it drives.

Record or upload a clip, and transcribe it, ask questions about it, or hold a spoken
back-and-forth where Kimi answers in both text and synthesised speech.

---

## Read this first: the model does not run on Netlify

Kimi-Audio-7B-Instruct needs an NVIDIA GPU. Upstream's own Dockerfile starts from
`nvidia/cuda:12.8.1-cudnn-devel`, and the install pulls `torch`, `flash-attn`, and
`deepspeed` before downloading roughly 15 GB of weights.

Netlify serves static assets and short-lived Lambda functions — no GPU, a 50 MB bundle
ceiling, and a 26-second execution cap. There is no configuration that makes a 7B
audio model run there.

So this repo splits the job in two:

| Piece | Where it runs | What it does |
| --- | --- | --- |
| `public/` + `netlify/` | **Netlify** | The console UI and a thin API proxy. |
| `server/` | **Your GPU box** | FastAPI wrapper around `kimia_infer` that holds the model. |

The Netlify site is the part you share and bookmark. Point it at a backend and it works.

```
┌─────────────┐   Direct: audio + prompt    ┌──────────────────┐
│   Browser   │ ──────────────────────────► │  server/app.py   │
│  (Netlify-  │ ◄────────────────────────── │  Kimi-Audio 7B   │
│   hosted)   │      text + WAV reply       │  on your GPU     │
└──────┬──────┘                             └────────▲─────────┘
       │                                             │
       │  Proxy: keeps KIMI_API_KEY server-side      │
       └────────► Netlify Function /api/generate ────┘
                  (26s + 5MB cap applies)
```

---

## Deploy the console

```bash
npm install -g netlify-cli
netlify login
netlify init          # link or create a site
netlify deploy --build --prod
```

There is no bundler — `public/` is vanilla HTML, CSS, and ES modules, and the three
functions in `netlify/functions/` are bundled by esbuild at deploy time.

### Optional environment variables

Set these under **Site configuration → Environment variables** so visitors don't have
to type a URL:

| Variable | Effect |
| --- | --- |
| `KIMI_BACKEND_URL` | Console auto-connects to this backend on load. |
| `KIMI_API_KEY` | Sent as `Authorization: Bearer …` by the proxy. Never exposed to the browser. |

Without them, the console opens its Connection panel and asks for a backend URL, which
it remembers in `localStorage`.

---

## Run the model

You need a CUDA GPU with roughly **24 GB VRAM** for text and audio output. Setting
`KIMI_LOAD_DETOKENIZER=0` drops the speech synthesiser and fits in less, but then only
`output_type="text"` works.

### Docker (recommended)

```bash
cd server
docker compose up --build
```

Or plain Docker:

```bash
docker build -t kimi-audio-server ./server
docker run --gpus all -p 8000:8000 \
  -v $HOME/.cache/huggingface:/root/.cache/huggingface \
  -e KIMI_ALLOWED_ORIGINS="https://your-site.netlify.app" \
  kimi-audio-server
```

Mount the Hugging Face cache — otherwise every container rebuild re-downloads ~15 GB.
First boot takes a while; `/health` returns 503 with a reason until the model is ready.

### Without Docker

```bash
git clone --recursive https://github.com/MoonshotAI/Kimi-Audio.git
pip install -r Kimi-Audio/requirements.txt
pip install flash-attn --no-build-isolation
pip install -r server/requirements.txt

export PYTHONPATH=/path/to/Kimi-Audio
uvicorn app:app --host 0.0.0.0 --port 8000   # from inside server/
```

### Server environment variables

| Variable | Default | Notes |
| --- | --- | --- |
| `KIMI_MODEL_PATH` | `moonshotai/Kimi-Audio-7B-Instruct` | HF id or local checkpoint path. |
| `KIMI_API_KEY` | *(unset)* | When set, `/v1/generate` requires a matching bearer token. |
| `KIMI_LOAD_DETOKENIZER` | `1` | `0` saves VRAM but disables audio output. |
| `KIMI_ALLOWED_ORIGINS` | `*` | Comma-separated CORS origins. Lock to your Netlify URL. |
| `KIMI_MAX_AUDIO_BYTES` | `52428800` | Per-clip upload ceiling. |

### Exposing it to the console

The browser needs to reach the backend over HTTPS. Any of these work:

- **RunPod / Vast.ai / Lambda Labs** — deploy the Dockerfile, use the provided HTTPS proxy URL.
- **A cloud VM with a GPU** — put Caddy or nginx with TLS in front of port 8000.
- **A local GPU** — `cloudflared tunnel --url http://localhost:8000` gives you a public HTTPS URL.

A browser on an HTTPS page cannot call a plain `http://` backend, so a bare IP and port
will be blocked as mixed content. Use one of the above, or the Proxy mode described below.

---

## Using the console

**Transcribe** turns speech into text. **Ask** answers a question about the clip in text.
**Voice chat** returns spoken audio plus text and keeps previous turns as context.

Clips are decoded with WebAudio and re-encoded to 16 kHz mono WAV in the browser before
being sent, so any format the browser can open (WAV, MP3, M4A, FLAC, OGG) is fine.
Ctrl/Cmd+Enter runs the current input.

### Direct vs Proxy mode

**Direct** (default) — the browser calls your backend. No time or size limit, so this is
the right choice for audio-to-audio generation, which routinely takes longer than a
minute. Requires CORS on the backend, which `server/app.py` handles.

**Proxy** — the browser calls `/api/generate`, which forwards the request with
`KIMI_API_KEY` attached. Use this when the site is shared and the key must stay secret.
It inherits Netlify's 26-second and ~5 MB request limits; the console reports a clear
error and tells you to switch modes when either is hit.

---

## API

`POST /v1/generate`

```jsonc
{
  "messages": [
    { "role": "user", "message_type": "text",  "content": "Transcribe this." },
    { "role": "user", "message_type": "audio", "content": {
        "format": "wav", "data_base64": "UklGRi..." } }
  ],
  "output_type": "text",        // or "both" for text + speech
  "sampling_params": { "text_top_k": 5 }
}
```

```jsonc
{
  "text": "…",
  "audio": { "format": "wav", "sample_rate": 24000, "data_base64": "…" },  // null unless "both"
  "elapsed_ms": 8421,
  "model": "moonshotai/Kimi-Audio-7B-Instruct"
}
```

Assistant turns in a multi-turn history use `"message_type": "audio-text"` with
`content: [audioObject, "text"]`, mirroring Kimi-Audio's own message format.
Sampling parameters not recognised by Kimi-Audio are dropped rather than forwarded.

`GET /health` reports the model id, device, and whether the detokenizer is loaded.

---

## Tests

```bash
python server/test_app.py      # server contract, model stubbed — no GPU needed
netlify dev                    # console + functions at localhost:8888
```

`server/test_app.py` covers auth, base64↔file translation, sampling-param filtering,
multi-turn message shaping, and error mapping with `kimia_infer` and `torch` stubbed,
so it runs on any machine.

---

## Layout

```
public/            Console UI (no build step)
  index.html
  styles.css
  app.js           Recording, WAV encoding, API client
netlify/
  functions/       status, health, generate
  lib/backend.mjs  Shared backend helpers
server/
  app.py           FastAPI wrapper around kimia_infer
  test_app.py      Contract tests, model stubbed
  Dockerfile       CUDA 12.8 + Kimi-Audio + server
  docker-compose.yml
netlify.toml
```

---

## Licence

The console and server wrapper in this repo are MIT. Kimi-Audio itself is licensed by
MoonshotAI — see [their repository](https://github.com/MoonshotAI/Kimi-Audio) for model
weights and terms.
