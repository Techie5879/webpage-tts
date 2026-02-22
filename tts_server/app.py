from __future__ import annotations

import base64
import gc
import io
import json
import struct
import threading
import time
from pathlib import Path
from typing import Dict, Literal, Optional, Tuple

import numpy as np
import soundfile as sf
from dotenv import find_dotenv, load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from huggingface_hub import snapshot_download
from loguru import logger
from pydantic import BaseModel, Field

from .config import (
    DEFAULT_CUSTOM_MODEL_SIZE,
    DEFAULT_SPEAKER,
    HF_HUB_CACHE_DIR,
    MODEL_IDS,
    RUNTIME_DIR,
    apply_runtime_env,
    ensure_runtime_dirs,
    model_local_dir,
)
from .constants import DEFAULT_CUSTOMVOICE_SPEAKERS

load_dotenv(dotenv_path=find_dotenv(usecwd=True), override=False)
apply_runtime_env()
ensure_runtime_dirs()

app = FastAPI(title="Webpage TTS Server", version="0.2.0")
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
_request_counter = 0
_download_lock = threading.Lock()
_mlx_infer_lock = threading.Lock()
_shutdown_event = threading.Event()
_startup_manifest_path = RUNTIME_DIR / "model_manifest.json"
_startup_state: Dict[str, object] = {
    "stage": "idle",
    "started_at": None,
    "finished_at": None,
    "current": None,
    "total": len(MODEL_IDS),
    "completed": 0,
    "errors": [],
}


def _set_startup_state(**kwargs: object) -> None:
    _startup_state.update(kwargs)


def request_shutdown() -> None:
    if not _shutdown_event.is_set():
        logger.warning("Server shutdown requested")
    _shutdown_event.set()


def _cleanup_runtime() -> None:
    model_count = len(_mlx_models)
    _mlx_models.clear()
    gc.collect()

    try:
        import mlx.core as mx

        if hasattr(mx, "clear_cache"):
            mx.clear_cache()
            logger.info("Cleared MLX cache")
        else:
            mx.metal.clear_cache()
            logger.info("Cleared MLX metal cache")
    except Exception as exc:
        logger.warning("Failed to clear MLX metal cache: {}", exc)

    logger.info("Cleared MLX model cache entries={}", model_count)


def shutdown_runtime(wait_for_inflight_sec: float = 30.0) -> None:
    request_shutdown()
    logger.info("Waiting for in-flight MLX synthesis (timeout={}s)", wait_for_inflight_sec)
    acquired = _mlx_infer_lock.acquire(timeout=max(0.0, wait_for_inflight_sec))
    if acquired:
        _mlx_infer_lock.release()
    else:
        logger.warning("Timed out waiting for in-flight MLX synthesis during shutdown")
    _cleanup_runtime()


def _wav_header_info(data: bytes) -> Dict[str, object]:
    if len(data) < 12:
        return {"ok": False, "reason": "too short", "bytes": len(data)}
    riff = data[0:4]
    wave = data[8:12]
    info = {
        "ok": riff == b"RIFF" and wave == b"WAVE",
        "riff": riff.decode("ascii", errors="ignore"),
        "wave": wave.decode("ascii", errors="ignore"),
        "bytes": len(data),
    }
    if len(data) < 44:
        return info
    fmt = data[12:16]
    info.update(
        {
            "fmt": fmt.decode("ascii", errors="ignore"),
            "fmt_size": struct.unpack("<I", data[16:20])[0],
            "audio_format": struct.unpack("<H", data[20:22])[0],
            "channels": struct.unpack("<H", data[22:24])[0],
            "sample_rate": struct.unpack("<I", data[24:28])[0],
            "byte_rate": struct.unpack("<I", data[28:32])[0],
            "block_align": struct.unpack("<H", data[32:34])[0],
            "bits_per_sample": struct.unpack("<H", data[34:36])[0],
            "data_tag": data[36:40].decode("ascii", errors="ignore"),
            "data_bytes": struct.unpack("<I", data[40:44])[0],
        }
    )
    return info


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


def _manifest_payload() -> Dict[str, object]:
    entries = {}
    for key, model_id in MODEL_IDS.items():
        entries[key] = {
            "model_id": model_id,
            "local_dir": str(model_local_dir(model_id)),
            "exists": model_local_dir(model_id).exists(),
        }
    return {
        "generated_at": int(time.time()),
        "models": entries,
    }


def _write_manifest() -> None:
    _startup_manifest_path.write_text(
        json.dumps(_manifest_payload(), indent=2),
        encoding="utf-8",
    )


def _download_model(model_key: str, model_id: str) -> Path:
    local_dir = model_local_dir(model_id)
    local_dir.mkdir(parents=True, exist_ok=True)

    has_required = all(
        [
            (local_dir / "config.json").exists(),
            (local_dir / "model.safetensors").exists(),
            (local_dir / "tokenizer_config.json").exists(),
            (local_dir / "speech_tokenizer" / "config.json").exists(),
            (local_dir / "speech_tokenizer" / "model.safetensors").exists(),
        ]
    )
    if has_required:
        logger.info("Model {} already present at {}", model_id, local_dir)
        return local_dir

    logger.info(
        "Downloading model {} ({}) to {}",
        model_key,
        model_id,
        local_dir,
    )
    start = time.time()
    snapshot_download(
        repo_id=model_id,
        local_dir=local_dir,
        cache_dir=HF_HUB_CACHE_DIR,
        allow_patterns=[
            "*.json",
            "*.safetensors",
            "*.py",
            "*.model",
            "*.tiktoken",
            "*.txt",
            "*.jsonl",
            "*.yaml",
            "*.wav",
            "*.pth",
            "*.npz",
            "*.bin",
            "*.md",
            "*tokenizer*",
            "speech_tokenizer/*",
            "speech_tokenizer/*.json",
            "speech_tokenizer/*.safetensors",
        ],
        max_workers=8,
    )

    has_required_after = all(
        [
            (local_dir / "config.json").exists(),
            (local_dir / "model.safetensors").exists(),
            (local_dir / "tokenizer_config.json").exists(),
            (local_dir / "speech_tokenizer" / "config.json").exists(),
            (local_dir / "speech_tokenizer" / "model.safetensors").exists(),
        ]
    )
    if not has_required_after:
        raise RuntimeError(f"Model download incomplete for {model_id}: {local_dir}")

    took = round(time.time() - start, 2)
    logger.info(
        "Downloaded model {} in {}s -> {}",
        model_id,
        took,
        local_dir,
    )
    return local_dir


def prefetch_all_models() -> None:
    with _download_lock:
        _set_startup_state(
            stage="downloading",
            started_at=int(time.time()),
            finished_at=None,
            current=None,
            total=len(MODEL_IDS),
            completed=0,
            errors=[],
        )
        try:
            completed = 0
            for model_key, model_id in MODEL_IDS.items():
                _set_startup_state(current={"key": model_key, "model_id": model_id})
                _download_model(model_key, model_id)
                completed += 1
                _set_startup_state(completed=completed)

            _write_manifest()
            _set_startup_state(
                stage="ready",
                finished_at=int(time.time()),
                current=None,
            )
            logger.info("All required models are ready")
        except Exception as exc:
            logger.exception("Model prefetch failed")
            _set_startup_state(
                stage="error",
                finished_at=int(time.time()),
                errors=[str(exc)],
            )
            raise


def _decode_b64_audio(b64_str: str) -> bytes:
    if b64_str.startswith("data:"):
        b64_str = b64_str.split(",", 1)[1]
    return base64.b64decode(b64_str)


def _resolve_model_id(req: TTSRequest) -> str:
    if req.mode in {"default", "custom"}:
        size = (req.custom_model_size or DEFAULT_CUSTOM_MODEL_SIZE).lower().strip()
        if size == "0.6b":
            return MODEL_IDS["custom_small"]
        if size == "1.7b":
            return MODEL_IDS["custom_large"]
        raise HTTPException(status_code=400, detail="custom_model_size must be 0.6b or 1.7b")

    if req.mode == "design":
        if not req.instruction:
            raise HTTPException(status_code=400, detail="instruction is required for voice design")
        return MODEL_IDS["design"]

    if not req.ref_audio_b64:
        raise HTTPException(status_code=400, detail="ref_audio_b64 is required for voice cloning")
    if not req.ref_text:
        raise HTTPException(status_code=400, detail="ref_text is required for voice cloning")
    return MODEL_IDS["clone"]


def _get_mlx_model(model_id: str):
    if model_id in _mlx_models:
        logger.info("MLX model cache hit: {}", model_id)
        return _mlx_models[model_id]

    from mlx_audio.tts.utils import load_model

    model_path = model_local_dir(model_id)
    if not model_path.exists():
        raise RuntimeError(f"Model path is missing: {model_path}")

    logger.info("Loading MLX model from {}", model_path)
    model = load_model(model_path)
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
    logger.info("MLX gen kwargs: {}", kwargs)
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
    logger.info(
        "MLX synth input: mode={} text_len={} text={} speaker={} instruction={} custom_model_size={} ref_text={} ref_audio_b64_len={}",
        req.mode,
        len(req.text),
        req.text,
        req.speaker,
        req.instruction,
        req.custom_model_size,
        req.ref_text,
        len(req.ref_audio_b64 or ""),
    )
    model_id = _resolve_model_id(req)
    model = _get_mlx_model(model_id)
    voice = req.speaker or DEFAULT_SPEAKER
    logger.info("MLX model selected: {} voice={}", model_id, voice)

    ref_audio = None
    ref_text = None
    if req.mode == "clone":
        ref_audio, _ = _read_ref_audio_mlx(model, req.ref_audio_b64 or "")
        ref_text = req.ref_text
        logger.info(
            "MLX clone reference loaded: ref_audio_samples={} ref_text_len={}",
            int(ref_audio.shape[0]) if ref_audio is not None else 0,
            len(ref_text or ""),
        )

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
    logger.info(
        "MLX generate call: model_id={} voice={} speed={} stream={} verbose={} has_ref_audio={} has_ref_text={} instruct={}",
        model_id,
        voice,
        gen_kwargs.get("speed"),
        gen_kwargs.get("stream"),
        gen_kwargs.get("verbose"),
        ref_audio is not None,
        bool(ref_text),
        req.instruction,
    )

    results = list(model.generate(**gen_kwargs))
    if not results:
        logger.error("MLX backend returned no audio")
        raise HTTPException(status_code=500, detail="MLX backend returned no audio")

    import mlx.core as mx

    audio = (
        mx.concatenate([r.audio for r in results], axis=0)
        if len(results) > 1
        else results[0].audio
    )
    audio_np = np.array(audio)
    sample_rate = results[0].sample_rate
    logger.info(
        "MLX synth complete: segments={} sample_rate={} dtype={}",
        len(results),
        sample_rate,
        audio_np.dtype,
    )
    _log_audio_stats(audio_np, sample_rate, "MLX")
    return audio_np, sample_rate


@app.on_event("shutdown")
def _on_shutdown() -> None:
    logger.info("FastAPI shutdown event received")
    shutdown_runtime()


@app.get("/health")
def health() -> Dict[str, object]:
    return {
        "status": "ok",
        "startup": _startup_state,
    }


@app.get("/startup-status")
def startup_status() -> Dict[str, object]:
    return _startup_state


@app.post("/prefetch")
def prefetch_now() -> Dict[str, object]:
    prefetch_all_models()
    return {"ok": True, "startup": _startup_state}


@app.get("/capabilities")
def capabilities() -> Dict[str, object]:
    return {
        "backend": "mlx",
        "modes": ["default", "custom", "design", "clone"],
        "default_speaker": DEFAULT_SPEAKER,
        "default_custom_model_size": DEFAULT_CUSTOM_MODEL_SIZE,
        "models": {
            key: {
                "model_id": model_id,
                "local_dir": str(model_local_dir(model_id)),
                "downloaded": model_local_dir(model_id).exists(),
            }
            for key, model_id in MODEL_IDS.items()
        },
    }


@app.get("/speakers")
def speakers() -> JSONResponse:
    return JSONResponse({"speakers": DEFAULT_CUSTOMVOICE_SPEAKERS})


@app.post("/tts")
def tts(req: TTSRequest) -> Response:
    global _request_counter
    _request_counter += 1
    req_id = _request_counter

    logger.info(
        "TTS request {}: backend={} mode={} text_len={} speaker={} instruction_len={} "
        "custom_model_size={} ref_audio={} ref_text={} speed={} temp={} top_p={} top_k={} max_new_tokens={}",
        req_id,
        req.backend,
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
    logger.info(
        "TTS request {} full payload: text={} instruction={} ref_text={} ref_audio_b64_len={}",
        req_id,
        req.text,
        req.instruction,
        req.ref_text,
        len(req.ref_audio_b64 or ""),
    )

    if req.backend != "mlx":
        raise HTTPException(status_code=400, detail="Only MLX backend is supported")

    if _shutdown_event.is_set():
        raise HTTPException(status_code=503, detail="Server is shutting down")

    lock_wait_started = time.time()
    with _mlx_infer_lock:
        wait_ms = int((time.time() - lock_wait_started) * 1000)
        if wait_ms > 0:
            logger.info("TTS request {} waited {}ms for MLX inference lock", req_id, wait_ms)
        audio, sr = _synthesize_mlx(req)

    buf = io.BytesIO()
    sf.write(buf, audio, sr, format="WAV", subtype="PCM_16")
    wav_bytes = buf.getvalue()

    logger.info(
        "TTS response {}: bytes={} sample_rate={} subtype=PCM_16 header={}",
        req_id,
        len(wav_bytes),
        sr,
        _wav_header_info(wav_bytes),
    )
    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={"X-Sample-Rate": str(sr)},
    )
