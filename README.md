# Webpage TTS (MLX Qwen3)

A local TTS server + a Chromium extension that reads selected text or pages aloud using MLX Qwen3-TTS (Apple Silicon optimized).

## Requirements
- macOS (Apple Silicon recommended for MLX)
- Python 3.12
- `uv`

## Setup
```bash
uv venv --python 3.12
source .venv/bin/activate
uv pip install -r requirements.txt
```

## Run the server
```bash
uv run python main.py
```

Server defaults:
- Host: `127.0.0.1`
- Port: `9872`

Environment variables:
- `TTS_HOST=127.0.0.1`
- `TTS_PORT=9872`
- `TTS_DEFAULT_SPEAKER=Vivian`
- `MLX_CUSTOM_VOICE_MODEL=mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit`
- `MLX_VOICE_DESIGN_MODEL=mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit`
- `MLX_VOICE_CLONE_MODEL=mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit`
- `HF_HUB_ENABLE_XET=1` (faster downloads)
- `HF_HUB_ENABLE_HF_TRANSFER=1` (optional speed-up)

Notes:
- MLX-only (no Torch/Qwen runtime).
- English-only is enforced at the server level (no language selector).

## MLX CLI quick test
```bash
python -m mlx_audio.tts.generate --model mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit --text "Hello, this is a test."
```

Python example:
```python
from mlx_audio.tts.utils import load_model
from mlx_audio.tts.generate import generate_audio

model = load_model("mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit")
generate_audio(
    model=model,
    text="Hello, this is a test.",
    ref_audio="path_to_audio.wav",
    file_prefix="test_audio",
)
```

## Chrome extension
1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select `chrome_extension`.
4. Click the extension icon to open the popup.
5. If you update extension files, click **Reload** for the extension in `chrome://extensions`.
6. Optional: set the extension **Site access** to “On all sites” if you see “Receiving end does not exist”.

### How to use
- **Default**: uses the server’s default speaker.
- **Custom Voices**: choose a speaker + optional style instruction.
- **Voice Design**: provide a voice description; optionally save it.
- **Voice Clone**: upload a reference audio clip, provide its transcript, optionally save it.
- **Test Tone**: plays a short 440Hz beep to confirm audio output from the popup.
- **Test TTS (MLX)**: fetches a short hardcoded phrase from the MLX backend to verify end-to-end audio output.

## Local MLX test (loop-until-pass)
This script runs a local MLX synthesis loop and keeps retrying until it gets non‑silent audio.
```bash
uv run python scripts/test_mlx_tts.py
```
To stop after N tries:
```bash
uv run python scripts/test_mlx_tts.py --max-attempts 5
```
Each attempt has a hard 120s timeout (override with `--timeout`).

### Tips
- Voice design requires the MLX VoiceDesign model.
- Voice cloning requires the MLX Base model and a reference transcript.

## Endpoints
- `GET /health`
- `GET /capabilities`
- `GET /speakers`
- `POST /tts`

## Gotchas (important)
- **MLX-only**: Torch/Qwen runtimes are removed. Only MLX models are supported.
- **MLX runs on Apple Metal** (no CPU fallback). Expect large models to take significant memory.
- **Voice Design requires the MLX VoiceDesign model**. If it isn’t configured, the server returns a 400.
- **Voice Clone requires ref text** (no auto-transcription). If you need STT, you must add it yourself.
- **Speaker list is fixed** to the CustomVoice speaker set.
- **Tokenizer regex warning**: MLX Qwen3‑TTS can trigger a tokenizer regex warning; the server reloads the tokenizer with `fix_mistral_regex=True`.
- **Audio playback uses an offscreen document** so it won’t be blocked by page autoplay policies. If you still hear nothing, make sure the extension is reloaded after changes.
- **Chrome internal pages are blocked**. If you see “Receiving end does not exist,” open a normal webpage (not `chrome://`, the Chrome Web Store, or extension pages) and try again.

## Caching & re-downloads
Hugging Face downloads are cached. If you’re seeing re-downloads, set a stable cache path:

```bash
export HF_HOME=~/.cache/huggingface
export HF_HUB_ENABLE_XET=1
export HF_HUB_ENABLE_HF_TRANSFER=1
```

If you want to force `hf_transfer` usage, install its extra:
```bash
uv pip install "huggingface_hub[hf_transfer]"
```

You can also bypass cache entirely by using local model paths (see Offline model downloads below).

## Offline model downloads (Hugging Face CLI)
If you want to download models ahead of time and run fully offline:

```bash
uv pip install -r requirements.txt
uv run huggingface-cli login
uv run huggingface-cli download mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit --local-dir ./models/mlx-customvoice --local-dir-use-symlinks False
uv run huggingface-cli download mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit --local-dir ./models/mlx-voicedesign --local-dir-use-symlinks False
uv run huggingface-cli download mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit --local-dir ./models/mlx-base --local-dir-use-symlinks False
```

Then point your env vars to local paths:
```bash
export MLX_CUSTOM_VOICE_MODEL=./models/mlx-customvoice
export MLX_VOICE_DESIGN_MODEL=./models/mlx-voicedesign
export MLX_VOICE_CLONE_MODEL=./models/mlx-base
```

## Project layout
```
chrome_extension/   # Chromium extension (popup UI + background + content script)
main.py             # Launches the local server
requirements.txt
tts_server/         # FastAPI app + backends
```
