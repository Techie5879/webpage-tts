from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional


def _env(name: str, default: Optional[str] = None) -> Optional[str]:
    value = os.getenv(name)
    return value if value is not None else default


@dataclass(frozen=True)
class Settings:
    host: str = _env("TTS_HOST", "127.0.0.1")
    port: int = int(_env("TTS_PORT", "9872") or 9872)

    # MLX models
    mlx_custom_voice_model_small: str = _env(
        "MLX_CUSTOM_VOICE_MODEL_SMALL",
        "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit",
    )
    mlx_custom_voice_model_large: str = _env(
        "MLX_CUSTOM_VOICE_MODEL_LARGE",
        "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit",
    )
    mlx_custom_voice_default_size: str = _env(
        "MLX_CUSTOM_VOICE_DEFAULT_SIZE",
        "0.6b",
    ).lower()
    mlx_voice_design_model: Optional[str] = _env(
        "MLX_VOICE_DESIGN_MODEL",
        "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit",
    )
    mlx_voice_clone_model: Optional[str] = _env(
        "MLX_VOICE_CLONE_MODEL",
        "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit",
    )

    # Defaults
    default_speaker: str = _env("TTS_DEFAULT_SPEAKER", "Vivian")
