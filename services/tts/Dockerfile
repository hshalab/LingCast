# Production Edge-TTS microservice (port 8002).
# - ffmpeg is installed at build time: edge-tts outputs compressed audio which
#   must be converted to 16kHz/16-bit/mono PCM WAV for the Wav2Lip worker.
# - No media files are kept on disk: temp files are removed after the S3
#   upload, and only the S3 object key is returned.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml uv.lock main.py ./

RUN pip install --no-cache-dir uv \
    && uv sync --no-dev --frozen

EXPOSE 8002

CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8002"]
