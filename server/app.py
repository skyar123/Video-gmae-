"""
Kimi-Audio inference server.

A thin HTTP layer over MoonshotAI's `kimia_infer` package, shaped to the
contract the Netlify console in ../public expects:

    GET  /health        -> model / device / capability report
    POST /v1/generate   -> {messages, output_type, sampling_params} -> {text, audio}

Audio crosses the wire as base64 WAV. Kimi-Audio's own API takes file paths,
so each inbound clip is written to a scratch file for the duration of the call.

Run:
    export KIMI_MODEL_PATH=moonshotai/Kimi-Audio-7B-Instruct
    uvicorn app:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import base64
import binascii
import logging
import os
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal

import soundfile as sf
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("kimi-audio-server")

MODEL_PATH = os.environ.get("KIMI_MODEL_PATH", "moonshotai/Kimi-Audio-7B-Instruct")
API_KEY = os.environ.get("KIMI_API_KEY", "").strip()
# Kimi-Audio's detokenizer is what turns tokens back into speech. Skipping it
# roughly halves VRAM but makes output_type="both" unavailable.
LOAD_DETOKENIZER = os.environ.get("KIMI_LOAD_DETOKENIZER", "1") not in ("0", "false", "False")
ALLOWED_ORIGINS = [
    o.strip() for o in os.environ.get("KIMI_ALLOWED_ORIGINS", "*").split(",") if o.strip()
]
# Kimi-Audio's detokenizer emits 24 kHz.
OUTPUT_SAMPLE_RATE = 24_000
MAX_AUDIO_BYTES = int(os.environ.get("KIMI_MAX_AUDIO_BYTES", 50 * 1024 * 1024))

DEFAULT_SAMPLING_PARAMS: dict[str, Any] = {
    "audio_temperature": 0.8,
    "audio_top_k": 10,
    "text_temperature": 0.0,
    "text_top_k": 5,
    "audio_repetition_penalty": 1.0,
    "audio_repetition_window_size": 64,
    "text_repetition_penalty": 1.0,
    "text_repetition_window_size": 16,
}

# Only these keys are forwarded to model.generate(); anything else is dropped
# rather than risking a TypeError deep in the library.
ALLOWED_SAMPLING_KEYS = frozenset(DEFAULT_SAMPLING_PARAMS)

_state: dict[str, Any] = {"model": None, "device": "unknown", "error": None}


# ── Lifespan ────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(_: FastAPI):
    """Load the model once at boot; a 7B load is far too slow per-request."""
    try:
        import torch
        from kimia_infer.api.kimia import KimiAudio

        _state["device"] = (
            f"cuda:{torch.cuda.current_device()} ({torch.cuda.get_device_name(0)})"
            if torch.cuda.is_available()
            else "cpu"
        )
        if not torch.cuda.is_available():
            log.warning(
                "No CUDA device visible. Kimi-Audio-7B needs a GPU; "
                "CPU inference will be unusably slow if it runs at all."
            )

        log.info("Loading %s (detokenizer=%s)…", MODEL_PATH, LOAD_DETOKENIZER)
        started = time.time()
        _state["model"] = KimiAudio(model_path=MODEL_PATH, load_detokenizer=LOAD_DETOKENIZER)
        log.info("Model ready in %.1fs on %s", time.time() - started, _state["device"])
    except Exception as exc:  # noqa: BLE001 - surface load failure via /health
        _state["error"] = f"{type(exc).__name__}: {exc}"
        log.exception("Model failed to load; /health will report unhealthy.")

    yield
    _state["model"] = None


app = FastAPI(title="Kimi-Audio Server", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["authorization", "content-type"],
)


# ── Auth ────────────────────────────────────────────────────────────────
async def require_key(request: Request) -> None:
    """No-op unless KIMI_API_KEY is set, so local runs stay frictionless."""
    if not API_KEY:
        return
    header = request.headers.get("authorization", "")
    presented = header[7:].strip() if header.lower().startswith("bearer ") else ""
    # Constant-time compare so the key can't be recovered by timing.
    import hmac

    if not hmac.compare_digest(presented, API_KEY):
        raise HTTPException(status_code=401, detail="Invalid or missing API key.")


# ── Schema ──────────────────────────────────────────────────────────────
class AudioPayload(BaseModel):
    data_base64: str
    format: str = "wav"
    sample_rate: int | None = None


class Message(BaseModel):
    role: Literal["user", "assistant"]
    message_type: Literal["text", "audio", "audio-text"]
    # text -> str | audio -> AudioPayload | audio-text -> [AudioPayload, str]
    content: Any


class GenerateRequest(BaseModel):
    messages: list[Message] = Field(min_length=1)
    output_type: Literal["text", "both"] = "text"
    sampling_params: dict[str, Any] = Field(default_factory=dict)


# ── Helpers ─────────────────────────────────────────────────────────────
def _decode_audio(payload: Any, scratch: Path, index: int) -> str:
    """Materialise a base64 clip on disk and return its path."""
    if isinstance(payload, str):
        # Also accept a plain path/URL the caller already has on the box.
        return payload

    audio = AudioPayload.model_validate(payload)
    try:
        raw = base64.b64decode(audio.data_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Malformed base64 audio: {exc}") from exc

    if not raw:
        raise HTTPException(status_code=400, detail="Audio payload is empty.")
    if len(raw) > MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Audio is {len(raw)} bytes; limit is {MAX_AUDIO_BYTES}.",
        )

    suffix = f".{audio.format.lstrip('.')}" if audio.format else ".wav"
    path = scratch / f"clip_{index}{suffix}"
    path.write_bytes(raw)
    return str(path)


def _to_kimi_messages(messages: list[Message], scratch: Path) -> list[dict[str, Any]]:
    """Translate the wire format into what kimia_infer.generate expects."""
    out: list[dict[str, Any]] = []

    for i, msg in enumerate(messages):
        if msg.message_type == "text":
            if not isinstance(msg.content, str):
                raise HTTPException(status_code=400, detail=f"Message {i}: text content must be a string.")
            out.append({"role": msg.role, "message_type": "text", "content": msg.content})

        elif msg.message_type == "audio":
            out.append(
                {
                    "role": msg.role,
                    "message_type": "audio",
                    "content": _decode_audio(msg.content, scratch, i),
                }
            )

        elif msg.message_type == "audio-text":
            if not isinstance(msg.content, (list, tuple)) or len(msg.content) != 2:
                raise HTTPException(
                    status_code=400,
                    detail=f"Message {i}: audio-text content must be [audio, text].",
                )
            audio_part, text_part = msg.content
            out.append(
                {
                    "role": msg.role,
                    "message_type": "audio-text",
                    "content": [_decode_audio(audio_part, scratch, i), text_part],
                }
            )

    return out


def _merge_sampling(overrides: dict[str, Any]) -> dict[str, Any]:
    params = dict(DEFAULT_SAMPLING_PARAMS)
    for key, value in overrides.items():
        if key in ALLOWED_SAMPLING_KEYS and isinstance(value, (int, float)):
            params[key] = value
        elif key not in ALLOWED_SAMPLING_KEYS:
            log.debug("Ignoring unknown sampling param %r", key)
    return params


def _encode_wav(wav_tensor, scratch: Path) -> str:
    out_path = scratch / "reply.wav"
    sf.write(str(out_path), wav_tensor.detach().cpu().view(-1).numpy(), OUTPUT_SAMPLE_RATE)
    return base64.b64encode(out_path.read_bytes()).decode("ascii")


# ── Routes ──────────────────────────────────────────────────────────────
@app.get("/health")
async def health() -> dict[str, Any]:
    ready = _state["model"] is not None
    body = {
        "ok": ready,
        "model": MODEL_PATH,
        "device": _state["device"],
        "detokenizer_loaded": LOAD_DETOKENIZER and ready,
        "output_sample_rate": OUTPUT_SAMPLE_RATE,
        "auth_required": bool(API_KEY),
    }
    if not ready:
        body["error"] = _state["error"] or "Model is still loading."
        raise HTTPException(status_code=503, detail=body)
    return body


@app.post("/v1/generate", dependencies=[Depends(require_key)])
async def generate(req: GenerateRequest) -> dict[str, Any]:
    model = _state["model"]
    if model is None:
        raise HTTPException(
            status_code=503,
            detail=_state["error"] or "Model is still loading; retry shortly.",
        )
    if req.output_type == "both" and not LOAD_DETOKENIZER:
        raise HTTPException(
            status_code=400,
            detail="This server was started with KIMI_LOAD_DETOKENIZER=0, so it cannot return audio. "
            "Use output_type='text'.",
        )

    started = time.time()
    with tempfile.TemporaryDirectory(prefix="kimi-") as tmp:
        scratch = Path(tmp)
        kimi_messages = _to_kimi_messages(req.messages, scratch)
        params = _merge_sampling(req.sampling_params)

        log.info("generate: %d messages, output_type=%s", len(kimi_messages), req.output_type)
        try:
            wav, text = model.generate(kimi_messages, **params, output_type=req.output_type)
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001 - report inference failure to caller
            log.exception("Inference failed")
            raise HTTPException(status_code=500, detail=f"Inference failed: {exc}") from exc

        audio_field = None
        if req.output_type == "both" and wav is not None:
            audio_field = {
                "format": "wav",
                "sample_rate": OUTPUT_SAMPLE_RATE,
                "data_base64": _encode_wav(wav, scratch),
            }

    return {
        "text": text,
        "audio": audio_field,
        "elapsed_ms": int((time.time() - started) * 1000),
        "model": MODEL_PATH,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=os.environ.get("HOST", "0.0.0.0"),
        port=int(os.environ.get("PORT", "8000")),
    )
