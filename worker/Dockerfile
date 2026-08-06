FROM python:3.11-slim

# uv for dependency management (base deps only -> lightweight mock worker).
# Installed from PyPI instead of COPY --from=ghcr.io so the build does not
# depend on the GitHub Container Registry (network/proxy flakiness).
RUN pip install --no-cache-dir uv==0.12.1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg espeak-ng \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY . .

CMD ["uv", "run", "--no-sync", "python", "-u", "worker.py"]
