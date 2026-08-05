# Talking Avatar Platform（口播数字人系统）

端到端 AI 口播数字人合成平台：管理后台上传**形象图片**与**克隆音色音频**、填写播报
脚本，后台依次执行 **GPT-SoVITS 声音克隆 → LivePortrait 面部动画 → Wav2Lip 口型合成**，
输出带声音的说话视频。

## 架构

```text
浏览器 ──> Nginx (frontend, 唯一对外端口 8080)
             ├── /api    ──> Go API (Gin) ──> MariaDB 11 / Redis 8.2 / MinIO
             └── /media  ──> MinIO (S3 兼容, 模拟 RustFS)

Python AI Worker ──> Redis 队列 / boto3 下载素材
                  ──> 真实管线: GPT-SoVITS → LivePortrait → Wav2Lip(ONNX)
                  ──> 上传成品到 S3, 通过 Webhook 回写任务状态
```

- 前端：React + TypeScript + Vite + Tailwind + shadcn/ui（基于
  [satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin)）。
- 后端：Go + Gin + GORM，标准 AWS S3 SDK v2。
- AI Worker：Python 3.11，uv 管理依赖，boto3 + Redis。
- 存储：S3 兼容对象存储，开发环境用 MinIO 模拟 RustFS。
- 部署：Docker Compose 编排基础设施与前端；**真实 AI Worker 在宿主机原生运行**
  （macOS Apple Silicon 用 MPS/CoreML，Linux 用 NVIDIA CUDA 或 AMD ROCm），
  Docker 仅向宿主机发布 Redis 6379 与 MinIO 9000 两个端口。

## 已实现功能

- **Avatar Studio 页面**：上传形象图片（必填）+ 克隆音色音频（可选）+ 播报脚本；
  提交后自动轮询任务状态，完成即内嵌播放成品视频。
- **GPT-SoVITS 零样本声音克隆**：上传的音频仅作为基础音色参考，脚本文字用克隆
  音色读出，不会把参考音频混入成片。
- **LivePortrait 面部动画**：静态头像 → 眨眼/头部微动/耸肩的自然动画（24fps 无声
  base 视频，铺满语音时长）。
- **Wav2Lip(ONNX) 口型合成**：嘴部逐帧匹配语音，最终 mux 上克隆语音；ONNX +
  CoreML 执行器，16 秒视频口型阶段约 10 秒，CPU 线程数受限（默认 4）。
- **动画节奏可调**：驱动模板可换、播放速度/动作幅度可调（见“动画节奏”）。
- **Mock 管线**（`AI_MODE=mock`）：轻量占位，供 Docker Worker 镜像演示。

## 新设备快速开始

### 0. 前置依赖

- Git、Docker Desktop（或 Docker Engine + Compose）
- Python 3.11 + [uv](https://docs.astral.sh/uv/)
- 宿主机 macOS 需要 FFmpeg：`brew install ffmpeg`
- 前端开发需要 pnpm 10：`npm i -g pnpm@10`
- 后端开发需要 Go 1.22+

### 1. 克隆并启动 Docker 服务

```bash
git clone <repo-url> && cd TalkingAvatarPlatform
cp .env.example .env
docker compose up --build
```

访问 <http://localhost:8080>，左侧菜单进入 **Avatar Studio**。

### 2. 准备 Worker 环境（uv）

```bash
cd worker
uv venv                    # 按 .python-version 使用 CPython 3.11
uv sync --all-groups       # 安装全部依赖（含 PyTorch MPS、LivePortrait、GPT-SoVITS）
cp .env.local.example .env.local
```

> 约定：所有 Python 命令一律通过 `uv run python ...` 执行（在 `worker/` 目录下），
> 不要直接调用系统 `python`/`python3`，也不要使用 `requirements.txt`——依赖统一由
> `pyproject.toml` + `uv.lock` 管理，新增依赖用 `uv add`。

### 3. 准备模型（二选一）

**方式 A：新设备下载（约 4GB，需要网络）**

```bash
cd worker
uv run python download_models.py --models all
```

脚本会克隆 GPT-SoVITS / LivePortrait / Wav2Lip 代码到 `worker/external/`，下载权重
到 `worker/models/`（两者均已 gitignore），并自动完成：创建 GPT-SoVITS 预训练软链接、
把 wav2lip_gan.pth 本地导出为 ONNX（约 145MB）、下载 SCRFD 人脸检测 ONNX（约 3MB）。

- 国内网络加速：`HF_ENDPOINT=https://hf-mirror.com uv run python download_models.py`
- GitHub 慢时走代理：`git config --global http.proxy http://127.0.0.1:7897`
- 首次真实 TTS 会自动从 ModelScope 下载 G2PW 中文前端（约 1.2GB）。

**方式 B：从旧设备拷贝（最快）**

把旧机器的 `worker/models/` 与 `worker/external/` 两个目录整体拷贝到新机器对应
位置即可，`download_models.py` 会自动跳过已存在的文件。

### 4. 启动 Worker（真实管线）

```bash
cd worker
uv run python -u worker.py
```

`worker.py` 自动加载 `worker/.env.local`（已导出的环境变量优先）。`AI_MODE=real`
时跑真实模型管线；模型缺失时会有明确提示。

### 5. 本地前端开发（Vite，端口 5173）

```bash
cd frontend
cp .env.example .env.local   # VITE_API_BASE_URL=http://localhost:8080
pnpm install
pnpm dev
```

## Linux + AMD Radeon 部署（ROCm，如 RX 6800 XT）

6800 XT 是 RDNA2（gfx1030），ROCm 6.x / 7.x 均支持。两种方式任选：

**方式 A：官方 ROCm PyTorch 容器（推荐，torch 已预装）**

```bash
docker run -it --rm --network=host --ipc=host \
  --device=/dev/kfd --device=/dev/dri --group-add video \
  -v /path/to/TalkingAvatarPlatform:/workspace -w /workspace/worker \
  rocm/pytorch:rocm7.14_ubuntu24.04_py3.13_pytorch_release_2.12.0 bash
```

容器内（Python 3.13，torch 2.12 ROCm 已就绪）：

```bash
pip install uv ffmpeg        # 容器通常缺 uv 与 ffmpeg
uv sync --all-groups --no-group cuda --python python3 --inexact
cp .env.local.example .env.local
uv run python -u worker.py
```

> `--inexact` 很重要：镜像预装的 torch 不在 lock 里，不加这个参数 `uv sync`
> 会把 torch 剪掉。`--network=host` 让容器直接访问宿主机的 Redis/MinIO。

**方式 B：裸机 Ubuntu + ROCm**

```bash
cd worker
uv sync --all-groups --no-group cuda
uv pip install torch torchvision torchaudio \
  --index-url https://download.pytorch.org/whl/rocm6.3
# 以后每次 uv sync 都要加 --inexact，否则上面手动装的 torch 会被移除
```

验证：`uv run python -c "import torch; print(torch.cuda.is_available(), torch.version.hip)"`

**Worker 环境变量（`worker/.env.local`）**

```bash
AI_MODE=real
GPT_SOVITS_DEVICE=cuda
LIVEPORTRAIT_DEVICE=cuda
WAV2LIP_PROVIDER=rocm    # ROCm EP 不支持 LSTM 时会自动逐算子回退 CPU，不影响正确性
```

> 如果 ROCm EP 在你的卡上有问题，`WAV2LIP_PROVIDER=cpu` 同样可用（CPU 推理本身
> 就有 35fps+）。首次真实 TTS 会自动从 ModelScope 下载 G2PW 中文前端（约 1.2GB）。

## 实时直播（流式架构）

平台内置实时直播能力：长文本按句子切块后，由 `stream_worker.py` 逐块合成并
**内存直推 RTMP** 到 SRS，浏览器经 Nginx 拉 HTTP-FLV 播放，全程不落盘 MP4。

### 组件

- **SRS v5**（`docker-compose.yml` 中的 `srs` 服务）：RTMP 推流 1935、HTTP API
  1985、HTTP-FLV 8081（Nginx `/live/` 代理到 `srs:8081`，不与前端 8080 冲突）。
- **`POST /api/stream`**：接收 `{avatarId, text}`（或 `streamId` 可选），按
  `。！？!?；;` 与换行切句，按序推入 `talking_avatar:stream_tasks` 队列，
  返回 `{streamId, chunkCount, playbackUrl}`。
- **`stream_worker.py`**：消费队列 → GPT-SoVITS 分句 TTS（异步预取：Chunk N
  推流时 N+1 已在合成）→ 复用缓存的 LivePortrait base 动画 → Wav2Lip ONNX
  内存推理 → BGR24 帧 + 16k PCM 音频交错写入单个 ffmpeg 进程 →
  `rtmp://localhost:1935/live/<stream_id>`。

### 启动与使用

```bash
docker compose up --build            # 基础设施 + API + 前端 + SRS
cd worker
uv run python -u stream_worker.py    # 流式 Worker（与离线 worker.py 并存）

# 发起一场直播（示例）
curl -X POST http://localhost:8080/api/stream \
  -H 'Content-Type: application/json' \
  -d '{"avatarId": 9, "text": "大家好！欢迎来到直播间。今天聊聊数字人。"}'
```

播放地址：`http://localhost:8080/live/<stream_id>.flv`（`<video>` 标签直接可用）。

### 设计说明与当前限制

- 音视频同步：ffmpeg 需要每个输入的“首个包”才开始消费，且一次性写完整段音频会
  撑爆其预缓冲——因此实现为**每 0.5 秒交错写音频切片**（先写首片再写帧）。
- 稳定性优先：base 动画每个流只渲染一次（按首个 chunk 时长缓存并循环取帧）；
  每个 chunk 重新生成 base 动画（更生动的头部动作）留作后续优化
  （`STREAM_REGENERATE_BASE`）。
- 并发：TTS 与推流解耦（每流一个生产者线程 + 有界结果队列），帧生成与音频写入
  在推流线程内交错，不丢帧。`STREAM_ASYNC=0` 可退回串行。
- `POST /api/chat`（接 LLM 再入队）与 7x24 会话保持属下一阶段，当前 `/api/stream`
  直接接收整段文本。

## 数据流

1. 前端上传形象图片（必填）与克隆音频（可选），`POST /api/avatars` 直传对象存储，
   S3 Key 存入 MariaDB。
2. 提交播报脚本，`POST /api/tasks` 创建任务并把
   `{taskId, avatarId, scriptText, imageS3Key, voiceAudioS3Key}` 压入 Redis 队列。
3. Worker 通过 boto3 下载素材到本地 `/tmp`，执行 AI 管线（真实或 Mock），
   上传成品 MP4 回对象存储。
4. Worker 通过 `POST /api/tasks/:id/status` Webhook 将任务标记为
   `processing/completed/failed` 并保存视频 URL。
5. 前端轮询 `GET /api/tasks/:id`，完成后用 `<video>` 播放返回的 S3 URL。

## 动画节奏调整

面部动画由 LivePortrait 驱动模板（`.pkl`）控制，默认 `d5.pkl`（约 5 秒自然说话
动作；旧默认 `d1.pkl` 只有 0.5 秒，循环时眨眼/耸肩过快）。在 `worker/.env.local`
中设置：

```bash
LIVEPORTRAIT_DRIVING=.../assets/examples/driving/d5.pkl   # 换模板
LIVEPORTRAIT_DRIVING_SPEED=0.5                            # 0.5 = 动作慢一倍（时间插值）
LIVEPORTRAIT_DRIVING_MULTIPLIER=0.7                       # 0.7 = 动作幅度更含蓄
```

可选模板见 `worker/external/LivePortrait/assets/examples/driving/`：
`talking.pkl`（说话）、`wink.pkl`（眨眼）、`shy.pkl`（害羞）、`shake_face.pkl`（摇头）、
`laugh.pkl`（笑）等。

## 配置参数

| 参数 | 位置 | 说明 |
| --- | --- | --- |
| `AI_MODE` | `.env` / `.env.local` | `mock`（Docker 默认）或 `real`（宿主机） |
| `S3_*` | `.env` / `.env.local` | 对象存储端点、凭据、桶名、公网前缀 |
| `REDIS_*` | `.env` / `.env.local` | Redis 地址、密码、队列 Key |
| `GPT_SOVITS_*` | `worker/.env.local` | 参考音频提示词/语言、设备、端口 |
| `GPT_SOVITS_DEVICE` | `worker/.env.local` | `mps`（macOS 默认）/ `cuda`（Linux CUDA 或 ROCm） |
| `LIVEPORTRAIT_DEVICE` | `worker/.env.local` | `mps`（macOS 默认）/ `cuda`（Linux）/ `cpu` |
| `LIVEPORTRAIT_DRIVING*` | `worker/.env.local` | 模板、速度、幅度 |
| `LIVEPORTRAIT_OUTPUT_FPS` | `worker/.env.local` | base 视频帧率（默认 24） |
| `WAV2LIP_PROVIDER` | `worker/.env.local` | `coreml`（macOS 默认）/ `rocm`（AMD）/ `cuda` / `cpu` |
| `WAV2LIP_THREADS` | `worker/.env.local` | ONNX 线程数上限（默认 4） |
| `WAV2LIP_BACKEND` | `worker/.env.local` | `onnx`（默认）/ `torch`（慢，对照） |

完整清单见 `worker/.env.local.example`。

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
frontend/  shadcn-admin 前端（Avatar Studio 页面、Dockerfile、nginx.conf）
worker/    Python 3.11 AI Worker（uv、Redis、boto3、真实/模拟管线）
  ai/        base/mock/real 管线、TTS、渲染、ONNX 口型
  external/  gitignore：GPT-SoVITS / LivePortrait / Wav2Lip 克隆代码
  models/    gitignore：全部权重（GPT-SoVITS / LivePortrait / Wav2Lip ONNX）
docker-compose.yml / .env.example
AGENTS.md   开发交接说明（新设备快速接手）
```

## 常见问题排查

- **任务一直 processing**：看 `worker` 日志尾部。口型阶段卡住通常是模型缺失，跑
  `cd worker && uv run python download_models.py --models wav2lip` 补齐。
- **GitHub/HF 下载慢**：GitHub 走代理，HF 用 `HF_ENDPOINT=https://hf-mirror.com`。
- **TTS 启动报 NLTK 错误**：确认 `nltk>=3.8,<3.10` 已安装（首次会自动下载数据）。
- **口型 CPU 打满/极慢**：确认 `WAV2LIP_BACKEND` 为 `onnx`（torch 版仅作对照）。
- **视频无声音**：成品由 Wav2Lip 阶段 mux 克隆语音；若用 mock 管线且未传参考音频，
  会以脚本离线 TTS 为音轨。

## 生产注意事项

- 开发环境用 MinIO 模拟 RustFS 并开放 bucket 公开读（便于浏览器播放）。生产应改用
  真实 RustFS + 私有 bucket + 预签名 URL，调整 `S3_PUBLIC_BASE_URL` 与 nginx
  `/media` 代理。
- 生产环境请收紧 Worker 回调 Webhook 的鉴权。
- Linux/CUDA 生产部署需替换 PyTorch 为 CUDA 版（见 `worker/pyproject.toml` 注释），
  Wav2Lip ONNX 可在 NVIDIA 上用 `WAV2LIP_PROVIDER` 选择 GPU provider。
