from __future__ import annotations

import argparse
import io
import sys
import time

import numpy as np
import requests
from scipy.signal import resample_poly
import soundfile as sf
import webrtcvad


def _expect(cond: bool, message: str) -> None:
    if not cond:
        raise RuntimeError(message)


def _wait_startup_ready(server_url: str, timeout_sec: int) -> dict:
    deadline = time.time() + timeout_sec
    last = {}
    while time.time() < deadline:
        res = requests.get(f"{server_url}/startup-status", timeout=10)
        res.raise_for_status()
        last = res.json()
        stage = last.get("stage")
        if stage == "ready":
            return last
        if stage == "error":
            raise RuntimeError(f"startup-status error: {last}")
        time.sleep(1)
    raise RuntimeError(f"startup-status not ready after {timeout_sec}s: {last}")


def _vad_ratio(audio: np.ndarray, sample_rate: int) -> float:
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


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate local TTS server end-to-end")
    parser.add_argument("--server-url", default="http://127.0.0.1:9872")
    parser.add_argument("--timeout", type=int, default=60)
    parser.add_argument("--wait-ready-seconds", type=int, default=120)
    parser.add_argument("--text", default="Hello. This is a local TTS API test.")
    parser.add_argument("--min-rms", type=float, default=0.005)
    parser.add_argument("--min-vad-ratio", type=float, default=0.1)
    args = parser.parse_args()

    server_url = args.server_url.rstrip("/")

    health = requests.get(f"{server_url}/health", timeout=args.timeout)
    health.raise_for_status()
    health_payload = health.json()
    _expect(health_payload.get("status") == "ok", f"unexpected health payload: {health_payload}")
    print("[ok] /health")

    startup_payload = _wait_startup_ready(server_url, args.wait_ready_seconds)
    print(f"[ok] /startup-status stage={startup_payload.get('stage')}")

    caps = requests.get(f"{server_url}/capabilities", timeout=args.timeout)
    caps.raise_for_status()
    caps_payload = caps.json()
    _expect(caps_payload.get("backend") == "mlx", f"unexpected capabilities: {caps_payload}")
    print("[ok] /capabilities backend=mlx")

    tts_res = requests.post(
        f"{server_url}/tts",
        json={
            "backend": "mlx",
            "mode": "custom",
            "custom_model_size": "0.6b",
            "speaker": "Vivian",
            "text": args.text,
        },
        timeout=args.timeout,
    )
    tts_res.raise_for_status()

    wav_bytes = tts_res.content
    _expect(len(wav_bytes) > 44, f"audio response too small: {len(wav_bytes)} bytes")
    _expect(wav_bytes[:4] == b"RIFF", "audio is not WAV (missing RIFF)")

    audio, sample_rate = sf.read(io.BytesIO(wav_bytes), dtype="float32")
    _expect(sample_rate > 0, f"invalid sample rate: {sample_rate}")
    _expect(audio.size > 0, "decoded audio is empty")
    rms = float(np.sqrt(np.mean(np.square(audio)))) if audio.size else 0.0
    vad_ratio = _vad_ratio(audio, int(sample_rate))
    _expect(rms >= args.min_rms, f"audio rms too low: {rms:.8f} < {args.min_rms:.8f}")
    _expect(
        vad_ratio >= args.min_vad_ratio,
        f"audio voiced ratio too low: {vad_ratio:.4f} < {args.min_vad_ratio:.4f}",
    )

    print(
        f"[ok] /tts bytes={len(wav_bytes)} sample_rate={sample_rate} samples={audio.size} "
        f"rms={rms:.6f} vad_ratio={vad_ratio:.3f}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
