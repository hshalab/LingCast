"""Production-ready Edge-TTS microservice (FastAPI + uv).

S3 shared-storage data flow (media files NEVER cross HTTP/Redis):
    1. edge-tts (async API) synthesizes speech into a temp file;
    2. ffmpeg (async subprocess) converts it to 16 kHz / 16-bit / mono PCM WAV
       (the exact format Wav2Lip downstream requires);
    3. the WAV is uploaded to S3 (RustFS) via boto3 wrapped in
       ``asyncio.to_thread`` so the event loop is never blocked;
    4. the response returns ONLY the S3 object key + metadata;
    5. all temporary files are removed in a ``finally`` block.

S3 configuration is read from environment variables only:
    S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY / S3_SECRET_KEY

Run:
    uv run uvicorn main:app --host 0.0.0.0 --port 8002
"""

import asyncio
import logging
import os
import shutil
import tempfile
import uuid
import wave
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import boto3
import edge_tts
from botocore.client import Config
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator

logger = logging.getLogger("tts-service")
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)

# Wav2Lip-compatible output format.
SAMPLE_RATE = 16000
CHANNELS = 1
SAMPLE_BITS = 16

_s3 = None
_bucket = ""


def _require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(
            f"{name} must be set (S3 shared storage: S3_ENDPOINT/S3_BUCKET/"
            "S3_ACCESS_KEY/S3_SECRET_KEY)"
        )
    return value


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _s3, _bucket
    endpoint = _require_env("S3_ENDPOINT")
    _bucket = _require_env("S3_BUCKET")
    access_key = _require_env("S3_ACCESS_KEY")
    secret_key = _require_env("S3_SECRET_KEY")
    # Client creation is lazy (no network I/O until the first call); path-style
    # addressing is required by RustFS / S3-compatible endpoints.
    _s3 = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="us-east-1",
        config=Config(s3={"addressing_style": "path"}, signature_version="s3v4"),
    )
    logger.info("s3 ready: endpoint=%s bucket=%s", endpoint, _bucket)
    yield


app = FastAPI(
    title="tts-service",
    description=(
        "Edge-TTS microservice: async edge-tts -> 16kHz PCM WAV -> S3 "
        "(RustFS) shared storage. Returns S3 keys only, never media bytes."
    ),
    version="0.1.0",
    lifespan=lifespan,
)


class SynthesizeRequest(BaseModel):
    text: str = Field(..., description="Text to synthesize.")
    voiceId: str = Field(
        default="zh-CN-XiaoxiaoNeural",
        description="Edge-TTS voice name, e.g. zh-CN-XiaoxiaoNeural.",
    )

    @field_validator("text")
    @classmethod
    def _text_nonempty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("text must not be empty")
        return v

    @field_validator("voiceId")
    @classmethod
    def _voice_nonempty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("voiceId must not be empty")
        return v


async def _generate_mp3(text: str, voice_id: str, out: Path) -> None:
    """Synthesize speech with the async edge-tts API into a temp file."""
    communicate = edge_tts.Communicate(text, voice_id)
    with open(out, "wb") as f:
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
    if out.stat().st_size == 0:
        raise RuntimeError("edge-tts returned no audio for the given text/voice")


async def _convert_to_wav(src: Path, dst: Path) -> None:
    """Convert to 16 kHz / 16-bit / mono PCM WAV via ffmpeg (async)."""
    cmd = [
        "ffmpeg",
        "-y",
        "-loglevel",
        "error",
        "-i",
        str(src),
        "-ar",
        str(SAMPLE_RATE),
        "-ac",
        str(CHANNELS),
        "-sample_fmt",
        "s16",
        str(dst),
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(
            f"ffmpeg conversion failed: {stderr.decode(errors='replace')}"
        )


def _wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as w:
        frames = w.getnframes()
        rate = w.getframerate()
    return frames / rate if rate else 0.0


def _upload(s3_key: str, path: Path) -> None:
    """Blocking S3 upload; call via asyncio.to_thread."""
    _s3.upload_file(
        str(path),
        _bucket,
        s3_key,
        ExtraArgs={"ContentType": "audio/wav"},
    )


@app.get("/healthz")
def healthz() -> dict:
    if _s3 is None:
        return {"status": "starting"}
    return {
        "status": "ok",
        "s3_bucket": _bucket,
        "wav_format": f"{SAMPLE_RATE}Hz/{SAMPLE_BITS}bit/mono",
    }


@app.post("/v1/tts/synthesize")
async def synthesize(req: SynthesizeRequest) -> dict:
    if _s3 is None:
        raise HTTPException(status_code=503, detail="service not ready")

    workdir = Path(tempfile.mkdtemp(prefix="tts-"))
    mp3_path = workdir / "speech.mp3"
    wav_path = workdir / "speech.wav"
    try:
        await _generate_mp3(req.text, req.voiceId, mp3_path)
        await _convert_to_wav(mp3_path, wav_path)

        duration = _wav_duration(wav_path)
        s3_key = (
            f"tts/{datetime.now(timezone.utc).strftime('%Y%m%d')}/"
            f"{uuid.uuid4().hex}.wav"
        )
        await asyncio.to_thread(_upload, s3_key, wav_path)

        logger.info(
            "synthesized voice=%s duration=%.2fs s3_key=%s",
            req.voiceId,
            duration,
            s3_key,
        )
        return {
            "status": "success",
            "s3_key": s3_key,
            "metadata": {
                "format": "wav",
                "sample_rate": SAMPLE_RATE,
                "channels": CHANNELS,
                "bits": SAMPLE_BITS,
                "duration_sec": round(duration, 3),
                "bytes": wav_path.stat().st_size,
                "voice_id": req.voiceId,
            },
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("synthesize failed")
        raise HTTPException(
            status_code=500, detail=f"tts synthesis failed: {exc}"
        ) from exc
    finally:
        # The container disk must never fill up with temp audio.
        shutil.rmtree(workdir, ignore_errors=True)
