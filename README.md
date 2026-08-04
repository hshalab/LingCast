# Talking Avatar Platform (口播数字人系统)

轻量级端到端 AI 数字人合成平台：管理后台（React + shadcn-admin）、Go (Gin + GORM) API 控制面、Python AI 推理 Worker（boto3 + Redis），以及 S3 兼容对象存储层（开发环境用 MinIO 模拟 RustFS）。

## 架构

```text
浏览器 ──> Nginx (frontend, 唯一对外端口)
             ├── /api    ──> Go API (Gin) ──> MariaDB / Redis / S3
             └── /media  ──> MinIO (S3 兼容, 模拟 RustFS)

Python AI Worker ──> Redis 队列 / boto3 下载素材
                  ──> Mock 推理 (脚本 → 离线 TTS 语音 + 图片合成视频)
                  ──> 上传产物到 S3, 通过 Webhook 回写任务状态
```

MariaDB、Redis、对象存储、API、Worker 均只在内网通信，不对宿主机开放端口。

## 快速开始

```bash
cp .env.example .env
docker compose up --build
```

然后访问 <http://localhost:8080>，左侧菜单进入 **Avatar Studio**。

## Phase 2：混合部署 + 真实 AI 模型（GPT-SoVITS + LivePortrait）

Docker 无法访问 Apple Silicon 的 MPS GPU，因此 **Python AI Worker 在 macOS 宿主机
原生运行**（使用 MPS），其余服务仍在 Docker 中。为此 `docker-compose.yml` 向宿主机
发布了 Redis（6379）和对象存储（9000）两个端口，供宿主机上的 Worker 连接。

### 1. 准备 Python 3.11 环境（uv 管理）

```bash
cd worker
uv venv                     # 按 .python-version 使用 CPython 3.11
uv pip install -r requirements.txt   # 含 PyTorch (macOS MPS wheel)、onnxruntime-silicon 等
uv pip install -r external/GPT-SoVITS/requirements.txt  # GPT-SoVITS 官方依赖（量大，建议 conda/venv）
```

> 约定：所有 Python 命令一律通过 `uv run python ...` 执行（在 `worker/` 目录下），
> 不要直接调用系统 `python`/`python3`，否则会丢失项目依赖与版本管理。

macOS 还需要带共享库的 FFmpeg（torchcodec 依赖，GPT-SoVITS 官方同样要求）：

```bash
brew install ffmpeg
```

Linux/CUDA 生产环境请从 <https://download.pytorch.org> 安装对应的 CUDA 版 PyTorch，
其余依赖相同。

### 2. 下载模型权重（约 2.6GB）

```bash
cd worker
uv run python download_models.py --models all
```

脚本会克隆 GPT-SoVITS / LivePortrait 代码到 `worker/external/`，并下载权重到
`worker/models/`（两者均已 gitignore）。可用 `--dry-run` 预览文件清单；国内网络可
设置 `HF_ENDPOINT=https://hf-mirror.com` 加速。下载完成后脚本会自动创建
`GPT_SoVITS/pretrained_models` 下的软链接指向 `worker/models`，并在 G2PW 中文前端
就绪后把它的 BERT 指向本地权重（首次真实 TTS 运行会自动从 ModelScope 下载 G2PW 模型，
约 1.2GB，需要网络）。

### 3. 启动宿主机 Worker

```bash
cd worker
cp .env.local.example .env.local
set -a && . .env.local && set +a
uv run python -u worker.py
```

`AI_MODE=real` 时管线为：**GPT-SoVITS 零样本声音克隆 TTS**（参考音频 → 匹配音色的
脚本语音）→ **LivePortrait 面部动画**（图片 + 语音 → 口播视频）。模型权重缺失时会
提示运行下载脚本。`AI_MODE=mock` 保持原来的轻量模拟管线，Docker Worker 镜像不受影响。

### 本地前端开发（Vite，端口 5173）

```bash
cd frontend
cp .env.example .env.local   # VITE_API_BASE_URL=http://localhost:8080
pnpm install
pnpm dev
```

## 数据流

1. 前端上传形象图片（必填）与克隆音频（可选），`POST /api/avatars` 直传对象存储，S3 Key 存入 MariaDB。
2. 提交播报脚本，`POST /api/tasks` 创建任务并把 `{taskId, avatarId, scriptText, imageS3Key, voiceAudioS3Key}` 压入 Redis 队列。
3. Worker 通过 `boto3` 下载素材到本地 `/tmp`，执行 AI 管线（当前为 Mock：睡眠 10 秒后，用 espeak-ng 把脚本文本合成为语音，再与形象图片合成视频；上传的音频仅作为克隆音色的参考输入，不会直接混入视频）。
4. 产物上传回对象存储，通过 `POST /api/tasks/:id/status` Webhook 将任务标记为 `completed` 并保存视频 URL。
5. 前端轮询 `GET /api/tasks/:id`，完成后用 `<video>` 播放 S3 返回的 URL。

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/avatars` | multipart 上传 `name` + `image`(必填) + `voice_audio`(可选) |
| `GET` | `/api/avatars` | 素材列表 |
| `POST` | `/api/tasks` | `{avatarId, scriptText}`，入队并返回任务 |
| `GET` | `/api/tasks/:id` | 轮询任务状态与输出 URL |
| `POST` | `/api/tasks/:id/status` | Worker 内部 Webhook（processing/completed/failed） |

## 目录结构

```text
backend/   Go Gin API（模型、S3、Redis、handlers、Dockerfile）
worker/    Python 3.10 AI Worker（boto3、Redis、Mock 管线、Dockerfile）
frontend/  shadcn-admin 前端（Avatar Studio 页面、Dockerfile、nginx.conf）
docker-compose.yml / .env.example
```

## 替换为真实 AI 模型

AI 逻辑与 S3/Redis 编排完全解耦。当前 Mock 管线包含两个抽象步骤：**TTS 语音合成**（`worker/ai/tts.py`，脚本文本 → 语音，上传音频作为克隆基准）与**视频渲染**（图片 + 语音 → MP4）：

1. 在 `worker/ai/` 下实现 `InferencePipeline`（参考 `MockPipeline`）。
2. 在 `worker/ai/factory.py` 注册新管线，例如 `{"liveportrait": LivePortraitPipeline}`。
3. 设置环境变量 `AI_MODE=liveportrait` 重启 Worker。

## 生产注意事项

- 开发环境通过 MinIO 模拟 RustFS，并开放了 bucket 的公开读权限（便于浏览器直接播放视频）。生产环境应改用真实 RustFS 并使用私有 bucket + 预签名 URL，调整 `S3_PUBLIC_BASE_URL` 与 nginx `/media` 代理。
- 生产环境请收紧 Worker 回调 Webhook 的鉴权。
