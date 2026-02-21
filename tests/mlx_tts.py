from __future__ import annotations

import argparse
import os
import signal
import sys
import time
from pathlib import Path

import numpy as np
from loguru import logger

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tts_server.config import MODEL_IDS, apply_runtime_env, ensure_runtime_dirs, model_local_dir


class TimeoutError(Exception):
    pass


def _alarm_handler(_signum, _frame):
    raise TimeoutError("Test exceeded timeout")


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

            from mlx_audio.tts.utils import load_model

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

            import mlx.core as mx

            audio = (
                mx.concatenate([r.audio for r in results], axis=0)
                if len(results) > 1
                else results[0].audio
            )
            audio_np = np.array(audio, dtype=np.float32)
            rms = float(np.sqrt(np.mean(np.square(audio_np)))) if audio_np.size else 0.0
            logger.info(
                "MLX test ok: attempt={} sr={} samples={} rms={:.6f}",
                attempt,
                results[0].sample_rate,
                audio_np.shape[0],
                rms,
            )
            if audio_np.size == 0 or rms < 1e-4:
                raise RuntimeError("Audio output too small")
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
