#!/usr/bin/env python3
"""Simulate the Chrome extension TTS flow against the local server."""

from __future__ import annotations

import argparse
import html
import io
import sys
import time
from html.parser import HTMLParser
from typing import List, Optional, Tuple

import numpy as np
import requests
import soundfile as sf

try:
    import sounddevice as sd
except Exception:  # pragma: no cover - optional playback dependency
    sd = None


class TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._parts: List[str] = []
        self._skip_depth = 0
        self._skip_tags = {"script", "style", "noscript", "svg", "canvas"}
        self._block_tags = {
            "p",
            "br",
            "div",
            "li",
            "section",
            "article",
            "header",
            "footer",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
        }

    def handle_starttag(self, tag: str, attrs) -> None:  # type: ignore[override]
        if tag in self._skip_tags:
            self._skip_depth += 1
            return
        if tag in self._block_tags:
            self._parts.append("\n")

    def handle_endtag(self, tag: str) -> None:  # type: ignore[override]
        if tag in self._skip_tags and self._skip_depth > 0:
            self._skip_depth -= 1
            return
        if tag in self._block_tags:
            self._parts.append("\n")

    def handle_data(self, data: str) -> None:  # type: ignore[override]
        if self._skip_depth > 0:
            return
        if data:
            self._parts.append(data)

    def text(self) -> str:
        combined = " ".join(self._parts)
        combined = html.unescape(combined)
        return combined


def normalize_text(text: str) -> str:
    return " ".join(text.split()).strip()


def chunk_text(text: str, max_len: int) -> List[str]:
    cleaned = normalize_text(text)
    if not cleaned:
        return []
    if len(cleaned) <= max_len:
        return [cleaned]

    chunks: List[str] = []
    start = 0
    while start < len(cleaned):
        end = min(start + max_len, len(cleaned))
        slice_ = cleaned[start:end]

        split_at = -1
        for punct in [". ", "! ", "? "]:
            idx = slice_.rfind(punct)
            if idx > split_at:
                split_at = idx

        if split_at > 0 and end < len(cleaned):
            end = start + split_at + 1
        elif end < len(cleaned):
            last_space = slice_.rfind(" ")
            if last_space > 0:
                end = start + last_space

        chunk = cleaned[start:end].strip()
        if chunk:
            chunks.append(chunk)
        start = end
    return chunks


def fetch_page_text(url: str, timeout: int) -> str:
    resp = requests.get(url, timeout=timeout)
    resp.raise_for_status()
    parser = TextExtractor()
    parser.feed(resp.text)
    parser.close()
    return parser.text()


def decode_wav(audio_bytes: bytes) -> Tuple[np.ndarray, int]:
    audio, sr = sf.read(io.BytesIO(audio_bytes), dtype="float32")
    if audio.ndim > 1:
        audio = np.mean(audio, axis=1)
    return audio, sr


def play_audio(audio: np.ndarray, sr: int) -> None:
    if sd is None:
        raise RuntimeError("sounddevice is not available for playback")
    sd.play(audio, sr, blocking=True)


def build_payload(
    text: str,
    mode: str,
    custom_model_size: Optional[str],
    speaker: Optional[str],
    instruction: Optional[str],
    ref_audio_b64: Optional[str],
    ref_text: Optional[str],
) -> dict:
    payload = {
        "mode": mode,
        "text": text,
        "custom_model_size": custom_model_size,
        "speaker": speaker,
        "instruction": instruction,
        "ref_audio_b64": ref_audio_b64,
        "ref_text": ref_text,
    }
    return payload


def run_attempt(args) -> None:
    if args.selection:
        raw_text = args.selection
    else:
        raw_text = fetch_page_text(args.url, args.timeout)

    chunks = chunk_text(raw_text, args.chunk_size)
    if not chunks:
        raise RuntimeError("No text extracted from the page")

    if args.max_chunks and args.max_chunks > 0:
        chunks = chunks[: args.max_chunks]

    print(f"[test] chunks {len(chunks)}")

    for idx, chunk in enumerate(chunks, start=1):
        payload = build_payload(
            text=chunk,
            mode=args.mode,
            custom_model_size=args.custom_model_size,
            speaker=args.speaker,
            instruction=args.instruction,
            ref_audio_b64=args.ref_audio_b64,
            ref_text=args.ref_text,
        )

        print(
            "[test] sending TTS",
            {
                "serverUrl": args.server_url,
                "mode": payload["mode"],
                "textLen": len(payload["text"]),
                "speaker": payload["speaker"],
                "instructionLen": len(payload["instruction"] or ""),
                "customModelSize": payload["custom_model_size"],
                "hasRefAudio": bool(payload["ref_audio_b64"]),
                "hasRefText": bool(payload["ref_text"]),
            },
        )

        res = requests.post(
            f"{args.server_url}/tts",
            json=payload,
            timeout=args.timeout,
        )
        if not res.ok:
            raise RuntimeError(f"TTS error {res.status_code}: {res.text}")

        audio_bytes = res.content
        print(f"[test] received audio bytes {len(audio_bytes)}")
        audio, sr = decode_wav(audio_bytes)
        print(f"[test] decoded audio chunk {idx}/{len(chunks)} sr={sr} samples={audio.shape[0]}")

        if args.play:
            play_audio(audio, sr)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--url",
        default="https://steipete.me/posts/2025/shipping-at-inference-speed",
        help="URL to fetch when no selection text is provided",
    )
    parser.add_argument(
        "--selection",
        default="",
        help="Optional selection text to read instead of fetching a page",
    )
    parser.add_argument(
        "--server-url",
        default="http://127.0.0.1:9872",
        help="Server base URL",
    )
    parser.add_argument("--mode", default="default", help="TTS mode")
    parser.add_argument(
        "--custom-model-size",
        default="0.6b",
        help="CustomVoice model size",
    )
    parser.add_argument("--speaker", default=None, help="Custom speaker name")
    parser.add_argument("--instruction", default=None, help="Style instruction")
    parser.add_argument("--ref-audio-b64", default=None, help="Reference audio (base64)")
    parser.add_argument("--ref-text", default=None, help="Reference text")
    parser.add_argument("--chunk-size", type=int, default=420, help="Chunk size")
    parser.add_argument(
        "--max-chunks",
        type=int,
        default=0,
        help="Limit the number of chunks per attempt (0 = no limit)",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=120,
        help="Network timeout in seconds",
    )
    parser.add_argument(
        "--sleep-seconds",
        type=int,
        default=3,
        help="Delay between attempts",
    )
    parser.add_argument(
        "--max-attempts",
        type=int,
        default=1,
        help="Number of attempts to run before exiting",
    )
    parser.add_argument(
        "--no-play",
        dest="play",
        action="store_false",
        help="Do not play audio, only verify decode",
    )
    parser.set_defaults(play=True)

    args = parser.parse_args()

    total_attempts = max(args.max_attempts, 1)
    for attempt in range(1, total_attempts + 1):
        print(f"[test] attempt {attempt}")
        try:
            run_attempt(args)
            print("[test] success")
            return 0
        except Exception as exc:
            print(f"[test] failed: {exc}")
            if attempt >= total_attempts:
                return 1
            time.sleep(max(args.sleep_seconds, 1))


if __name__ == "__main__":
    sys.exit(main())
