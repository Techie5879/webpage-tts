from __future__ import annotations

import argparse
import io
import os
import signal
import socket
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import requests
from scipy.signal import resample_poly
import soundfile as sf
import webrtcvad

ROOT = Path(__file__).resolve().parents[1]


def find_open_port(start: int) -> int:
    port = start
    while port < start + 200:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                port += 1
                continue
        return port
    raise RuntimeError(f"No open port found near {start}")


def wait_for_health(server_url: str, timeout_sec: int) -> None:
    deadline = time.time() + timeout_sec
    last_err: str | None = None
    while time.time() < deadline:
        try:
            res = requests.get(f"{server_url}/health", timeout=5)
            if res.ok:
                return
            last_err = f"health returned {res.status_code}"
        except Exception as exc:
            last_err = str(exc)
        time.sleep(0.5)
    raise RuntimeError(f"Server did not become healthy: {last_err}")


def wav_metrics(wav_bytes: bytes) -> tuple[int, int, float, float]:
    audio, sample_rate = sf.read(io.BytesIO(wav_bytes), dtype="float32")
    if audio.ndim > 1:
        audio = np.mean(audio, axis=1)
    rms = float(np.sqrt(np.mean(np.square(audio)))) if audio.size else 0.0

    vad = webrtcvad.Vad(2)
    speech_16k = resample_poly(audio, 16000, sample_rate).astype(np.float32)
    speech_pcm = (np.clip(speech_16k, -1.0, 1.0) * 32767).astype(np.int16).tobytes()
    frame_bytes = 320
    total_frames = 0
    voiced_frames = 0
    for i in range(0, len(speech_pcm) - frame_bytes + 1, frame_bytes):
        total_frames += 1
        if vad.is_speech(speech_pcm[i : i + frame_bytes], 16000):
            voiced_frames += 1
    vad_ratio = float(voiced_frames / total_frames) if total_frames else 0.0
    return int(audio.size), int(sample_rate), rms, vad_ratio


def start_server(port: int) -> tuple[subprocess.Popen[str], list[str], threading.Thread]:
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"

    cmd = [sys.executable, "main.py", "serve", "--port", str(port)]
    proc = subprocess.Popen(
        cmd,
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    if proc.stdout is None:
        raise RuntimeError("Failed to capture server stdout")

    logs: list[str] = []

    def _reader() -> None:
        for line in proc.stdout:
            line = line.rstrip("\n")
            logs.append(line)
            print(f"[server:{port}] {line}")

    thread = threading.Thread(target=_reader, daemon=True)
    thread.start()
    return proc, logs, thread


def stop_server(proc: subprocess.Popen[str], timeout_sec: int = 45) -> int:
    if proc.poll() is None:
        os.kill(proc.pid, signal.SIGINT)
    try:
        return proc.wait(timeout=timeout_sec)
    except subprocess.TimeoutExpired:
        proc.kill()
        return proc.wait(timeout=15)


def assert_log_contains(logs: list[str], needle: str) -> None:
    if not any(needle in line for line in logs):
        raise RuntimeError(f"Missing expected log line containing: {needle}")


def assert_log_absent(logs: list[str], needle: str) -> None:
    if any(needle in line for line in logs):
        raise RuntimeError(f"Unexpected log line containing: {needle}")


def run_concurrency_case(
    server_url: str,
    concurrency: int,
    timeout_sec: int,
    min_rms: float,
    min_vad_ratio: float,
) -> None:
    payload = {
        "backend": "mlx",
        "mode": "custom",
        "custom_model_size": "0.6b",
        "speaker": "Vivian",
        "text": "Concurrent synthesis regression check for MLX lock correctness.",
    }

    def _send(idx: int) -> tuple[int, int, int, int, float, float]:
        started = time.time()
        res = requests.post(f"{server_url}/tts", json=payload, timeout=timeout_sec)
        elapsed_ms = int((time.time() - started) * 1000)
        if not res.ok:
            raise RuntimeError(f"request {idx} failed: {res.status_code} {res.text}")
        samples, sample_rate, rms, vad_ratio = wav_metrics(res.content)
        if samples <= 0:
            raise RuntimeError(f"request {idx} produced empty audio")
        if rms < min_rms:
            raise RuntimeError(f"request {idx} rms too low: {rms:.8f}")
        if vad_ratio < min_vad_ratio:
            raise RuntimeError(f"request {idx} vad ratio too low: {vad_ratio:.4f}")
        return idx, res.status_code, len(res.content), elapsed_ms, rms, vad_ratio

    out: list[tuple[int, int, int, int, float, float]] = []
    with ThreadPoolExecutor(max_workers=concurrency) as ex:
        futures = [ex.submit(_send, i + 1) for i in range(concurrency)]
        for fut in as_completed(futures):
            out.append(fut.result())

    for row in sorted(out):
        print(
            "[concurrency]",
            {
                "request": row[0],
                "status": row[1],
                "bytes": row[2],
                "elapsed_ms": row[3],
                "rms": round(row[4], 6),
                "vad_ratio": round(row[5], 3),
            },
        )


def run_signal_during_inflight_case(
    server_url: str,
    timeout_sec: int,
    min_rms: float,
    min_vad_ratio: float,
) -> None:
    payload = {
        "backend": "mlx",
        "mode": "custom",
        "custom_model_size": "1.7b",
        "speaker": "Vivian",
        "text": (
            "Signal handling regression test with an in-flight request. "
            "This prompt is intentionally a bit longer to keep generation active while shutdown begins."
        ),
    }

    result: dict[str, object] = {}

    def _request() -> None:
        try:
            res = requests.post(f"{server_url}/tts", json=payload, timeout=timeout_sec)
            result["status"] = res.status_code
            result["body"] = res.text if res.status_code != 200 else ""
            if res.status_code == 200:
                samples, sample_rate, rms, vad_ratio = wav_metrics(res.content)
                result["samples"] = samples
                result["sample_rate"] = sample_rate
                result["rms"] = rms
                result["vad_ratio"] = vad_ratio
        except Exception as exc:
            result["error"] = str(exc)

    thread = threading.Thread(target=_request)
    thread.start()
    time.sleep(0.35)
    # SIGINT is sent by the caller through stop_server().
    thread.join(timeout=timeout_sec)

    if "error" in result:
        raise RuntimeError(f"in-flight request errored during shutdown: {result['error']}")
    if "status" not in result:
        raise RuntimeError("in-flight request did not complete")

    status = int(result["status"])
    if status == 200:
        rms = float(result.get("rms", 0.0))
        vad_ratio = float(result.get("vad_ratio", 0.0))
        if rms < min_rms:
            raise RuntimeError(f"in-flight request rms too low: {rms:.8f}")
        if vad_ratio < min_vad_ratio:
            raise RuntimeError(f"in-flight request vad ratio too low: {vad_ratio:.4f}")
    elif status != 503:
        raise RuntimeError(f"unexpected in-flight shutdown status: {status} {result.get('body', '')}")

    print("[signal-inflight]", result)


def main() -> int:
    parser = argparse.ArgumentParser(description="Runtime regression test for MLX server locking and shutdown")
    parser.add_argument("--base-port", type=int, default=9990)
    parser.add_argument("--concurrency", type=int, default=3)
    parser.add_argument("--timeout", type=int, default=240)
    parser.add_argument("--min-rms", type=float, default=0.005)
    parser.add_argument("--min-vad-ratio", type=float, default=0.1)
    args = parser.parse_args()

    # Case 1: concurrency stress + graceful shutdown
    port1 = find_open_port(args.base_port)
    proc1, logs1, _thread1 = start_server(port1)
    server_url_1 = f"http://127.0.0.1:{port1}"
    wait_for_health(server_url_1, timeout_sec=120)
    run_concurrency_case(
        server_url_1,
        concurrency=args.concurrency,
        timeout_sec=args.timeout,
        min_rms=args.min_rms,
        min_vad_ratio=args.min_vad_ratio,
    )
    exit_code_1 = stop_server(proc1)
    print("[server-exit]", {"port": port1, "exit_code": exit_code_1})

    assert_log_contains(logs1, "MLX inference lock")
    assert_log_contains(logs1, "Server shutdown requested")
    assert_log_contains(logs1, "Cleared MLX cache")
    assert_log_absent(logs1, "failed assertion `A command encoder is already encoding")

    # Case 2: signal while request is in-flight
    port2 = find_open_port(port1 + 1)
    proc2, logs2, _thread2 = start_server(port2)
    server_url_2 = f"http://127.0.0.1:{port2}"
    wait_for_health(server_url_2, timeout_sec=120)

    inflight_thread = threading.Thread(
        target=run_signal_during_inflight_case,
        kwargs={
            "server_url": server_url_2,
            "timeout_sec": args.timeout,
            "min_rms": args.min_rms,
            "min_vad_ratio": args.min_vad_ratio,
        },
    )
    inflight_thread.start()
    time.sleep(0.4)
    exit_code_2 = stop_server(proc2)
    inflight_thread.join(timeout=args.timeout)
    if inflight_thread.is_alive():
        raise RuntimeError("in-flight signal test thread did not finish")

    print("[server-exit]", {"port": port2, "exit_code": exit_code_2})

    assert_log_contains(logs2, "Waiting for in-flight MLX synthesis")
    assert_log_contains(logs2, "Server shutdown requested")
    assert_log_contains(logs2, "Cleared MLX cache")
    assert_log_absent(logs2, "failed assertion `A command encoder is already encoding")

    print("[runtime-regression] ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
