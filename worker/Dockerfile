FROM python:3.10-slim

# uv for dependency management (base deps only -> lightweight mock worker).
COPY --from=ghcr.io/astral-sh/uv:0.12.1 /uv /uvx /bin/

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg espeak-ng \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY . .

CMD ["uv", "run", "--no-sync", "python", "-u", "worker.py"]
