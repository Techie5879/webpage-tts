# Webpage TTS

Local page/selection text-to-speech with a Chromium extension + FastAPI backend (MLX Qwen3-TTS).

A simple (lamely named) repo that keeps me engaged/up to date on my reading lists/blog reading that I will probably never get to otherwise.

This repo is also an experiment in what gpt-5.2-codex does if given not really much structure at all and just told in pretty vague words. Local model server instructions was given properly but the AGENTS/chrome extension etc was pretty much fully up to the agent. Sometimes it was pretty frustrating.

EDIT: `d03de654c2cb5c8566e043fc28af16166f40f180` was the state of the repo where we did a very vague "codex just here's what I want and make this" because I was lazy. I realized I wanted this more than I thought - and thus the state that "just make this" was pretty unusable, unmaintainable, and ugly. 
Workflow after the hash ^:
Opus 4.6 plan -> Was pretty dogshit so I had to instruct it on how to not be completely stupid -> Composer 1.5 Implement -> Codex Deep-Dive + small nudges to implement and clean up -> Opus 4.6 Frontend Iteration

This worked and I have something thats prettyyy nice now, maybe I'll even change the name to something that is not lame.

## What this project does
- Runs a local TTS server on your machine.
- Adds a browser side panel to read selected text or full pages aloud.
- Supports Custom Voice, Voice Design, and Voice Clone modes.

## Requirements
- macOS (Apple Silicon recommended)
- Python 3.12
- `uv`
- Chrome/Chromium

## Quick start
```bash
uv venv --python 3.12
source .venv/bin/activate
uv pip install -r requirements.txt
uv run python main.py
```

Server default: `http://127.0.0.1:9872`

## Load extension
1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked and choose `chrome_extension/`.
4. Open the side panel and click Speak.

## Voice modes
- `custom`: built-in speakers + optional style instruction
- `design`: create a voice from a text prompt
- `clone`: reference audio + reference text

## API endpoints
- `GET /health`
- `GET /capabilities`
- `GET /speakers`
- `POST /tts`

## Common env vars
- `TTS_HOST`, `TTS_PORT`, `TTS_DEFAULT_SPEAKER`, `TTS_LOG_LEVEL`
- `MLX_CUSTOM_VOICE_MODEL_SMALL`, `MLX_CUSTOM_VOICE_MODEL_LARGE`
- `MLX_CUSTOM_VOICE_DEFAULT_SIZE`, `MLX_VOICE_DESIGN_MODEL`, `MLX_VOICE_CLONE_MODEL`

## Quick sanity test
```bash
.venv/bin/python scripts/test_mlx_tts.py --max-attempts 1
```
