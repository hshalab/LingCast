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

### Task 4.1 口型变形修复（Lip-sync Deformation）— [x]

- ✅ 已实现双轨人脸修复引擎（`worker/ai/enhancer.py`，纯 ONNX）：
  - **直播（GFPGANEnhancer）**：GFPGANv1.4.onnx 只修复人脸 ROI（Bounding Box），
    羽化遮罩（Feathered Mask）贴回原帧，省约 80% 计算量。
  - **离线（CodeFormerEnhancer）**：codeformer.onnx 全脸修复，
    `fidelity_weight`（w=0.6，ONNX 的 `w` 输入）可调。
- ✅ 模型下载：`uv run python download_models.py --models restoration` →
  `worker/models/restoration/{gfpgan,codeformer}/*.onnx`（已实测跑通）。
- ✅ 管线接入：`lipsync_onnx._run_batch_frames` 增强后帧；`real.py`（离线）默认
  codeformer、`stream_worker.py`（直播）默认 gfpgan，`FACE_ENHANCER=off` 可关，
  缺模型自动降级 no-op。
- [x] 实机画质验收：离线成品对比视频已放 `docs/videos/`
  （`noCodeFormer.mp4` vs `CodeFormer.mp4`），观感提升明显；后续可在不同
  形象/语速下微调 `roi_padding`/`feather_ratio`/`CODEFORMER_FIDELITY_WEIGHT`。

### Task 4.2 口型性能与推流卡顿（Latency / Streaming Stutter）— [x]

- ✅ **Watchdog 架构已落地**（`stream_worker.py`）：
  - **消费推流线程（Watchdog）**：独立线程以恒定 `fps`（默认 24）向 ffmpeg
    写帧，读 `Ready_Frames_Queue`；队列空时**立即回退** base 动画帧 + 静音音频，
    推流永不中断、播放器不转圈。
  - **生产推理线程**：异步 Edge-TTS → Wav2Lip 小批量（8 帧）产帧入队，
    首批即切换说话；连续多句无缝拼接（产帧快于实时）。
  - ffmpeg 去掉 `-re`，改由 Watchdog 在 Python 侧精确节流（避免 lag→EOF 断流）。
- [ ] 实机长播压测：多轮连续弹幕 + 长文本，观察推流/播放器是否持续无卡顿。

### Task 4.3 长期记忆（Long-term Memory）— [ ]

- 聊天记录已入库（`chat_messages`），由 **Go API 侧实现滑动窗口上下文**：
  收到观众弹幕时，查询该观众最近 N 条（如 5 条）记录，按时间顺序组装
  `messages` 数组传给 DeepSeek。
- Token 控制：窗口外的旧对话丢弃，或由轻量模型做摘要（Summarization）后
  保留进上下文。

### Task 4.4 私有知识库（RAG）— [ ]

- [~] Part 1（已提交）：`AvatarKnowledge` GORM 模型（按 avatar_id 索引隔离）、
  `POST/GET/DELETE /api/avatars/:id/knowledge`（text 或 .txt/.pdf，源文件入 S3 +
  `talking_avatar:knowledge_ingest` 队列）、worker 回写 webhook
  `POST /api/avatars/:id/knowledge/:kid/status`；管理端 Avatar Studio 编辑模式
  新增「私有知识库」面板（粘贴文本/上传文件/列表/删除，中英双语）。
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
