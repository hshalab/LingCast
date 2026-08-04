# Talking Avatar Platform — 开发交接说明

本文档供 AI Agent 或开发者在**新设备上 clone 本仓库后**快速理解现状并继续开发。
完整的上手步骤见 [README.md](./README.md)。

## 1. 项目是什么

端到端口播数字人平台：管理后台上传形象图片 + 克隆音色音频 + 播报脚本，后台用
**GPT-SoVITS 声音克隆 + LivePortrait 面部动画 + Wav2Lip(ONNX) 口型合成**生成
带声音的说话视频。

## 2. 当前技术栈（已落地，勿按旧文档改回）

- 前端：React + TypeScript + Vite + Tailwind + shadcn/ui（基于 satnaing/shadcn-admin），
  pnpm 10.25.0 管理，`frontend/`。
- 后端：Go + Gin + GORM，`backend/`（模型、S3、Redis、handlers）。
- AI Worker：Python **3.11**（`worker/.python-version`），uv 管理依赖（`pyproject.toml`
  + `uv.lock`），**不要使用 requirements.txt**。
- 存储：S3 兼容对象存储（开发用 MinIO 模拟 RustFS）；Go 用 `aws-sdk-go-v2`，
  Python 用 boto3；服务间只传 S3 Key，不用本地路径。
- 基础设施：Docker Compose；**MariaDB 11** + **Redis 8.2.2-alpine** + MinIO。
- 部署模式：Docker 里跑基础设施 + API + 前端 + 轻量 Mock Worker；**真实 AI Worker
  在宿主机原生运行**：macOS Apple Silicon（MPS/CoreML）、Linux NVIDIA CUDA、
  Linux **AMD ROCm**（RX 6800 XT 等 RDNA2，见 README 对应章节）。Docker 发布
  6379/9000 端口供宿主机 Worker 连接。
- 依赖组（`worker/pyproject.toml`）：`models`（macOS 默认）、`cuda`、
  `rocm`（仅 `onnxruntime-rocm`，torch 用官方 ROCm 镜像或手动装）——cuda/rocm
  互斥，Linux 用 `--no-group` 二选一；ROCm 容器里 `uv sync` 必须加 `--inexact`
  保留镜像预装的 torch。

## 3. 当前实现状态

- ✅ Avatar Studio 页面（上传素材、提交任务、轮询、播放成品）。
- ✅ Go API：`POST /api/avatars`、`GET /api/avatars`、`POST /api/tasks`、
  `GET /api/tasks/:id`、`POST /api/tasks/:id/status`（Worker 回调）。
- ✅ 真实管线 `AI_MODE=real`：GPT-SoVITS 零样本克隆 → LivePortrait 24fps 无声
  base 视频 → Wav2Lip ONNX 口型（CoreML 优先）→ mux 音频 → 上传 S3 + 回调。
- ✅ `worker/download_models.py --models all`：克隆外部代码、下载权重、导出
  wav2lip ONNX、创建软链接（一键可复现）。
- ✅ 性能：16 秒视频口型阶段约 10 秒；CPU 线程数受限（`WAV2LIP_THREADS`，默认 4）。
- ✅ 动画节奏可调：默认驱动模板 d5.pkl，另有 `LIVEPORTRAIT_DRIVING_SPEED` /
  `LIVEPORTRAIT_DRIVING_MULTIPLIER` 两个旋钮。
- ⬜ Mock 管线（`AI_MODE=mock`，Docker Worker 镜像默认）仅为占位/轻量演示。
- ⬜ Linux/CUDA 生产部署未实测（代码路径已预留）。

## 4. 目录速览

```text
backend/   Go API（Dockerfile）
frontend/  React 管理后台（Dockerfile + nginx.conf）
worker/
  worker.py              Worker 入口（Redis 队列、S3、Webhook 回调）
  download_models.py     一键克隆代码 + 下载/导出模型
  ai/
    real.py              RealPipeline：TTS → 渲染 → 口型
    tts_real.py          GPT-SoVITS（本地 API server 模式）
    renderer_real.py     LivePortrait 渲染（含模板放慢/幅度调节）
    lipsync_onnx.py      Wav2Lip ONNX 口型（CoreML/CPU）
    face_detect_onnx.py  SCRFD ONNX 人脸检测
    onnx_utils.py        ONNX session 构建（线程限制、provider 选择）
    lipsync_real.py      torch 版 Wav2Lip（慢，仅 WAV2LIP_BACKEND=torch 对照用）
  external/  gitignore，外部推理仓库克隆（GPT-SoVITS/LivePortrait/Wav2Lip）
  models/    gitignore，权重（见下方“模型目录”）
```

## 5. 关键约定

- 所有 Python 命令一律 `cd worker && uv run python ...`；新增依赖用 `uv add`，
  不写 requirements.txt。
- S3 是唯一的跨服务文件通道：上传/下载都走 S3 Key/URL，不在服务间传本地路径。
- AI 逻辑与 S3/Redis 编排解耦：新模型实现 `InferencePipeline`，在
  `worker/ai/factory.py` 注册，通过 `AI_MODE` 切换。
- 权重/外部代码永不入库（`worker/models/`、`worker/external/` 已 gitignore）。
- 提交信息沿用仓库现有风格：`feat:` / `fix:` / `docs:` / `refactor:` 前缀 + 中文或
  英文描述。
- 修改涉及外部仓库（GPT-SoVITS/LivePortrait/Wav2Lip）时优先在 `worker/ai/` 里做
  适配层，避免直接改外部代码（升级可替换）。

## 6. 新设备快速启动（摘要）

```bash
git clone <repo> && cd TalkingAvatarPlatform
cp .env.example .env
docker compose up --build          # 基础设施 + API + 前端

cd worker
uv sync --all-groups               # 安装全部依赖（较久）
cp .env.local.example .env.local
uv run python download_models.py --models all   # 或从旧设备拷贝 models/external
uv run python -u worker.py          # 真实管线，AI_MODE=real
```

模型快速迁移（免重新下载 ~4GB）：把旧设备的 `worker/models/` 和
`worker/external/` 整个目录拷到新设备对应位置即可，脚本会跳过已存在文件。

## 7. 已知坑（务必先读）

- **模型目录不入库**：clone 后没有 `models/`/`external/` 是正常的，跑
  `download_models.py` 或拷贝。
- **GitHub 慢**：本机可走代理，例如
  `git -c http.proxy=http://127.0.0.1:7897 clone ...`；HF 慢可用
  `HF_ENDPOINT=https://hf-mirror.com`。
- **NLTK 版本**：必须 <3.10（已 pin），否则 GPT-SoVITS 文本前端 import 会挂；
  首次 TTS 会自动下载 NLTK 数据。
- **onnxruntime**：macOS 用官方 wheel（`onnxruntime>=1.17`），不要装
  `onnxruntime-silicon`（1.16.3 的命名空间包不完整）。
- **onnxruntime-rocm 与 onnxruntime 互斥**：Linux x86_64 装 rocm 组时需
  `--no-group cuda`；反之亦然，二者都提供 `onnxruntime` 包。
- **口型别用 torch 后端**：`WAV2LIP_BACKEND` 默认 onnx；torch 版在 Apple Silicon
  上要 8 分钟且打满 CPU，仅作对照。
- **ROCm 上口型走 CPU 兜底**：`WAV2LIP_PROVIDER=rocm` 时若 LSTM 算子不在 ROCm EP
  支持集内会自动逐节点回退 CPU，不影响结果。
- **G2PW 中文前端**：首次真实 TTS 会自动从 ModelScope 下载（约 1.2GB），需要网络。
- **ffmpeg**：宿主机需 `brew install ffmpeg`（torchcodec/GPT-SoVITS 依赖）。
- **任务卡在 processing**：先看 worker 日志尾部；口型阶段卡住多半是用了旧 torch
  后端或模型缺失（`download_models.py --models wav2lip` 可补齐）。
