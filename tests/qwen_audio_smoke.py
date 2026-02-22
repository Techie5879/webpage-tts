from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf
from loguru import logger
from scipy.signal import resample_poly
import webrtcvad

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tts_server.config import MODEL_IDS, apply_runtime_env, ensure_runtime_dirs, model_local_dir


def _run_one(
    model_label: str,
    model_key: str,
    voice: str,
    text: str,
    out_dir: Path,
    min_rms: float,
    min_peak: float,
    min_duration_sec: float,
    min_vad_ratio: float,
) -> Path:
    from mlx_audio.tts.utils import load_model

    model_path = model_local_dir(MODEL_IDS[model_key])
    if not model_path.exists():
        raise RuntimeError(f"Missing model directory: {model_path}")

    logger.info("Loading {} model from {}", model_label, model_path)
    start = time.time()
    model = load_model(model_path)
    logger.info("Loaded {} model in {:.2f}s", model_label, time.time() - start)

    results = list(
        model.generate(
            text=text,
            voice=voice,
            lang_code="en",
            speed=1.0,
            stream=False,
            verbose=False,
        )
    )
    if not results:
        raise RuntimeError(f"{model_label}: model returned no audio")

    import mlx.core as mx

    audio = (
        mx.concatenate([chunk.audio for chunk in results], axis=0)
        if len(results) > 1
        else results[0].audio
    )
    audio_np = np.array(audio, dtype=np.float32)
    sample_rate = int(results[0].sample_rate)
    rms = float(np.sqrt(np.mean(np.square(audio_np)))) if audio_np.size else 0.0
    peak = float(np.max(np.abs(audio_np))) if audio_np.size else 0.0
    duration_sec = float(audio_np.shape[0] / sample_rate) if sample_rate > 0 else 0.0

    vad = webrtcvad.Vad(2)
    mono = audio_np.mean(axis=1) if audio_np.ndim > 1 else audio_np
    speech_16k = resample_poly(mono, 16000, sample_rate).astype(np.float32)
    speech_pcm = (np.clip(speech_16k, -1.0, 1.0) * 32767).astype(np.int16).tobytes()
    frame_bytes = 320
    total_frames = 0
    voiced_frames = 0
    for i in range(0, len(speech_pcm) - frame_bytes + 1, frame_bytes):
        total_frames += 1
        if vad.is_speech(speech_pcm[i : i + frame_bytes], 16000):
            voiced_frames += 1
    vad_ratio = float(voiced_frames / total_frames) if total_frames else 0.0

    if audio_np.size == 0:
        raise RuntimeError(f"{model_label}: empty audio")
    if duration_sec < min_duration_sec:
        raise RuntimeError(
            f"{model_label}: duration too short ({duration_sec:.3f}s < {min_duration_sec:.3f}s)"
        )
    if rms < min_rms:
        raise RuntimeError(f"{model_label}: audio RMS too low ({rms:.8f} < {min_rms:.8f})")
    if peak < min_peak:
        raise RuntimeError(f"{model_label}: audio peak too low ({peak:.8f} < {min_peak:.8f})")
    if vad_ratio < min_vad_ratio:
        raise RuntimeError(
            f"{model_label}: voiced ratio too low ({vad_ratio:.4f} < {min_vad_ratio:.4f})"
        )

    out_path = out_dir / f"qwen-{model_label}.wav"
    sf.write(out_path, audio_np, sample_rate, format="WAV", subtype="PCM_16")

    logger.info(
        "{} ok: sr={} samples={} duration={:.2f}s rms={:.6f} vad_ratio={:.3f} file={}",
        model_label,
        sample_rate,
        audio_np.shape[0],
        duration_sec,
        rms,
        vad_ratio,
        out_path,
    )
    return out_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Qwen3-TTS dual-size local smoke test")
    parser.add_argument("--text", default="Hello. This is a two-model local audio smoke test.")
    parser.add_argument("--voice", default="Vivian")
    parser.add_argument("--out-dir", default="runtime/audio_smoke")
    parser.add_argument("--min-rms", type=float, default=0.005)
    parser.add_argument("--min-peak", type=float, default=0.05)
    parser.add_argument("--min-duration-sec", type=float, default=1.0)
    parser.add_argument("--min-vad-ratio", type=float, default=0.1)
    args = parser.parse_args()

    apply_runtime_env()
    ensure_runtime_dirs()

    out_dir = ROOT / args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    results: list[Path] = []
    failures: list[str] = []

    matrix = [
        ("0.6b", "custom_small"),
        ("1.7b", "custom_large"),
    ]

    for model_label, model_key in matrix:
        try:
            out_path = _run_one(
                model_label,
                model_key,
                args.voice,
                args.text,
                out_dir,
                args.min_rms,
                args.min_peak,
                args.min_duration_sec,
                args.min_vad_ratio,
            )
            results.append(out_path)
        except Exception as exc:
            failures.append(f"{model_label}: {exc}")
            logger.error("{}", failures[-1])

    for path in results:
        print(str(path))

    if failures:
        print("FAILURES:")
        for item in failures:
            print(item)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
