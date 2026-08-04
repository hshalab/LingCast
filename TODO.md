# Roadmap: 从离线视频生成 → 实时交互直播平台

> Role: AI Full-Stack & Streaming Architecture Agent

## Mission Overview

The "Talking Avatar Platform" currently works perfectly in a local macOS Docker
environment using a decoupled architecture (Go API + Python Worker + MinIO +
Redis).

Our next evolutionary leap is to upgrade the platform from an **"Offline
Asynchronous Video Generator"** to a **"Real-time Interactive Streaming
Platform"**, while also migrating the compute layer to a Linux + AMD GPU
environment.

Execute the following Roadmap **sequentially**. Do NOT move to Phase 2 before
Phase 1 is fully tested.

## 状态图例

- [x] 已完成并提交
- [~] 代码已就绪，待 AMD 机器实机验证
- [ ] 未开始

---

## Phase 1: Compute Migration & AMD GPU Enablement（计算迁移）

**Goal:** Migrate the Python Worker from macOS (MPS/CoreML) to Ubuntu Linux with
AMD GPUs using ROCm.

### Tasks

1. **Worker Dockerfile Update (AMD ROCm)** — [ ]
   - Create an alternative Dockerfile (e.g., `worker/Dockerfile.rocm`).
   - Use the official ROCm PyTorch image as the base
     (`rocm/pytorch:rocm7.14_ubuntu24.04_py3.13_pytorch_release_2.12.0` 或类似).
   - Ensure `uv` installs the correct ROCm dependencies
     (`--all-groups --no-group cuda --inexact`，保留镜像预装 torch).
   - 接入 `docker-compose.yml`（`worker-rocm` 服务，profile: rocm，透传
     `/dev/kfd` + `/dev/dri`）。
2. **ONNX Runtime Adjustments** — [x]
   - 已实现：`onnx_utils.build_session()` 自动检测 `ROCMExecutionProvider`，
     支持 `WAV2LIP_PROVIDER=rocm`，逐节点回退 CPU。
   - 已实现：`real.py` 默认使用 `Wav2LipOnnxLipSync`（ONNX 后端）。
3. **Environment Parity Check** — [~]
   - 在 Ubuntu ROCm 容器内验证 S3/Redis 连接逻辑（`--network=host`）。
   - 新增 `worker/rocm_check.py` 环境自检脚本。
   - 跑通一个测试任务，生成时间与 macOS CoreML 基准（约 10 秒）相当或更快。

## Phase 2: Business Logic Completion（业务闭环）

**Goal:** Complete the Avatar listing feature on the Frontend and API.

### Tasks

1. **Go API (Backend)** — [ ]
   - 确保 `GET /api/avatars` 成功从 MariaDB `avatars` 表返回标准 JSON 数组。
2. **Frontend (shadcn-admin)** — [ ]
   - 新增 "Avatar Library" 视图。
   - 请求 `GET /api/avatars`，以响应式 Grid / Card 列表展示头像缩略图
     （经 S3 代理）与名称。

## Phase 3: Streaming Architecture Reboot（流式架构）

**Goal:** 引入 RTMP 流媒体网关，将 Worker 推理管线重构为
**内存 → 网络持续推流**，不再落盘 MP4。

### Step 3.1: SRS Streaming Gateway — [ ]

1. 在 `docker-compose.yml` 集成 SRS（Simple RTMP Server）容器。
2. 映射必要端口（1935 RTMP 推流；8080/FLV 或 WebRTC 端口供前端拉流）。
3. 尽量保持在内网 Docker 网络，仅把拉流端口暴露给 Nginx 代理。

### Step 3.2: Streaming Pipeline Refactor（交互式问答）— [ ]

1. **分句处理**：Worker 不再一次性处理整段文本，按标点拆分为句子级 chunk。
2. **内存 → RTMP 输出**：废弃 `final_avatar.mp4` 落盘逻辑；用 `subprocess`
   打开 FFmpeg 管道——Wav2Lip 每完成一个句子 chunk 的帧，立即把原始帧与对齐
   音频 piped 进 FFmpeg，实时编码推流到 SRS（`rtmp://srs:1935/live/avatar_1`）。
3. **API 调整**：新增 `POST /api/chat`——接收用户输入，触发 LLM（mock 或真实），
   把文本响应按 chunk 顺序写入 Redis 队列供 Worker 消费。

### Step 3.3: 7x24 Long-form Broadcast（长时直播）— [ ]

1. **异步多线程（核心挑战）**：避免推流卡顿，Worker 需并发处理 chunk——
   Chunk N 正在渲染帧并推流时，Chunk N+1 正在做 TTS，Chunk N+2 正在生成
   base 视频帧。
2. 在 Worker 内实现基于队列的异步缓冲管线，保证不丢帧。

## Strict Rules for Execution

1. 先给出 Phase 1 所需的精确命令与代码调整，测试通过后再进入下一阶段。
2. 不重写整个系统；模块化注入改动，保持现有 API + DB + S3 + Nginx 架构不变。
3. Phase 3 优先稳定性而非极致低延迟：先保证分句与 FFmpeg 管道不崩溃，再优化线程。
