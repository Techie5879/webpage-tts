# Repository Guidelines

## Project Structure & Module Organization
- `tts_server/`: FastAPI server (MLX‑only) and runtime config (`app.py`, `config.py`, `constants.py`).
- `chrome_extension/`: MV3 extension (popup UI, background worker, content/offscreen scripts).
- `scripts/`: Local validation helpers (e.g., `test_mlx_tts.py`).
- `main.py`: Entry point to launch the server.
- `requirements.txt`: Python dependencies.

## Build, Test, and Development Commands
- `uv venv --python 3.12`: Create a local Python 3.12 venv.
- `source .venv/bin/activate`: Activate the venv.
- `uv pip install -r requirements.txt`: Install Python dependencies.
- `uv run python main.py`: Start the MLX TTS server on `127.0.0.1:9872`.
- `.venv/bin/python scripts/test_mlx_tts.py --max-attempts 1`: Run MLX test with a hard 120s timeout per attempt.
- Chrome extension: load `chrome_extension/` via `chrome://extensions` → “Load unpacked”. Reload after changes.

## Coding Style & Naming Conventions
- Python: 4‑space indentation, snake_case for functions/vars.
- JS/HTML/CSS: 2‑space indentation, camelCase for JS vars, kebab-case for CSS classes.
- Keep edits minimal, readable, and ASCII where possible. No formatter is enforced.

## Testing Guidelines
- No formal test suite. Use `scripts/test_mlx_tts.py` for a quick MLX sanity check.
- Tests should be runnable from the repo root and use `.venv/bin/python` or `uv run`.

## Commit & Pull Request Guidelines
- No commit message convention is defined in this repo. Use clear, imperative messages (e.g., “Add MLX test script”).
- PRs should describe changes, list test commands run, and include screenshots for UI changes (popup/extension).

## Configuration & Runtime Notes
- MLX‑only: only `mlx-community` model IDs are supported.
- Helpful env vars: `HF_HOME`, `HF_HUB_ENABLE_XET=1`, `HF_HUB_ENABLE_HF_TRANSFER=1`.
- Offline downloads: use `huggingface-cli download` to cache models locally, then point `MLX_*` env vars to those paths.
