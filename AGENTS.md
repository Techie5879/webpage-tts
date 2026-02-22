# Repository Guidelines

## Project Structure & Module Organization
- `tts_server/`: FastAPI server (MLX-backed) and runtime config (`app.py`, `config.py`, `constants.py`).
- `chrome_extension/`: MV3 extension (popup UI, background worker, content/offscreen scripts).
- `tests/`: Local validation helpers (e.g., `mlx_tts.py`).
- `main.py`: Entry point to launch the server.
- `llama.cpp/`: Local llama.cpp backend source checkout and tooling.
- `requirements.txt`: Python dependencies.

## Build, Test, and Development Commands
- `uv venv --python 3.12`: Create a local Python 3.12 venv.
- `source .venv/bin/activate`: Activate the venv.
- `uv pip install -r requirements.txt`: Install Python dependencies.
- `uv run python main.py doctor`: Validate Apple Silicon + MLX runtime.
- `uv run python main.py prefetch`: Download required models into repo-local `models/mlx/`.
- `uv run python main.py serve`: Start the MLX TTS server on `127.0.0.1:9872`.
- `.venv/bin/python tests/mlx_tts.py --max-attempts 1`: Run backend TTS test with a hard 120s timeout per attempt.
- `bun install` (inside `chrome_extension/`): Install extension dependencies.
- `bun run dev` (inside `chrome_extension/`): Run extension dev workflow.
- `bun run build` (inside `chrome_extension/`): Build extension production bundle.
- Chrome extension: load `chrome_extension/` via `chrome://extensions` → “Load unpacked”. Reload after changes.

## JavaScript Tooling Rule
- Do not use `npm` commands in this repository.
- Always use Bun for JS package management and scripts (`bun install`, `bun run ...`).

## Coding Style & Naming Conventions
- Python: 4‑space indentation, snake_case for functions/vars.
- JS/HTML/CSS: 2‑space indentation, camelCase for JS vars, kebab-case for CSS classes.
- Keep edits minimal, readable, and ASCII where possible. No formatter is enforced.
- Prefer deep, end-to-end logging instrumentation when debugging or adding features that touch runtime behavior. Default to adding logs at each hop (UI → background → offscreen → server), include payload metadata, timings, and error details, and keep them in place unless the user asks to remove them.

## Testing Guidelines
- No formal test suite. Use `tests/mlx_tts.py` for a quick backend sanity check.
- Tests should be runnable from the repo root and use `.venv/bin/python` or `uv run`.
- Any test that validates generated audio must enforce both RMS and VAD-based voiced-ratio checks (not just non-empty WAV output).
- After completing any feature change (backend, frontend, or UI), rerun the relevant test suite/scripts before handing off. Do this once per completed change set, not after every small patch.

## Commit & Pull Request Guidelines
- No commit message convention is defined in this repo. Use clear, imperative messages (e.g., “Add MLX test script”).
- PRs should describe changes, list test commands run, and include screenshots for UI changes (popup/extension).

## README Editing Rule
- Do not modify the dev-workflow narrative/documentation block at the top of `README.md` unless the user explicitly asks for it.
- You may update other README sections (setup, commands, endpoints, tests, etc.).

## Configuration & Runtime Notes
- Backend standard: use MLX for local inference/runtime behavior.
- Do not use LM Studio in this repository; it is no longer part of the backend path.

## Long-Running Commands
- For long-running downloads/builds/tests, always run unbuffered output and pipe through `tee` so progress is visible live and persisted to a log file.
- Preferred pattern: `PYTHONUNBUFFERED=1 <command> 2>&1 | tee <log-file>`.
