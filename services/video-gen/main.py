"""Video generation microservice (FastAPI + uv).

Job dispatch only: the heavy provider runtimes (LivePortrait on MPS/CUDA/ROCm,
future ComfyUI) execute on the host AI worker. This service owns the provider
registry and the Redis job queue:

    1. the Go API POSTs /v1/video-gen/jobs with the scene video metadata
       (sceneVideoId / sourceImageS3Key / provider / settings);
    2. this service validates the provider and pushes the job to Redis
       (VIDEO_GEN_QUEUE_KEY);
    3. the host worker pops the queue, renders with the provider, uploads the
       video to S3 and completes the scene video via the Go webhook.

Media never crosses HTTP: only S3 keys travel in the payload.

Run:
    uv run uvicorn main:app --host 0.0.0.0 --port 8003
"""

import json
import logging
import os
from contextlib import asynccontextmanager

import redis.asyncio as aioredis
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger("video-gen-service")
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)

# Provider registry: anything listed here can be submitted. Providers whose
# runtime is not implemented yet raise NotImplementedError on the worker.
PROVIDERS = {
    "liveportrait": "implemented",
    "comfyui": "planned",
}

_r = None
_queue_key = os.environ.get("VIDEO_GEN_QUEUE_KEY", "talking_avatar:video_gen")


def _redis_addr() -> str:
    return os.environ.get("REDIS_ADDR", "redis:6379")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _r
    _r = aioredis.from_url(
        f"redis://{_redis_addr()}",
        password=os.environ.get("REDIS_PASSWORD") or None,
        db=int(os.environ.get("REDIS_DB", "0")),
        decode_responses=True,
    )
    logger.info("redis ready: %s (queue=%s)", _redis_addr(), _queue_key)
    yield
    await _r.aclose()


app = FastAPI(
    title="video-gen-service",
    description=(
        "Video generation microservice: provider registry + Redis job queue. "
        "Heavy provider runtimes execute on the host AI worker; media moves "
        "through S3 shared storage, never over HTTP."
    ),
    version="0.1.0",
    lifespan=lifespan,
)


class VideoGenJob(BaseModel):
    sceneVideoId: int = Field(gt=0)
    avatarId: int = Field(gt=0)
    sceneId: int = Field(gt=0)
    sourceImageS3Key: str = Field(min_length=1)
    provider: str = "liveportrait"
    settings: dict = {}


@app.post("/v1/video-gen/jobs")
async def create_job(job: VideoGenJob):
    if job.provider not in PROVIDERS:
        raise HTTPException(status_code=400, detail=f"unsupported provider: {job.provider}")
    payload = job.model_dump(mode="json")
    await _r.rpush(_queue_key, json.dumps(payload, ensure_ascii=False))
    logger.info("job enqueued: sceneVideoId=%s provider=%s", job.sceneVideoId, job.provider)
    return {"ok": True, "sceneVideoId": job.sceneVideoId, "provider": job.provider}


@app.get("/v1/video-gen/providers")
async def list_providers():
    return {"providers": PROVIDERS}
