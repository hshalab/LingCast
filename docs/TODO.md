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
2. ✅ 端口：仅发布 1935 RTMP 供宿主机 Worker 推流；1985 HTTP API 与
   8080 HTTP-FLV 只在内网（避免向宿主机开放调试端口）。
3. ✅ 拉流经 Nginx `/live/` 代理到 `srs:8080`（内网）。

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

### Task 4.3 长期记忆（Long-term Memory）— [x]

- ✅ 已实现：Go `llmChat` 每次回复前取该数字人最近 10 条房间消息
  （`chat_messages`，按 avatar_id 作为会话）注入 System Prompt
  （user/assistant 格式），支持多轮连续对话；窗口外旧消息直接丢弃控 Token。

### Task 4.4 私有知识库（RAG）— [x]

- [x] Part 1 + 2 + 3（已重构）：知识库升级为**两级模型** —— 机器人 →
  知识库（Collection，`knowledge_collections`，同机器人下名字唯一）→ 文档
  （Document，`knowledge_documents`：text/.txt/.pdf，源文件入 S3，Go 用
  `ledongthuc/pdf` 提取 PDF 文本）；`rag-service` 微服务（zvec 全文索引 +
  Jieba 中文分词，**零模型/零下载**）负责入库 `/v1/knowledge/ingest`、
  检索 `/v1/knowledge/search`（按 avatar_id 或 collection_id 标量过滤 +
  BM25 Top-3）、删除 `/v1/knowledge/delete`、分块查看
  `/v1/knowledge/chunks`。Go 聊天端点按 avatar_id 检索该数字人全部知识库
  Top-3 注入 System Prompt；观众只发关键词时视为「想了解该主题」主动讲解。
- ✅ **检索方案演进（已落地）**：原计划「RedisStack（RediSearch）做 KNN +
  BAAI bge-small 向量化」已由 **rag-service（zvec 进程内全文索引 + 自带
  Jieba 中文分词）** 取代——不需要向量模型、不需要 RediSearch、零下载；
  Redis 已回退 `redis:8.2.2-alpine`，`worker/rag_worker.py` 停用。
- ✅ **查询与拼接**：观众提问 → rag-service 按数字人聚合 Top-3 → 作为
  `<Context>` 注入 DeepSeek System Prompt，强制只根据知识库回答，减少
  带货/专业问答幻觉；管理端可在线检索测试并查看文档分块。

---

## 近期已完成（Roadmap 之外落地）

- [x] **知识库管理后台**：入库页（`/knowledge`，文本/.txt/.pdf）+ 列表页
  （`/knowledge` 知识库列表 + `/knowledge/$id` 文档详情：创建/重命名/删除
  知识库、文档增删、按知识库在线 Top-3 检索测试）。
- [x] **聊天日志页**：`/chat-logs` 按数字人/用户 ID/日期/关键字检索 + 分页
  （`page/pageSize` + total）；机器人回复持久化 `rag_hit`/`rag_sources`，
  页面标注「命中知识库」并可展开查看命中的知识片段。
- [x] **客户端用户中心**：`/account` 身份卡（游客/账号）、注册/登录/退出、
  「我的消息」（`GET /api/chat/history?userId=`）；导航身份胶囊可点击进入；
  首页美化（Hero CTA、卡片悬停进入直播间、页脚账号中心入口）。
- [x] **直播链路稳定化**：音频切片先于视频帧写入（防 AAC 欠载）、ffmpeg
  保留 `-re`（Watchdog 兜底填帧）、Redis 断连 1s 静默退避。
- [x] **RAG 迁移到 rag-service**：compose 新增 `rag-service`（zvec FTS +
  Jieba，volume `rag-zvec-data`），`EMBED_SERVER_URL` 默认
  `http://rag-service:8001`；Redis 回退 `redis:8.2.2-alpine`（不再需要
  RediSearch），`worker/rag_worker.py` 与 `start_workers.sh` 中的 rag_worker
  已停用。
- [x] **TTS 微服务（tts-service）**：async `edge_tts.Communicate` → ffmpeg
  转 16kHz/16-bit/mono PCM WAV → 上传 S3（MinIO，S3 配置走环境变量）→ 只返回
  S3 key + 元数据，`finally` 清理临时文件；compose 内网 :8002，不发布宿主端口。
- [x] **端口收敛**：宿主机不调试，SRS 只发布 1935（RTMP 推流），1985/8081
  收回内网；`api`/`rag-service`/`tts-service` 均不发布端口；对外仅
  3000/8080/1935/6379/9000。

## Strict Rules for Execution

1. 先给出 Phase 1 所需的精确命令与代码调整，测试通过后再进入下一阶段。
2. 不重写整个系统；模块化注入改动，保持现有 API + DB + S3 + Nginx 架构不变。
3. Phase 3 优先稳定性而非极致低延迟：先保证分句与 FFmpeg 管道不崩溃，再优化线程。
