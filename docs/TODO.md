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

1. **Go API (Backend)** — [x]
   - `GET /api/avatars` + `GET /api/avatars/:id`（轮询初始化状态）；创建时
     `voice_id`/`status=initializing`/`avatar_init` 队列；base 视频回写 Webhook。
2. **Frontend (shadcn-admin)** — [x]
   - Avatar Library 响应式卡片 + 状态徽标；Avatar Studio 改为纯创建页
     （名称/图片/Edge-TTS 音色 + 初始化轮询）；Broadcast 播报页；Live Studio。

## Phase 3: Streaming Architecture Reboot（流式架构）

**Goal:** 引入 RTMP 流媒体网关，将 Worker 推理管线重构为
**内存 → 网络持续推流**，不再落盘 MP4。

### Step 3.1: SRS Streaming Gateway — [x]

1. ✅ 在 `docker-compose.yml` 集成 SRS（`ossrs/srs:5`）容器。
2. ✅ 端口：1935 RTMP 推流、1985 HTTP API、8081 HTTP-FLV（避免与前端 8080 冲突）。
3. ✅ 拉流经 Nginx `/live/` 代理到 `srs:8081`（内网，仅 1935 供宿主机 Worker）。

### Step 3.2: Streaming Pipeline Refactor（交互式问答）— [x]

1. ✅ 分句处理：`POST /api/live/{id}/push` 按 `。！？!?；;`/换行切句，顺序入队
   `live_queue:{id}`。
2. ✅ 内存 → RTMP：`stream_worker.py` 常驻 ffmpeg 双管道（BGR24 帧 stdin +
   s16le 音频 /dev/fd/3，视频输入 `-re` 实时节流）推流
   `rtmp://localhost:1935/live/avatar_<id>`；闲置态喂静音音频 + base 动画，
   说话态喂口型帧 + TTS 音频，管道全程不关闭。离线 MP4 逻辑保留。
3. [x] `POST /api/live/{id}/start|push|status` 已落地；LLM 链路由
   `POST /api/live/{id}/message` 完成（OpenAI Go SDK → DeepSeek Responses
   `deepseek-v4-flash` → 回复切句入 `live_queue:{id}`；无 key 时回显原文）。
   观众端已拆为**独立 Next.js + TailwindCSS 项目**（`client/`，:3000）：
   `/` 开播列表 + `/rooms/:avatarId` 直播间（xgplayer + 服务端代理）。

### Step 3.3: 7x24 Long-form Broadcast（长时直播）— [~]

1. [~] 异步多线程：闲置期间 TTS 异步预取，说话切换不等待；base 动画按流缓存
   （`LIVEPORTRAIT_IDLE_BASE_SECONDS` 控制，默认 10s）。
2. [ ] 会话保持 / 断流重连 / 多流并发资源调度（未开始）。

---

## Phase 4: 直播体验与智能升级（口型 / 性能 / 记忆 / 知识库）

**Goal:** 从「能用」走向「好用」：修复口型变形、消除直播卡顿，并让数字人
具备长期记忆与私有知识库（RAG），减少多轮对话降智与专业问答幻觉。

### Task 4.1 口型变形修复（Lip-sync Deformation）— [ ]

- **不重训 Wav2Lip**（通病：为强行匹配口型会过度扭曲下半张脸、下巴变形、
  边缘模糊）。标准解法是引入 **GFPGAN 或 CodeFormer** 做局部面部修复。
- 只在 Wav2Lip 输出的**嘴部边界框（Bounding Box）区域**应用超分修复，
  通过**羽化遮罩（Feathered Mask）**把高清嘴部贴回原帧，比全帧修复省约
  80% 计算量。
- 直播管线仅对说话段启用；离线播报成品复用同一后处理模块。

### Task 4.2 口型性能与推流卡顿（Latency / Streaming Stutter）— [ ]

- 根因：两段 10 秒处理之间的真空期会让 SRS 推流卡死。重构为
  **异步双缓冲（Asynchronous Double-Buffering）**：
  - **生产线程**：持续执行 TTS → Wav2Lip，把音视频帧压入**内存队列（Queue）**。
  - **消费推流线程**：死循环读队列写 FFmpeg stdin；队列为空时**无缝回退**
    预生成的 base 动画帧 + 静音音频，保持推流不中断，直到生产线程追上。
- 切块粒度更细（短句优先），与现有 TTS 异步预取叠加，减少单句等待。

### Task 4.3 长期记忆（Long-term Memory）— [ ]

- 聊天记录已入库（`chat_messages`），由 **Go API 侧实现滑动窗口上下文**：
  收到观众弹幕时，查询该观众最近 N 条（如 5 条）记录，按时间顺序组装
  `messages` 数组传给 DeepSeek。
- Token 控制：窗口外的旧对话丢弃，或由轻量模型做摘要（Summarization）后
  保留进上下文。

### Task 4.4 私有知识库（RAG）— [ ]

- **轻量向量检索**：不引入 Milvus/Pinecone，直接在现有 Redis 8.2 上启用
  RedisStack（RediSearch）做 KNN。
- **Embedding**：上传私有知识（TXT/PDF）→ 切段 → 轻量 Embedding API
  （如 BAAI bge-small）→ 向量入库。
- **查询与拼接**：观众提问先 Embedding → Redis KNN 检索最相关 3 条 →
  作为 `<Context>` 注入 DeepSeek System Prompt，**强制只根据知识库回答**，
  减少带货/专业问答幻觉。

## Strict Rules for Execution

1. 先给出 Phase 1 所需的精确命令与代码调整，测试通过后再进入下一阶段。
2. 不重写整个系统；模块化注入改动，保持现有 API + DB + S3 + Nginx 架构不变。
3. Phase 3 优先稳定性而非极致低延迟：先保证分句与 FFmpeg 管道不崩溃，再优化线程。
