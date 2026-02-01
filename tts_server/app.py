from __future__ import annotations

import base64
import io
from typing import Dict, Literal, Optional, Tuple

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from loguru import logger
from pydantic import BaseModel, Field

from .config import Settings
from .constants import DEFAULT_CUSTOMVOICE_SPEAKERS

settings = Settings()
logger.info(
    "Config: backend=mlx, mlx_custom={}, mlx_design={}, mlx_clone={}",
    settings.mlx_custom_voice_model_small,
    settings.mlx_voice_design_model,
    settings.mlx_voice_clone_model,
)

app = FastAPI(title="Webpage TTS Server", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

BackendName = Literal["mlx"]
ModeName = Literal["default", "custom", "design", "clone"]

_mlx_models: Dict[str, object] = {}


class TTSRequest(BaseModel):
    mode: ModeName = "default"
    backend: BackendName = "mlx"
    text: str = Field(..., min_length=1)
    custom_model_size: Optional[str] = Field(
        default=None, description="CustomVoice model size: 0.6b or 1.7b"
    )
    speaker: Optional[str] = None
    instruction: Optional[str] = None
    ref_audio_b64: Optional[str] = None
    ref_text: Optional[str] = None
    speed: float = 1.0
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    top_k: Optional[int] = None
    max_new_tokens: Optional[int] = None


def _decode_b64_audio(b64_str: str) -> bytes:
    if b64_str.startswith("data:"):
        b64_str = b64_str.split(",", 1)[1]
    return base64.b64decode(b64_str)


def _get_mlx_model(model_id: str):
    if model_id in _mlx_models:
        return _mlx_models[model_id]

    from mlx_audio.tts.utils import load_model
    from transformers import AutoTokenizer

    logger.info("Loading MLX model: {}", model_id)
    model = load_model(model_id)
    if getattr(model, "tokenizer", None) is not None:
        tokenizer_name = getattr(getattr(model, "config", None), "tokenizer_name", None)
        if tokenizer_name:
            model.tokenizer = AutoTokenizer.from_pretrained(
                tokenizer_name, fix_mistral_regex=True
            )
            logger.info("Reloaded tokenizer with fix_mistral_regex=True")
    _mlx_models[model_id] = model
    return model


def _mlx_gen_kwargs(req: TTSRequest) -> Dict[str, object]:
    kwargs: Dict[str, object] = {}
    if req.temperature is not None:
        kwargs["temperature"] = req.temperature
    if req.top_p is not None:
        kwargs["top_p"] = req.top_p
    if req.top_k is not None:
        kwargs["top_k"] = req.top_k
    if req.max_new_tokens is not None:
        kwargs["max_tokens"] = req.max_new_tokens
    return kwargs


def _log_audio_stats(audio: np.ndarray, sr: int, label: str) -> None:
    if audio.size == 0:
        logger.warning("{} audio empty", label)
        return
    audio = audio.astype(np.float32)
    rms = float(np.sqrt(np.mean(np.square(audio))))
    logger.info(
        "{} audio: sr={} len={} samples min={:.4f} max={:.4f} rms={:.6f}",
        label,
        sr,
        audio.shape[0],
        float(np.min(audio)),
        float(np.max(audio)),
        rms,
    )


def _read_ref_audio_mlx(model, b64: str) -> Tuple["mx.array", int]:
    import mlx.core as mx
    from scipy.signal import resample

    audio_bytes = _decode_b64_audio(b64)
    wav, sr = sf.read(io.BytesIO(audio_bytes))
    if wav.ndim > 1:
        wav = wav.mean(axis=1)
    if sr != model.sample_rate:
        duration = wav.shape[0] / sr
        target_samples = int(duration * model.sample_rate)
        wav = resample(wav, target_samples)
        sr = model.sample_rate
    return mx.array(wav, dtype=mx.float32), sr


def _synthesize_mlx(req: TTSRequest) -> Tuple[np.ndarray, int]:
    logger.info("MLX synth: mode={} text_len={}", req.mode, len(req.text))

    if req.mode in {"default", "custom"}:
        size = (req.custom_model_size or settings.mlx_custom_voice_default_size).lower()
        if size in {"1.7b", "1.7", "large"}:
            model_id = settings.mlx_custom_voice_model_large
        else:
            model_id = settings.mlx_custom_voice_model_small
    elif req.mode == "design":
        if not settings.mlx_voice_design_model:
            raise HTTPException(
                status_code=400,
                detail="MLX voice design model not configured.",
            )
        model_id = settings.mlx_voice_design_model
        if not req.instruction:
            raise HTTPException(
                status_code=400,
                detail="instruction is required for voice design.",
            )
    else:
        if not settings.mlx_voice_clone_model:
            raise HTTPException(
                status_code=400,
                detail="MLX voice clone model not configured.",
            )
        model_id = settings.mlx_voice_clone_model
        if not req.ref_audio_b64:
            raise HTTPException(
                status_code=400,
                detail="ref_audio_b64 is required for voice cloning.",
            )
        if not req.ref_text:
            raise HTTPException(
                status_code=400,
                detail="ref_text is required for voice cloning (STT disabled).",
            )

    model = _get_mlx_model(model_id)
    voice = req.speaker or settings.default_speaker

    ref_audio = None
    ref_text = None
    if req.mode == "clone":
        ref_audio, _ = _read_ref_audio_mlx(model, req.ref_audio_b64)
        ref_text = req.ref_text

    gen_kwargs: Dict[str, object] = {
        "text": req.text,
        "voice": voice,
        "lang_code": "en",
        "speed": req.speed or 1.0,
        "verbose": False,
        "stream": False,
        "ref_audio": ref_audio,
        "ref_text": ref_text,
        "instruct": req.instruction,
    }
    gen_kwargs.update(_mlx_gen_kwargs(req))

    results = list(model.generate(**gen_kwargs))
    if not results:
        raise HTTPException(status_code=500, detail="MLX backend returned no audio")

    import mlx.core as mx

    audio = (
        mx.concatenate([r.audio for r in results], axis=0)
        if len(results) > 1
        else results[0].audio
    )
    audio_np = np.array(audio)
    sample_rate = results[0].sample_rate
    _log_audio_stats(audio_np, sample_rate, "MLX")
    return audio_np, sample_rate


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/capabilities")
def capabilities() -> Dict[str, object]:
    return {
        "backend": "mlx",
        "modes": ["default", "custom", "design", "clone"],
        "models": {
            "mlx": {
                "custom_voice": {
                    "small": settings.mlx_custom_voice_model_small,
                    "large": settings.mlx_custom_voice_model_large,
                    "default_size": settings.mlx_custom_voice_default_size,
                },
                "voice_design": settings.mlx_voice_design_model,
                "voice_clone": settings.mlx_voice_clone_model,
            }
        },
    }


@app.get("/speakers")
def speakers() -> JSONResponse:
    return JSONResponse({"speakers": DEFAULT_CUSTOMVOICE_SPEAKERS})


@app.post("/tts")
def tts(req: TTSRequest) -> Response:
    logger.info(
        "TTS request: mode={} text_len={} speaker={} instruction_len={} "
        "custom_model_size={} ref_audio={} ref_text={} speed={} temp={} top_p={} top_k={} max_new_tokens={}",
        req.mode,
        len(req.text),
        req.speaker,
        len(req.instruction or ""),
        req.custom_model_size,
        bool(req.ref_audio_b64),
        bool(req.ref_text),
        req.speed,
        req.temperature,
        req.top_p,
        req.top_k,
        req.max_new_tokens,
    )
    if req.backend != "mlx":
        raise HTTPException(
            status_code=400,
            detail="Only MLX backend is supported.",
        )

    audio, sr = _synthesize_mlx(req)
    buf = io.BytesIO()
    sf.write(buf, audio, sr, format="WAV")
    return Response(
        content=buf.getvalue(),
        media_type="audio/wav",
        headers={"X-Sample-Rate": str(sr)},
    )
