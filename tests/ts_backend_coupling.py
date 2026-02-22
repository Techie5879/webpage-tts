from __future__ import annotations

import argparse
import io
import sys

import numpy as np
import requests
from scipy.signal import resample_poly
import soundfile as sf
import webrtcvad


def normalize_text(text: str) -> str:
    return " ".join(text.split()).strip()


def chunk_text(text: str, max_len: int) -> list[str]:
    cleaned = normalize_text(text)
    if not cleaned:
        return []
    if len(cleaned) <= max_len:
        return [cleaned]

    chunks: list[str] = []
    start = 0
    while start < len(cleaned):
        end = min(start + max_len, len(cleaned))
        piece = cleaned[start:end]

        split_at = -1
        for punct in [". ", "! ", "? "]:
            idx = piece.rfind(punct)
            if idx > split_at:
                split_at = idx

        if split_at > 0 and end < len(cleaned):
            end = start + split_at + 1
        elif end < len(cleaned):
            last_space = piece.rfind(" ")
            if last_space > 0:
                end = start + last_space

        chunk = cleaned[start:end].strip()
        if chunk:
            chunks.append(chunk)
        start = end
    return chunks


def decode_wav(audio_bytes: bytes) -> tuple[np.ndarray, int]:
    audio, sr = sf.read(io.BytesIO(audio_bytes), dtype="float32")
    if audio.ndim > 1:
        audio = np.mean(audio, axis=1)
    return audio, sr


def vad_ratio(audio: np.ndarray, sample_rate: int) -> float:
    if audio.size == 0 or sample_rate <= 0:
        return 0.0
    vad = webrtcvad.Vad(2)
    mono = audio.mean(axis=1) if audio.ndim > 1 else audio
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


def require(cond: bool, msg: str) -> None:
    if not cond:
        raise RuntimeError(msg)


def main() -> int:
    parser = argparse.ArgumentParser(description="TS chunking + Python backend coupling test")
    parser.add_argument("--server-url", default="http://127.0.0.1:9872")
    parser.add_argument("--chunk-size", type=int, default=420)
    parser.add_argument(
        "--text",
        default=(
            "This is a coupling test between the extension chunking flow and the Python TTS backend. "
            "It validates that both 0.6b and 1.7b model-size payloads return audible wav audio."
        ),
    )
    parser.add_argument("--speaker", default="Vivian")
    parser.add_argument("--min-rms", type=float, default=0.005)
    parser.add_argument("--min-vad-ratio", type=float, default=0.1)
    parser.add_argument("--timeout", type=int, default=180)
    args = parser.parse_args()

    health = requests.get(f"{args.server_url}/health", timeout=args.timeout)
    health.raise_for_status()
    print("[coupling] health", health.json())

    chunks = chunk_text(args.text, args.chunk_size)
    require(bool(chunks), "chunking produced no chunks")
    print("[coupling] chunks", {"count": len(chunks), "chunks": chunks})

    for model_size in ["0.6b", "1.7b"]:
        print("[coupling] model_size start", model_size)
        for idx, chunk in enumerate(chunks, start=1):
            payload = {
                "backend": "mlx",
                "mode": "custom",
                "custom_model_size": model_size,
                "speaker": args.speaker,
                "text": chunk,
                "instruction": None,
                "ref_audio_b64": None,
                "ref_text": None,
            }
            print("[coupling] payload", {
                "model_size": model_size,
                "chunk_index": idx,
                "chunk_total": len(chunks),
                "payload": payload,
            })
            res = requests.post(
                f"{args.server_url}/tts",
                json=payload,
                timeout=args.timeout,
            )
            require(res.ok, f"tts failed ({res.status_code}): {res.text}")
            require(
                (res.headers.get("content-type") or "").startswith("audio/wav"),
                f"unexpected content-type: {res.headers.get('content-type')}",
            )
            audio, sr = decode_wav(res.content)
            rms = float(np.sqrt(np.mean(np.square(audio)))) if audio.size else 0.0
            voice_ratio = vad_ratio(audio, int(sr))
            print("[coupling] response", {
                "model_size": model_size,
                "chunk_index": idx,
                "bytes": len(res.content),
                "sample_rate": sr,
                "samples": int(audio.size),
                "rms": rms,
                "vad_ratio": voice_ratio,
            })
            require(audio.size > 0, "audio is empty")
            require(rms >= args.min_rms, f"audio rms too low: {rms:.8f}")
            require(
                voice_ratio >= args.min_vad_ratio,
                f"audio voiced ratio too low: {voice_ratio:.4f} < {args.min_vad_ratio:.4f}",
            )

    print("[coupling] ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
