# 快速开始

完整的上手说明见仓库根目录 [README.md](https://github.com/taochangle/LingCast#readme)。

## 环境要求

- Git、Docker Desktop（或 Docker Engine + Compose）
- Python 3.11 + [uv](https://docs.astral.sh/uv/)
- 宿主机 FFmpeg：`brew install ffmpeg`
- pnpm 10（前端开发）

## 启动 Docker 服务

```bash
git clone https://github.com/taochangle/LingCast.git && cd LingCast
cp .env.example .env
docker compose up --build
```

- 管理后台：<http://localhost:8080>（默认 `admin` / `admin123`）
- 观众端：<http://localhost:3000>
- API 文档网关：<http://localhost:8080/doc/>

## 宿主机 Worker（真实 AI 管线）

```bash
cd worker
uv sync --all-groups
cp .env.local.example .env.local
uv run python download_models.py --models all   # ~4GB，或从旧机器拷贝 models/ + external/
uv run python -u worker.py                      # 离线生成
uv run python -u stream_worker.py               # 直播（与 worker.py 并存）
```

数据库与表结构无需手动创建：MariaDB 容器首次启动自动建库，API 启动时 GORM 自动建表。
