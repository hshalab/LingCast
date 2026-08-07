FROM rocm/pytorch:rocm7.2.4_ubuntu24.04_py3.12_pytorch_release_2.10.0

# Install uv for dependency management
RUN pip install --no-cache-dir uv==0.12.1

# Install required system packages
RUN sed -i 's/archive.ubuntu.com/mirrors.aliyun.com/g' /etc/apt/sources.list.d/ubuntu.sources 2>/dev/null || sed -i 's/archive.ubuntu.com/mirrors.aliyun.com/g' /etc/apt/sources.list || true \
    && apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg espeak-ng libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml uv.lock ./
# IMPORTANT: For ROCm, we must use --inexact so uv sync preserves the PyTorch
# installed in the rocm base image, instead of uninstalling it.
# (As specified in AGENTS.md dependencies section)
ENV UV_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --inexact --all-groups --no-group cuda

COPY . .

CMD ["uv", "run", "--no-sync", "python", "-u", "worker.py"]
