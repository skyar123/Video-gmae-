"""
Contract tests for app.py with `kimia_infer` and `torch` stubbed out.

Runs anywhere — no GPU, no model weights. Verifies auth, the base64<->file
translation Kimi-Audio needs, sampling-param filtering, and error mapping.

    pip install fastapi pydantic soundfile httpx numpy
    python server/test_app.py
"""
import base64, sys, types, os
from pathlib import Path

SERVER = Path(__file__).resolve().parent
sys.path.insert(0, str(SERVER))

# ── stub torch ──
torch = types.ModuleType("torch")
class _Cuda:
    @staticmethod
    def is_available(): return True
    @staticmethod
    def current_device(): return 0
    @staticmethod
    def get_device_name(i): return "Stub A100"
torch.cuda = _Cuda()
sys.modules["torch"] = torch

# ── stub kimia_infer ──
captured = {}
class _Wav:
    def detach(self): return self
    def cpu(self): return self
    def view(self, *a): return self
    def numpy(self):
        import numpy as np
        return np.zeros(2400, dtype="float32")

class KimiAudio:
    def __init__(self, model_path, load_detokenizer): captured["init"] = (model_path, load_detokenizer)
    def generate(self, messages, output_type="text", **params):
        captured["messages"] = messages
        captured["params"] = params
        captured["output_type"] = output_type
        return (_Wav() if output_type == "both" else None), "stub transcript"

api = types.ModuleType("kimia_infer.api.kimia"); api.KimiAudio = KimiAudio
pkg = types.ModuleType("kimia_infer"); apipkg = types.ModuleType("kimia_infer.api")
sys.modules.update({"kimia_infer": pkg, "kimia_infer.api": apipkg, "kimia_infer.api.kimia": api})

os.environ["KIMI_API_KEY"] = "secret123"
import app as srv
from fastapi.testclient import TestClient

WAV_B64 = base64.b64encode(b"RIFF....WAVEfmt ").decode()
fails = []
def check(label, cond, extra=""):
    print(("  ok  " if cond else "  FAIL") + f"  {label}" + (f"  <- {extra}" if not cond and extra else ""))
    if not cond: fails.append(label)

with TestClient(srv.app) as c:
    print("\n[health]")
    r = c.get("/health"); b = r.json()
    check("200", r.status_code == 200, r.text)
    check("model reported", b.get("model") == "moonshotai/Kimi-Audio-7B-Instruct", b)
    check("device from torch", "Stub A100" in b.get("device", ""), b)
    check("auth_required true", b.get("auth_required") is True, b)

    print("\n[auth]")
    r = c.post("/v1/generate", json={"messages":[{"role":"user","message_type":"text","content":"hi"}]})
    check("401 without key", r.status_code == 401, r.text)
    r = c.post("/v1/generate", headers={"authorization":"Bearer wrong"},
               json={"messages":[{"role":"user","message_type":"text","content":"hi"}]})
    check("401 with wrong key", r.status_code == 401, r.text)

    H = {"authorization": "Bearer secret123"}

    print("\n[text generate]")
    r = c.post("/v1/generate", headers=H, json={
        "messages":[{"role":"user","message_type":"text","content":"transcribe"},
                    {"role":"user","message_type":"audio","content":{"format":"wav","data_base64":WAV_B64}}],
        "output_type":"text", "sampling_params":{"text_top_k": 9, "bogus_key": 5}})
    b = r.json()
    check("200", r.status_code == 200, r.text)
    check("text returned", b.get("text") == "stub transcript", b)
    check("audio null for text mode", b.get("audio") is None, b)
    check("audio decoded to a path", isinstance(captured["messages"][1]["content"], str)
          and captured["messages"][1]["content"].endswith(".wav"), captured["messages"])
    check("override applied", captured["params"]["text_top_k"] == 9, captured["params"])
    check("default kept", captured["params"]["audio_top_k"] == 10, captured["params"])
    check("unknown param dropped", "bogus_key" not in captured["params"], captured["params"])

    print("\n[both / audio out]")
    r = c.post("/v1/generate", headers=H, json={
        "messages":[{"role":"user","message_type":"audio","content":{"format":"wav","data_base64":WAV_B64}}],
        "output_type":"both"})
    b = r.json()
    check("200", r.status_code == 200, r.text)
    check("audio payload present", isinstance(b.get("audio"), dict), b)
    check("24kHz declared", b["audio"]["sample_rate"] == 24000, b.get("audio"))
    check("audio is valid base64 wav", base64.b64decode(b["audio"]["data_base64"])[:4] == b"RIFF")

    print("\n[multi-turn audio-text]")
    r = c.post("/v1/generate", headers=H, json={
        "messages":[
            {"role":"user","message_type":"audio","content":{"format":"wav","data_base64":WAV_B64}},
            {"role":"assistant","message_type":"audio-text","content":[{"format":"wav","data_base64":WAV_B64},"prior reply"]},
            {"role":"user","message_type":"audio","content":{"format":"wav","data_base64":WAV_B64}}],
        "output_type":"both"})
    check("200", r.status_code == 200, r.text)
    at = captured["messages"][1]
    check("audio-text -> [path, text]", isinstance(at["content"], list)
          and at["content"][0].endswith(".wav") and at["content"][1] == "prior reply", at)

    print("\n[validation]")
    r = c.post("/v1/generate", headers=H, json={"messages":[]})
    check("422 empty messages", r.status_code == 422, r.status_code)
    r = c.post("/v1/generate", headers=H, json={
        "messages":[{"role":"user","message_type":"audio","content":{"data_base64":"!!!not base64!!!"}}]})
    check("400 bad base64", r.status_code == 400, r.text)
    r = c.post("/v1/generate", headers=H, json={
        "messages":[{"role":"user","message_type":"audio","content":{"data_base64":""}}]})
    check("400 empty audio", r.status_code == 400, r.text)
    r = c.post("/v1/generate", headers=H, json={
        "messages":[{"role":"user","message_type":"audio-text","content":["only-one"]}]})
    check("400 malformed audio-text", r.status_code == 400, r.text)
    r = c.post("/v1/generate", headers=H, json={
        "messages":[{"role":"user","message_type":"text","content":"x"}],"output_type":"movie"})
    check("422 bad output_type", r.status_code == 422, r.status_code)

    print("\n[CORS]")
    r = c.options("/v1/generate", headers={"Origin":"https://example.netlify.app",
                                           "Access-Control-Request-Method":"POST"})
    check("preflight allowed", r.headers.get("access-control-allow-origin") is not None, dict(r.headers))

print("\n" + ("ALL PASS" if not fails else f"{len(fails)} FAILURES: {fails}"))
sys.exit(1 if fails else 0)
