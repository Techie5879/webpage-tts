from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
from typing import Optional

from loguru import logger

from .config import LOG_DIR


class InterceptHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        try:
            level = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno

        frame, depth = logging.currentframe(), 2
        while frame and frame.f_code.co_filename == logging.__file__:
            frame = frame.f_back
            depth += 1

        logger.opt(depth=depth, exception=record.exc_info).log(level, record.getMessage())


def setup_logging(level: Optional[str] = None) -> None:
    log_level = (level or os.getenv("TTS_LOG_LEVEL", "INFO")).upper()
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    service_log = Path(LOG_DIR) / "tts_server.log"
    error_log = Path(LOG_DIR) / "tts_server.error.log"

    logger.remove()
    logger.add(
        sys.stderr,
        level=log_level,
        colorize=True,
        backtrace=False,
        diagnose=False,
        format="<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | "
        "<level>{level: <8}</level> | "
        "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - "
        "<level>{message}</level>",
    )
    logger.add(
        service_log,
        level="DEBUG",
        rotation="20 MB",
        retention="14 days",
        enqueue=True,
        backtrace=False,
        diagnose=False,
        format="{time:YYYY-MM-DD HH:mm:ss.SSS} | {level: <8} | {name}:{function}:{line} | {message}",
    )
    logger.add(
        error_log,
        level="ERROR",
        rotation="20 MB",
        retention="30 days",
        enqueue=True,
        backtrace=True,
        diagnose=False,
        format="{time:YYYY-MM-DD HH:mm:ss.SSS} | {level: <8} | {name}:{function}:{line} | {message}",
    )

    logging.root.handlers = [InterceptHandler()]
    logging.root.setLevel("DEBUG")

    for name in ("uvicorn", "uvicorn.error", "uvicorn.access", "fastapi"):
        logging.getLogger(name).handlers = [InterceptHandler()]
        logging.getLogger(name).propagate = False
