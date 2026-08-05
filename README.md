# Talking Avatar Platform（口播数字人系统）

端到端 AI 口播数字人合成平台：管理后台上传**形象图片**并选择**播报音色**创建数字人，
系统先预处理生成**基础驱动视频**，之后离线播报与实时直播都只跑轻量推理：
**Edge-TTS 语音合成 → Wav2Lip 口型**，输出带声音的视频/推流。

## 架构

```text
浏览器 ──> Nginx (frontend, 唯一对外端口 8080)
             ├── /api    ──> Go API (Gin) ──> MariaDB 11 / Redis 8.2 / MinIO
             └── /media  ──> MinIO (S3 兼容, 模拟 RustFS)

Python AI Worker ──> Redis 队列 / boto3 下载素材
                  ──> 创建: LivePortrait 生成 base 视频（一次性预处理）
                  ──> 使用: Edge-TTS → Wav2Lip(ONNX) 离线播报 / 直播推流
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

## 两段式架构（创建 → 使用）

LivePortrait 只在**创建阶段**跑一次，离线与直播链路不再调用它：

1. **创建（Avatar Studio）**：上传形象图片 + 选择 Edge-TTS 音色（默认
   `zh-CN-XiaoxiaoNeural`）→ `POST /api/avatars`（状态 `initializing`）→
   Worker 消费 `avatar_init` 队列 → LivePortrait 生成静音 24fps base 视频 →
   上传 S3 → 回写 `base_video_s3_key` 并置为 `ready`。前端轮询
   `GET /api/avatars/:id` 显示「基础视频生成中…」。
2. **使用（Broadcast / Live）**：只下载 base 视频 → **Edge-TTS**（零 GPU）合成
   语音 → **Wav2Lip(ONNX)** 口型 → 离线 mux 成 MP4 上传 / 直播推流 SRS。

## 已实现功能

- **Avatar Studio（创建）**：形象名称 + 图片上传 + Edge-TTS 音色选择（列表缓存于
  localStorage，默认中文女声晓晓）；提交后显示「基础视频生成中…」并轮询状态。
- **Broadcast（离线播报）**：选择已就绪数字人 + 输入脚本 → 提交任务 → 轮询 →
  状态卡片内嵌 **xgplayer** 播放成品（9:16 竖版，最大 720×1080，模态窗播放）。
- **客户端直播间（观众端）**：独立 Next.js + TailwindCSS 项目（`client/`，端口
  **3000**，不属于管理后台）：首页有导航头（游客/账号身份、注册/登录/退出）与
  **分类筛选**，列出所有开播机器人（`GET /api/live`）；进入 `/rooms/:avatarId`
  后 xgplayer 拉 HTTP-FLV 观看，聊天面板按用户展示 `用户名 #ID`，可直接向数字人
  发消息（`POST /api/live/:id/message`）。`/api` 与 `/live` 由 Next 路由处理器在
  服务端代理，浏览器无 CORS 负担。
- **聊天身份与记录持久化**：游客自动分配临时 ID+用户名（`POST /api/chat/guest`）；
  注册把当前游客身份原地升级为账号（聊天记录不丢），登录把游客消息合并进账号，
  退出后重新获取新游客身份。用户消息与机器人回复全部入库（`chat_users` /
  `chat_messages`），`GET /api/chat/history` 供两端拉取历史。
- **直播字幕配置**：每个数字人可在 Live Studio「字幕设置」里配置是否显示字幕、
  字体（`worker/fonts/` 下的文件名）、位置（顶部/底部）、描边宽度与字号，持久化为
  Avatar 的 JSON 字段 `live_settings`；保存后自动重启直播生效。
- **管理端用户列表**：侧边栏「用户相关 → 用户列表」展示全部聊天用户
  （游客/账号 + 消息数），数据来自 `GET /api/users`。
- **悬浮画面监看**：Live Studio 右下角圆形 FAB，点击弹出可拖动的 9:16 视频浮窗，
  默认不渲染播放器，按需开启。
- **LLM 消息回复**：客户端消息 → OpenAI Go SDK 调 DeepSeek Responses API
  （`base_url=https://api.deepseek.com`，模型 `deepseek-v4-flash`）→ 回复按句切块
  入直播队列 → TTS → 口型 → 推流；未配置 `OPENAI_API_KEY` 时原样回读输入（测试模式）。
- **Edge-TTS 语音合成**：GPU-free 云端神经音色，按 avatar 的 `voice_id` 选声，
  一条句子约 1-2 秒（`TTS_ENGINE=gpt-sovits` 可切回旧克隆模型）。
- **LivePortrait 基础视频预处理**：创建数字人时生成静音 24fps 驱动视频，仅此一次。
- **Wav2Lip(ONNX) 口型合成**：基于预生成 base 视频，嘴部逐帧匹配语音；ONNX +
  CoreML 执行器，CPU 线程数受限（默认 4），短 base 自动循环覆盖任意脚本长度。
- **动画节奏可调**：驱动模板可换、播放速度/动作幅度可调（见“动画节奏”）。
- **基础视频去眨眼**：驱动模板眼部表情通道已冻结（不眨眼），保留耸肩/身体微晃，
  约 3 秒一次（`LIVEPORTRAIT_DRIVING_SPEED=0.2`）。
- **数字人分类**：Avatar 创建时可选「直播分类」（闲聊/知识/娱乐/游戏/带货/其他），
  观众端首页按分类筛选直播。
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

平台内置实时直播能力：每个数字人维持一条**常驻 FFmpeg 管道**推流到 SRS，浏览器经
Nginx 拉 HTTP-FLV 播放，全程不落盘 MP4。

### 组件

- **SRS v5**（`docker-compose.yml` 中的 `srs` 服务）：RTMP 推流 1935、HTTP API
  1985、HTTP-FLV 8081（Nginx `/live/` 代理到 `srs:8080`，不与前端 8080 冲突）。
- **后端直播接口**（`backend/internal/handlers/live.go`）：
  - `POST /api/live/{avatarID}/start`：在数据库登记 LiveSession 并通知 Worker
    打开常驻管道（闲置态：base 动画 + 静音）。
  - `POST /api/live/{avatarID}/push`：按 `。！？!?；;`/换行切句，逐条压入
    `live_queue:{avatarID}`。
  - `POST /api/live/{avatarID}/message`：把聊天文本交给 LLM（DeepSeek Responses，
    OpenAI SDK），回复切句入队 → TTS → 口型 → 推流；无 `OPENAI_API_KEY` 时回显
    原文（直播台“发送文字”仅测试用）；同时把用户消息与机器人完整回复写入
    `chat_messages`。
  - `GET /api/live/{avatarID}/status`：返回会话状态、队列长度与待渲染句子，
    供前端每秒轮询。
- **字幕**：默认开启，按 Avatar 的 `live_settings` 渲染（Pillow，非 ffmpeg
  drawtext——brew 版 ffmpeg 无此滤镜）；字体放 `worker/fonts/`，文件名需与设置一致。
- **`stream_worker.py`**（闲置/说话循环）：
  - 闲置态：循环喂 base 动画帧 + numpy 生成的静音音频（数字人自然耸肩/微动）。
  - 说话态：从 `live_queue:{avatarID}` 弹出句子 → Edge-TTS 异步 TTS → Wav2Lip(ONNX)
    内存出帧 → 口型帧 + TTS 音频替换推流（可选叠加字幕）；句子结束立即回到闲置态，
    **管道全程不关闭**。TTS 飞行期间不会丢弃队列里的后续句子（预取下一句）。
  - 帧率/分辨率两种状态完全一致（口型帧来自同一 base 片段）；视频输入带 ffmpeg
    `-re` 实时节流，音频按每 0.5s 切片与帧交错，A/V 同步且不超前。

### 启动与使用

```bash
docker compose up --build            # 基础设施 + API + 前端 + SRS
cd worker
uv run python -u stream_worker.py    # 流式 Worker（与离线 worker.py 并存）

# 观众端（独立 Next.js 项目）：http://localhost:3000
cd client && pnpm dev                # 或 docker compose up -d client

# 命令行示例：
curl -X POST http://localhost:8080/api/live/9/start
curl -X POST http://localhost:8080/api/live/9/message \
  -H 'Content-Type: application/json' \
  -d '{"text": "你好，在吗？"}'
curl http://localhost:8080/api/live/9/status
```

播放地址：`http://localhost:8080/live/avatar_9.flv`（Live Studio 用 mpegts.js 拉流）。

### 设计说明与当前限制

- 音视频同步：ffmpeg 需要每个输入的“首个包”才开始消费，且一次性写完整段音频会
  撑爆其预缓冲——因此实现为**每 0.5 秒交错写音频切片**（先写首片再写帧）。
- 实时性：视频输入带 `-re` 按帧率节流，内容按 1x 真实时间推进，播放器缓冲不膨胀；
  TTS 在闲置期间异步预取，说话切换无明显等待。
- 闲置 base 动画按 `LIVEPORTRAIT_IDLE_BASE_SECONDS`（默认 10s）渲染并循环取帧，
  头部动作每 10s 重复一次；逐 chunk 重新生成 base（更生动的头部动作）留作后续优化。
- 多机/断流重连属下一阶段（LLM 消息链路已由 `POST /api/live/:id/message` 落地）。

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
LIVEPORTRAIT_DRIVING_SPEED=0.2                            # 0.2 = 动作更慢，约 3s 一次耸肩
LIVEPORTRAIT_DRIVING_MULTIPLIER=0.7                       # 0.7 = 动作幅度更含蓄
```

基础视频默认**冻结眼部表情通道**（`EYE_EXP_DIMS` 取首帧值），因此不眨眼；耸肩等
身体动作保留。

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
| `OPENAI_BASE_URL` | `.env` | LLM 端点（默认 `https://api.deepseek.com`） |
| `OPENAI_API_KEY` | `.env` | DeepSeek API Key；不设则消息原样回读 |
| `OPENAI_MODEL` | `.env` | Responses 模型（默认 `deepseek-v4-flash`） |
| `STREAM_SUBTITLE_FONT` | `worker/.env.local` | 字幕回退字体（未配或字体缺失时用） |

完整清单见 `worker/.env.local.example`。

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/avatars` | multipart 上传 `name` + `image`(必填) + `voice_id`(可选) |
| `POST` | `/api/avatars` | 另可传 `category`（闲聊/知识/娱乐/游戏/带货/其他） |
| `GET` | `/api/avatars` | 素材列表 |
| `GET` | `/api/avatars/:id` | 单个素材（含 `liveSettings`） |
| `PUT` | `/api/avatars/:id/live-settings` | 保存直播字幕等配置（JSON） |
| `POST` | `/api/tasks` | `{avatarId, scriptText}`，入队并返回任务 |
| `GET` | `/api/tasks/:id` | 轮询任务状态与输出 URL |
| `POST` | `/api/tasks/:id/status` | Worker 内部 Webhook（processing/completed/failed） |
| `POST` | `/api/live/:id/start` | 开启直播（登记会话 + 通知 Worker 开管道） |
| `POST` | `/api/live/:id/message` | 聊天消息 → LLM 回复切句入队（观众端用） |
| `POST` | `/api/live/:id/push` | 直接按句入队（直播台测试用） |
| `GET` | `/api/live/:id/status` | 会话状态与队列 |
| `GET` | `/api/live` | 当前开播机器人列表 |
| `POST` | `/api/chat/guest` | 获取临时游客身份（userId + username） |
| `POST` | `/api/chat/register` | 注册（升级当前游客行，保留历史） |
| `POST` | `/api/chat/login` | 登录（合并游客消息进账号） |
| `GET` | `/api/chat/history` | 房间持久化聊天记录（`?avatarId=`） |
| `GET` | `/api/users` | 用户列表（游客/账号 + 消息数） |

## 目录结构

```text
backend/   Go Gin API（模型、S3、Redis、handlers、Dockerfile）
frontend/  shadcn-admin 前端（Avatar Studio 页面、Dockerfile、nginx.conf）
client/    Next.js + TailwindCSS 观众端（独立项目，:3000）
  lib/identity.tsx + components/auth-modal.tsx   聊天身份与登录/注册
worker/    Python 3.11 AI Worker（uv、Redis、boto3、真实/模拟管线）
  ai/        base/mock/real 管线、TTS、渲染、ONNX 口型
  fonts/     字幕字体目录（gitignore，见 fonts/README.md）
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
- **视频无声音**：成品由 Wav2Lip 阶段 mux Edge-TTS 语音；若用 mock 管线则以其
  离线 TTS 为音轨。

## 生产注意事项

- 开发环境用 MinIO 模拟 RustFS 并开放 bucket 公开读（便于浏览器播放）。生产应改用
  真实 RustFS + 私有 bucket + 预签名 URL，调整 `S3_PUBLIC_BASE_URL` 与 nginx
  `/media` 代理。
- 生产环境请收紧 Worker 回调 Webhook 的鉴权。
- Linux/CUDA 生产部署需替换 PyTorch 为 CUDA 版（见 `worker/pyproject.toml` 注释），
  Wav2Lip ONNX 可在 NVIDIA 上用 `WAV2LIP_PROVIDER` 选择 GPU provider。
