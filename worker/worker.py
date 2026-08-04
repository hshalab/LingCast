import json
import logging
import os
import shutil
import time
from pathlib import Path

import redis

from ai.base import TaskInputs
from ai.factory import create_pipeline
from callback import TaskCallback
from storage import S3Storage

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("worker")

WORKER_DIR = Path(__file__).resolve().parent

REQUIRED_ENV = ["S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET"]


def _load_local_env(env_file: Path | None = None) -> None:
    """Load worker/.env.local if present.

    Values already set in the real environment always win, so docker-compose
    and exported vars are never overwritten.
    """
    env_file = env_file or WORKER_DIR / ".env.local"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip("\"'")
        if key and key not in os.environ:
            os.environ[key] = value


def _check_required_env() -> None:
    missing = [k for k in REQUIRED_ENV if not os.environ.get(k)]
    if not missing:
        return
    print(
        "Missing required environment variables: " + ", ".join(missing) + "\n"
        "The worker loads worker/.env.local automatically on startup.\n"
        "Create it once with:\n"
        "  cd worker && cp .env.local.example .env.local\n"
        "Existing environment variables take precedence over .env.local."
    )
    raise SystemExit(1)


def load_config() -> dict:
    # Hybrid deployment: REDIS_URL (host worker) overrides REDIS_ADDR (docker).
    addr = os.environ.get("REDIS_URL") or os.environ.get("REDIS_ADDR", "redis:6379")
    host, _, port = addr.partition(":")
    return {
        "redis_host": host,
        "redis_port": int(port or 6379),
        "redis_password": os.environ.get("REDIS_PASSWORD", ""),
        "redis_db": int(os.environ.get("REDIS_DB", "0")),
        "queue_key": os.environ.get("TASK_QUEUE_KEY", "talking_avatar:tasks"),
        "api_base_url": os.environ.get("API_BASE_URL", "http://api:8080"),
        "work_root": Path(os.environ.get("WORK_DIR", "/tmp/talking-avatar-worker")),
    }


def process_task(
    payload: dict,
    storage: S3Storage,
    pipeline,
    callback: TaskCallback,
    work_root: Path,
) -> None:
    task_id = payload["taskId"]
    work_dir = work_root / f"task-{task_id}"
    work_dir.mkdir(parents=True, exist_ok=True)
    try:
        image_path = work_dir / ("source_image" + Path(payload["imageS3Key"]).suffix)
        storage.download(payload["imageS3Key"], image_path)

        audio_path = None
        if payload.get("voiceAudioS3Key"):
            audio_path = work_dir / ("voice_audio" + Path(payload["voiceAudioS3Key"]).suffix)
            storage.download(payload["voiceAudioS3Key"], audio_path)

        callback.update(task_id, "processing")

        inputs = TaskInputs(
            task_id=task_id,
            avatar_id=payload["avatarId"],
            script_text=payload["scriptText"],
            image_path=image_path,
            audio_path=audio_path,
            work_dir=work_dir,
        )
        output = pipeline.run(inputs)

        output_key = f"videos/{task_id}.mp4"
        storage.upload(output_key, output)
        url = storage.url_for(output_key)
        callback.update(task_id, "completed", output_url=url)
        logger.info("task %s completed: %s", task_id, url)
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def main() -> None:
    _load_local_env()
    _check_required_env()
    cfg = load_config()
    storage = S3Storage()
    pipeline = create_pipeline(os.environ.get("AI_MODE", "mock"))
    callback = TaskCallback(cfg["api_base_url"])

    r = redis.Redis(
        host=cfg["redis_host"],
        port=cfg["redis_port"],
        password=cfg["redis_password"] or None,
        db=cfg["redis_db"],
        decode_responses=True,
    )

    logger.info(
        "worker started: queue=%s pipeline=%s",
        cfg["queue_key"],
        type(pipeline).__name__,
    )

    while True:
        try:
            item = r.blpop(cfg["queue_key"], timeout=5)
            if item is None:
                continue

            _, raw = item
            payload = json.loads(raw)
            logger.info("received task payload: %s", payload)
            try:
                process_task(payload, storage, pipeline, callback, cfg["work_root"])
            except Exception:
                logger.exception("task %s failed", payload.get("taskId"))
                try:
                    callback.update(
                        payload["taskId"],
                        "failed",
                        error="worker error, see worker logs",
                    )
                except Exception:
                    logger.exception("failed to report task failure to API")
        except redis.RedisError:
            logger.exception("redis connection error, retrying in 5s")
            time.sleep(5)
        except Exception:
            logger.exception("unexpected worker error, continuing")
            time.sleep(1)


if __name__ == "__main__":
    main()
