from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf
from loguru import logger

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tts_server.config import MODEL_IDS, apply_runtime_env, ensure_runtime_dirs, model_local_dir


def _run_one(model_label: str, model_key: str, voice: str, text: str, out_dir: Path) -> Path:
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

    if audio_np.size == 0:
        raise RuntimeError(f"{model_label}: empty audio")
    if rms < 1e-4:
        raise RuntimeError(f"{model_label}: audio RMS too low ({rms:.8f})")

    out_path = out_dir / f"qwen-{model_label}.wav"
    sf.write(out_path, audio_np, sample_rate, format="WAV", subtype="PCM_16")

    logger.info(
        "{} ok: sr={} samples={} duration={:.2f}s rms={:.6f} file={}",
        model_label,
        sample_rate,
        audio_np.shape[0],
        audio_np.shape[0] / sample_rate,
        rms,
        out_path,
    )
    return out_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Qwen3-TTS dual-size local smoke test")
    parser.add_argument("--text", default="Hello. This is a two-model local audio smoke test.")
    parser.add_argument("--voice", default="Vivian")
    parser.add_argument("--out-dir", default="runtime/audio_smoke")
    args = parser.parse_args()

    apply_runtime_env()
    ensure_runtime_dirs()

    out_dir = ROOT / args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    out_small = _run_one("0.6b", "custom_small", args.voice, args.text, out_dir)
    out_large = _run_one("1.7b", "custom_large", args.voice, args.text, out_dir)

    print(str(out_small))
    print(str(out_large))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
