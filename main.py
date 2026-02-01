from __future__ import annotations

import os

import uvicorn

from tts_server.logging_utils import setup_logging


def main() -> None:
    os.environ.setdefault("HF_HUB_ENABLE_HF_TRANSFER", "1")
    os.environ.setdefault("HF_HUB_ENABLE_XET", "1")
    os.environ.setdefault("HF_HOME", os.path.expanduser("~/.cache/huggingface"))
    setup_logging()
    host = os.getenv("TTS_HOST", "127.0.0.1")
    port = int(os.getenv("TTS_PORT", "9872"))
    reload = os.getenv("TTS_RELOAD", "false").lower() in {"1", "true", "yes"}

    uvicorn.run(
        "tts_server.app:app",
        host=host,
        port=port,
        reload=reload,
        log_level=os.getenv("TTS_LOG_LEVEL", "info"),
        log_config=None,
    )


if __name__ == "__main__":
    main()
