from __future__ import annotations

import argparse
import os
import signal
import sys
import time
from pathlib import Path

import mlx.core as mx
import numpy as np
from mlx_audio.tts.utils import load_model
from scipy.signal import resample_poly
import webrtcvad
from loguru import logger

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tts_server.config import MODEL_IDS, apply_runtime_env, ensure_runtime_dirs, model_local_dir


class TimeoutError(Exception):
    pass


def _alarm_handler(_signum, _frame):
    raise TimeoutError("Test exceeded timeout")


def _vad_ratio(audio_np: np.ndarray, sample_rate: int) -> float:
    if audio_np.size == 0 or sample_rate <= 0:
        return 0.0
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
    return float(voiced_frames / total_frames) if total_frames else 0.0


def main() -> None:
    apply_runtime_env()
    ensure_runtime_dirs()
    default_model_path = str(model_local_dir(MODEL_IDS["custom_small"]))

    parser = argparse.ArgumentParser(description="Loop until MLX TTS succeeds.")
    parser.add_argument(
        "--model",
        type=str,
        default=os.getenv("MLX_CUSTOM_VOICE_MODEL", default_model_path),
        help="MLX model local path.",
    )
    parser.add_argument(
        "--voice",
        type=str,
        default=os.getenv("TTS_DEFAULT_SPEAKER", "Vivian"),
        help="Speaker/voice name.",
    )
    parser.add_argument(
        "--text",
        type=str,
        default="Hello. This is a short MLX test.",
        help="Text to synthesize.",
    )
    parser.add_argument("--max-tokens", type=int, default=128)
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--min-rms", type=float, default=0.005)
    parser.add_argument("--min-vad-ratio", type=float, default=0.1)
    parser.add_argument("--interval", type=float, default=2.0)
    parser.add_argument("--max-attempts", type=int, default=0)
    parser.add_argument(
        "--timeout",
        type=int,
        default=120,
        help="Hard timeout in seconds for each attempt.",
    )
    args = parser.parse_args()

    signal.signal(signal.SIGALRM, _alarm_handler)

    attempt = 0
    while True:
        attempt += 1
        try:
            if args.timeout > 0:
                signal.alarm(args.timeout)

            model = load_model(args.model)
            results = list(
                model.generate(
                    text=args.text,
                    voice=args.voice,
                    lang_code="en",
                    speed=args.speed,
                    temperature=0.6,
                    top_p=0.8,
                    max_tokens=args.max_tokens,
                    stream=False,
                    verbose=False,
                )
            )
            if not results:
                raise RuntimeError("MLX returned no audio")

            audio = (
                mx.concatenate([r.audio for r in results], axis=0)
                if len(results) > 1
                else results[0].audio
            )
            audio_np = np.array(audio, dtype=np.float32)
            rms = float(np.sqrt(np.mean(np.square(audio_np)))) if audio_np.size else 0.0
            vad_ratio = _vad_ratio(audio_np, int(results[0].sample_rate))
            logger.info(
                "MLX test ok: attempt={} sr={} samples={} rms={:.6f} vad_ratio={:.3f}",
                attempt,
                results[0].sample_rate,
                audio_np.shape[0],
                rms,
                vad_ratio,
            )
            if audio_np.size == 0:
                raise RuntimeError("Audio output is empty")
            if rms < args.min_rms:
                raise RuntimeError(f"Audio RMS too low: {rms:.8f} < {args.min_rms:.8f}")
            if vad_ratio < args.min_vad_ratio:
                raise RuntimeError(
                    f"Audio voiced ratio too low: {vad_ratio:.4f} < {args.min_vad_ratio:.4f}"
                )
            break
        except TimeoutError as exc:
            logger.error("MLX test timed out on attempt {}: {}", attempt, exc)
            raise SystemExit(1)
        except Exception as exc:
            logger.error("MLX test failed on attempt {}: {}", attempt, exc)
            if args.max_attempts and attempt >= args.max_attempts:
                raise SystemExit(1)
            time.sleep(args.interval)
        finally:
            signal.alarm(0)


if __name__ == "__main__":
    main()
