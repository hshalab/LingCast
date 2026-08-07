FROM rocm/pytorch:rocm7.2.4_ubuntu24.04_py3.12_pytorch_release_2.10.0

# Install uv for dependency management
RUN pip install --no-cache-dir uv==0.12.1

# Install required system packages
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg espeak-ng \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml uv.lock ./
# IMPORTANT: For ROCm, we must use --inexact so uv sync preserves the PyTorch
# installed in the rocm base image, instead of uninstalling it.
# (As specified in AGENTS.md dependencies section)
RUN uv sync --frozen --no-dev --inexact

COPY . .

CMD ["uv", "run", "--no-sync", "python", "-u", "worker.py"]
