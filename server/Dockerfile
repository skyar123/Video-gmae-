# Kimi-Audio inference server.
#
# Builds on MoonshotAI's own CUDA base so flash-attn and deepspeed compile
# against a matching toolchain.
#
#   docker build -t kimi-audio-server ./server
#   docker run --gpus all -p 8000:8000 \
#     -v $HOME/.cache/huggingface:/root/.cache/huggingface \
#     kimi-audio-server
#
# First boot downloads ~15GB of weights; mount the HF cache to keep them.

FROM nvidia/cuda:12.8.1-cudnn-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/root/.cache/huggingface

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3.10 python3.10-dev python3.10-distutils \
      curl git sox ffmpeg libgl1-mesa-glx ninja-build ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN curl -sS https://bootstrap.pypa.io/get-pip.py | python3.10 \
    && ln -sf /usr/bin/python3.10 /usr/bin/python \
    && ln -sf /usr/bin/python3.10 /usr/bin/python3

# Upstream Kimi-Audio, including its git submodules.
ARG KIMI_REF=master
RUN git clone --recursive https://github.com/MoonshotAI/Kimi-Audio.git /opt/kimi-audio \
    && cd /opt/kimi-audio \
    && git checkout "${KIMI_REF}" \
    && git submodule update --init --recursive

RUN pip install --upgrade pip setuptools wheel \
    && pip install -r /opt/kimi-audio/requirements.txt \
    && pip install flash-attn --no-build-isolation

COPY requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

# Make kimia_infer importable without installing the package.
ENV PYTHONPATH=/opt/kimi-audio

COPY app.py /app/app.py

ENV KIMI_MODEL_PATH=moonshotai/Kimi-Audio-7B-Instruct \
    KIMI_LOAD_DETOKENIZER=1 \
    KIMI_ALLOWED_ORIGINS=* \
    PORT=8000

EXPOSE 8000

# Generous start period: the first run pulls and loads a 7B checkpoint.
HEALTHCHECK --interval=30s --timeout=10s --start-period=20m --retries=3 \
  CMD curl -fsS http://localhost:8000/health || exit 1

CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--timeout-keep-alive", "120"]
