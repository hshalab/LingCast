# Video generation microservice (port 8003, internal network).
# Dispatch-only: provider runtimes run on the host AI worker (MPS/CUDA/ROCm).
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY pyproject.toml uv.lock main.py ./

RUN pip install --no-cache-dir uv \
    && uv sync --no-dev --frozen

EXPOSE 8003

CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8003"]
