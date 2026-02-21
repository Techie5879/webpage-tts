# Webpage TTS

Local page/selection text-to-speech with a Chromium extension + FastAPI backend (MLX Qwen3-TTS).

A simple (lamely named) repo that keeps me engaged/up to date on my reading lists/blog reading that I will probably never get to otherwise.

This repo is also an experiment in what gpt-5.2-codex does if given not really much structure at all and just told in pretty vague words. Local model server instructions was given properly but the AGENTS/chrome extension etc was pretty much fully up to the agent. Sometimes it was pretty frustrating.

EDIT: `d03de654c2cb5c8566e043fc28af16166f40f180` was the state of the repo where we did a very vague "codex just here's what I want and make this" because I was lazy. I realized I wanted this more than I thought - and thus the state that "just make this" was pretty unusable, unmaintainable, and ugly.
Workflow after the hash ^:
Opus 4.6 plan -> Was pretty dogshit so I had to instruct it on how to not be completely stupid -> Composer 1.5 Implement -> Codex Deep-Dive + small nudges to implement and clean up -> Opus 4.6 Frontend Iteration

This worked and I have something thats prettyyy nice now, maybe I'll even change the name to something that is not lame.

## What this project does
- Runs a local TTS server on Apple Silicon macOS.
- Downloads required models into this repo (not global HF cache).
- Exposes a local API that the Chrome extension calls.

## Requirements
- macOS on Apple Silicon
- Python 3.12
- `uv`
- Chrome/Chromium

## Setup
```bash
uv venv --python 3.12
source .venv/bin/activate
uv pip install -r requirements.txt
```

## Run flow
1) Verify runtime:
```bash
uv run python main.py doctor
```

2) Download models (long-running; unbuffered + tee):
```bash
PYTHONUNBUFFERED=1 uv run python main.py prefetch 2>&1 | tee prefetch.log
```

3) Start server:
```bash
uv run python main.py serve
```

Server default: `http://127.0.0.1:9872`

## Local folders used by backend
- `models/mlx/` for all MLX model files
- `.hf/` for Hugging Face cache/xet internals
- `logs/` for rotating Loguru logs
- `runtime/` for generated runtime metadata

## Load extension
1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked and choose `chrome_extension/`.
4. Open the side panel and click Speak.

## API endpoints
- `GET /health`
- `GET /startup-status`
- `POST /prefetch`
- `GET /capabilities`
- `GET /speakers`
- `POST /tts`

## Validation scripts
```bash
uv run python tests/server_api.py --server-url http://127.0.0.1:9872
uv run python tests/mlx_tts.py --max-attempts 1
```
