from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODELS_DIR = PROJECT_ROOT / "models" / "mlx"
LOG_DIR = PROJECT_ROOT / "logs"
RUNTIME_DIR = PROJECT_ROOT / "runtime"
HF_HOME_DIR = PROJECT_ROOT / ".hf"
HF_HUB_CACHE_DIR = HF_HOME_DIR / "hub"
HF_XET_CACHE_DIR = HF_HOME_DIR / "xet"

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 9872
DEFAULT_SPEAKER = "Vivian"
DEFAULT_CUSTOM_MODEL_SIZE = "0.6b"

MLX_CUSTOM_VOICE_MODEL_SMALL = "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit"
MLX_CUSTOM_VOICE_MODEL_LARGE = "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit"
MLX_VOICE_DESIGN_MODEL = "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit"
MLX_VOICE_CLONE_MODEL = "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit"

MODEL_IDS = {
    "custom_small": MLX_CUSTOM_VOICE_MODEL_SMALL,
    "custom_large": MLX_CUSTOM_VOICE_MODEL_LARGE,
    "design": MLX_VOICE_DESIGN_MODEL,
    "clone": MLX_VOICE_CLONE_MODEL,
}


def apply_runtime_env() -> None:
    os.environ["HF_HUB_ENABLE_HF_TRANSFER"] = "1"
    os.environ["HF_HUB_ENABLE_XET"] = "1"
    os.environ["HF_HOME"] = str(HF_HOME_DIR)
    os.environ["HF_HUB_CACHE"] = str(HF_HUB_CACHE_DIR)
    os.environ["HF_XET_CACHE"] = str(HF_XET_CACHE_DIR)


def ensure_runtime_dirs() -> None:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    HF_HOME_DIR.mkdir(parents=True, exist_ok=True)
    HF_HUB_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    HF_XET_CACHE_DIR.mkdir(parents=True, exist_ok=True)


def model_local_dir(model_id: str) -> Path:
    return MODELS_DIR / model_id.replace("/", "--")
