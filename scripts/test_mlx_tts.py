from __future__ import annotations

import argparse
import os
import signal
import time

import numpy as np
from loguru import logger


class TimeoutError(Exception):
    pass


def _alarm_handler(_signum, _frame):
    raise TimeoutError("Test exceeded timeout")


def main() -> None:
    parser = argparse.ArgumentParser(description="Loop until MLX TTS succeeds.")
    parser.add_argument(
        "--model",
        type=str,
        default=os.getenv(
            "MLX_CUSTOM_VOICE_MODEL",
            "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit",
        ),
        help="MLX model path or repo id.",
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
            if getattr(model, "tokenizer", None) is not None:
                from transformers import AutoTokenizer

                tokenizer_name = getattr(
                    getattr(model, "config", None), "tokenizer_name", None
                )
                if tokenizer_name:
                    model.tokenizer = AutoTokenizer.from_pretrained(
                        tokenizer_name, fix_mistral_regex=True
                    )
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
