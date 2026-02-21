from __future__ import annotations

import argparse
import platform
from typing import NoReturn

import uvicorn
from dotenv import find_dotenv, load_dotenv
from loguru import logger


def _load_repo_dotenv() -> str | None:
    dotenv_path = find_dotenv(usecwd=True)
    if dotenv_path:
        load_dotenv(dotenv_path=dotenv_path, override=False)
        return dotenv_path
    return None


def _parse_args(default_host: str, default_port: int) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Webpage TTS local MLX server")
    subparsers = parser.add_subparsers(dest="command", required=True)

    serve = subparsers.add_parser("serve", help="Prefetch models and start API server")
    serve.add_argument("--host", default=default_host)
    serve.add_argument("--port", type=int, default=default_port)
    serve.add_argument("--reload", action="store_true")

    subparsers.add_parser("prefetch", help="Download all required MLX models")
    subparsers.add_parser("doctor", help="Check local Apple Silicon + MLX runtime")
    return parser.parse_args()


def _run_doctor(model_ids, models_dir, hf_home_dir, log_dir) -> int:
    logger.info("Doctor checks starting")
    logger.info("Platform: {} {}", platform.system(), platform.machine())
    logger.info("Models dir: {}", models_dir)
    logger.info("HF home: {}", hf_home_dir)
    logger.info("Log dir: {}", log_dir)
    for key, model_id in model_ids.items():
        logger.info("Model {} -> {}", key, model_id)

    if platform.system().lower() != "darwin" or platform.machine().lower() != "arm64":
        logger.error("This server targets Apple Silicon macOS only")
        return 1

    try:
        import mlx.core as mx

        logger.info("MLX default device: {}", mx.default_device())
    except Exception as exc:
        logger.exception("MLX import/device check failed: {}", exc)
        return 1

    logger.info("Doctor checks passed")
    return 0


def _run_serve(host: str, port: int, reload: bool) -> NoReturn:
    from tts_server.app import prefetch_all_models

    logger.info("Prefetching all required models before server start")
    prefetch_all_models()
    logger.info("Starting uvicorn on {}:{}", host, port)
    uvicorn.run(
        "tts_server.app:app",
        host=host,
        port=port,
        reload=reload,
        log_level="info",
        log_config=None,
    )
    raise SystemExit(0)


def main() -> None:
    dotenv_path = _load_repo_dotenv()

    from tts_server.config import (
        DEFAULT_HOST,
        DEFAULT_PORT,
        HF_HOME_DIR,
        LOG_DIR,
        MODELS_DIR,
        MODEL_IDS,
        apply_runtime_env,
        ensure_runtime_dirs,
    )
    from tts_server.logging_utils import setup_logging

    apply_runtime_env()
    ensure_runtime_dirs()
    setup_logging()

    if dotenv_path:
        logger.info("Loaded .env from {}", dotenv_path)
    else:
        logger.warning("No .env found from current working directory")

    args = _parse_args(DEFAULT_HOST, DEFAULT_PORT)

    if args.command == "doctor":
        raise SystemExit(_run_doctor(MODEL_IDS, MODELS_DIR, HF_HOME_DIR, LOG_DIR))

    if args.command == "prefetch":
        from tts_server.app import prefetch_all_models

        prefetch_all_models()
        logger.info("Prefetch complete")
        return

    if args.command == "serve":
        _run_serve(args.host, args.port, args.reload)

    raise SystemExit(2)


if __name__ == "__main__":
    main()
