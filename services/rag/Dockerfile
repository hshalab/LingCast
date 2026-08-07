# Local RAG knowledge-base microservice (port 8001).
# Zero model dependencies: zvec's bundled Jieba tokenizer handles Chinese,
# no sentence-transformers / torch / model downloads.
# - Zvec data is persisted under /app/zvec_data; mount a volume there so the
#   knowledge base survives container recreation.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ZVEC_DATA_DIR=/app/zvec_data

WORKDIR /app

COPY pyproject.toml uv.lock main.py ./

RUN pip install --no-cache-dir uv \
    && uv sync --no-dev --frozen \
    && mkdir -p /app/zvec_data

EXPOSE 8001

CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
