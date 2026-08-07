# Talking Avatar Platform — 开发交接说明

本文档供 AI Agent 或开发者在**新设备上 clone 本仓库后**快速理解现状并继续开发。
完整的上手步骤见 [README.md](./README.md)。

## 1. 项目是什么

端到端口播数字人平台：管理后台上传形象图片 + 选择 Edge-TTS 音色创建数字人，后台用
**LivePortrait 预处理生成基础视频 + Edge-TTS 语音 + Wav2Lip(ONNX) 口型合成**生成
带声音的说话视频。

## 2. 当前技术栈（已落地，勿按旧文档改回）

- 前端：React + TypeScript + Vite + Tailwind + shadcn/ui（基于 satnaing/shadcn-admin），
  pnpm 10.25.0 管理，`frontend-admin/`。
- 后端：Go + Gin + GORM，`backend/`（模型、S3、Redis、handlers）。
- AI Worker：Python **3.11**（`worker/.python-version`），uv 管理依赖（`pyproject.toml`
  + `uv.lock`），**不要使用 requirements.txt**。
- 存储：S3 兼容对象存储（RustFS，Docker Compose 内运行）；Go 用 `aws-sdk-go-v2`，
  Python 用 boto3；服务间只传 S3 Key，不用本地路径。
- 基础设施：Docker Compose；**MariaDB 11** + **Redis 8.2.2-alpine** + RustFS
  + **rag-service**（本地 RAG 微服务：zvec 全文索引 + Jieba 中文分词，
  Docker 内 `rag-service/`，端口 8001，零模型依赖）+ **tts-service**
  （Edge-TTS 微服务：async edge-tts → 16kHz PCM WAV → S3，`tts-service/`，
  端口 8002，S3 共享存储，媒体不过 HTTP）。
- 部署模式：Docker 里跑基础设施 + API + 前端 + 轻量 Mock Worker；**真实 AI Worker
  在宿主机原生运行**：macOS Apple Silicon（MPS/CoreML）、Linux NVIDIA CUDA、
  Linux **AMD ROCm**（RX 6800 XT 等 RDNA2，见 README 对应章节）。宿主机仅开放
  必要端口：3000（观众端）/ 8080（管理端）/ 1935（RTMP 推流）/ 6379（Redis）/
  9000（RustFS）；`api-admin`/`api-user`/`api-scheduler`、`rag-service`、
  `tts-service` 均在内网，不发布端口。
- 依赖组（`worker/pyproject.toml`）：`models`（macOS 默认）、`cuda`、
  `rocm`（仅 `onnxruntime-rocm`，torch 用官方 ROCm 镜像或手动装）——cuda/rocm
  互斥，Linux 用 `--no-group` 二选一；ROCm 容器里 `uv sync` 必须加 `--inexact`
  保留镜像预装的 torch。

## 3. 当前实现状态

- ✅ Avatar Studio（创建）：形象名称/头像展示/图片/Edge-TTS 音色（localStorage 缓存，
  默认 zh-CN-XiaoxiaoNeural）+ 人物设定（年龄/身高/体重/族裔/感情状态/性格），提交后
  轮询 `GET /api/avatars/:id` 直到 ready。
- ✅ Broadcast（离线播报）页面：选数字人 + 脚本 → 任务轮询 → 播放成品。
- ✅ 客户端直播间（观众端）：**独立 Next.js + TailwindCSS 项目**（`frontend-user/`，端口
  **3000**，不属于管理后台）——首页有导航头（身份/注册/登录/退出）与**分类筛选**
  （`GET /api/live` 携带 avatar 的 `category`），`app/rooms/[avatarId]/page.tsx`
  用 xgplayer 拉 HTTP-FLV + 聊天输入 `POST /api/live/:id/message`；`app/api/[...path]`
  与 `app/live/[...path]` 路由处理器在**服务端**代理（`API_ORIGIN` / `LIVE_ORIGIN`
  运行时读取，docker 内为 `http://api-user:8082` / `http://srs:8080`，本地默认
  `http://localhost:8080`）。
- ✅ 聊天身份与记录持久化：`chat_users`（游客/账号，bcrypt）与 `chat_messages`
  （user/bot）两张表；`POST /api/chat/guest` 发临时身份，`register` 原地升级游客行
  （同一 userId 保住历史），`login` 把当前游客的消息合并进账号，退出后重新取新游客
  ID；`GET /api/chat/history?avatarId=` 拉持久化聊天记录；客户端身份存
  localStorage（`tav_chat_identity`），由 `IdentityProvider` 全局管理，注册/登录弹窗
  首页与直播间共用。`POST /api/live/:id/message` 会同时入库用户消息与机器人完整回复。
- ✅ 字幕配置：Avatar 表新增 JSON 字段 `live_settings`
  （`subtitleEnabled/subtitleFont/subtitlePosition/subtitleBorder/subtitleSize`），
  `PUT /api/avatars/:id/live-settings` 读写；start 控制消息与 `GET /api/live` 都会带
  上配置；worker 的 `SubtitleRenderer` 支持顶部/底部、描边宽度、字号，字体按文件名
  从 `worker/fonts/` 解析（缺失回退系统默认）；Live Studio「字幕设置」卡片保存后自动
  重启直播生效。
- ✅ 管理端用户列表：`GET /api/users`（游客+账号，含消息数），侧边栏「用户相关 →
  用户列表」（/users）展示真实数据。
- ✅ 国际化（中/英）：管理端（react-i18next，`frontend-admin/src/i18n/`）与观众端
  （`frontend-user/lib/i18n.tsx` 轻量 provider）均有语言切换（localStorage 记忆 +
  浏览器语言自动检测）；后端按 `Accept-Language` 本地化错误消息
  （`backend/internal/i18n`，router 注入中间件）；LLM 人设提示词按请求语言生成
  （`chatSystemPrompt(avatar, lang)`，含 `en` 单测）。
- ✅ Live Studio 悬浮监看：页内播放器已移除，改为右下角圆形 FAB，点击弹出可拖动的
  9:16 浮窗（默认不渲染，按需开启）。
- ✅ LLM 回复链路：Go 后端用 `github.com/openai/openai-go` Responses API 调 DeepSeek
  （`OPENAI_BASE_URL=https://api.deepseek.com`、`OPENAI_MODEL=deepseek-v4-flash`，
  该模型是 DeepSeek 唯一支持 Responses 的模型），回复 `splitSentences` 入
  `live_queue:{id}` + `live_history:{id}`；`chatSystemPrompt()` 会把 Avatar 的人物
  设定拼进 system prompt（有单测 `live_test.go`）；无 `OPENAI_API_KEY` 时原样回读输入。
- ✅ Go API：`POST /api/avatars`、`GET /api/avatars`、`POST /api/tasks`、
  `GET /api/tasks/:id`、`POST /api/tasks/:id/status`（Worker 回调）。
- ✅ 管理员登录：`POST /api/admin/login` 校验 `ADMIN_USERNAME`/`ADMIN_PASSWORD`
  （默认 admin/admin123，务必修改），Redis 存 24h 会话 + HttpOnly cookie
  `admin_token`；`GET /api/admin/me` 校验、`POST /api/admin/logout` 退出。前端
  `/login` 登录页 + `_authenticated` 路由 `beforeLoad` 守卫；管理端写操作与
  `/api/users` 走 `RequireAdmin()` 中间件，观众端接口与 Worker Webhook 保持公开。
  账号首次启动时按 env 播种到 `admin_users` 表，之后可通过
  `POST /api/admin/change-name|change-password` 修改并持久化（登录返回
  username + displayName，侧边栏显示 displayName）。
- ✅ 两段式管线：创建时 `avatar_init` 队列 → LivePortrait 生成静音 24fps base 视频
  上传 S3 并回写 `base_video_s3_key`/`status`；使用时 **Edge-TTS**（`TTS_ENGINE=edge`，
  零 GPU，默认）→ Wav2Lip ONNX（CoreML 优先）→ mux/推流。GPT-SoVITS 为**遗留可选**
  引擎（代码仍在 `ai/tts_real.py`，权重不入库需自行下载）。LivePortrait 不再出现在
  广播/直播循环里。
- ✅ 直播管线 `stream_worker.py`（闲置/说话循环）：`POST /api/live/{id}/start`
  通知 Worker 打开**常驻 FFmpeg 管道**（闲置态喂 base 动画 + numpy 静音音频）；
  `POST /api/live/{id}/push` 按句切块入 `live_queue:{id}` → 异步 TTS → Wav2Lip
  内存出帧 → 口型帧 + TTS 音频替换推流，句子结束自动回闲置，管道不关闭。
  `GET /api/live/{id}/status` 供前端轮询队列。SRS v5 已入 docker-compose
  （仅发布 1935 RTMP 供宿主机 Worker 推流；1985 API / 8080 HTTP-FLV 只在内网，
  Nginx `/live/` 代理到 srs:8080）。
- ✅ `worker/download_models.py --models all`：克隆外部代码、下载权重、导出
  wav2lip ONNX、创建软链接（一键可复现）。
- ✅ 性能：16 秒视频口型阶段约 10 秒；CPU 线程数受限（`WAV2LIP_THREADS`，默认 4）。
- ✅ 动画节奏可调：默认驱动模板 d5.pkl，另有 `LIVEPORTRAIT_DRIVING_SPEED` /
  `LIVEPORTRAIT_DRIVING_MULTIPLIER` 两个旋钮。
- ✅ 基础视频默认去眨眼：`renderer_real.py` 冻结眼部表情通道（`EYE_EXP_DIMS`
  取首帧值，`c_eyes/c_d_eyes_lst` 全帧复制首帧），保留耸肩/身体微晃；
  `.env.local` 设 `LIVEPORTRAIT_DRIVING_SPEED=0.2`（约 3s 一次耸肩）。
- ✅ 播报成品预览：`broadcast/index.tsx` 状态卡片用 `VideoPlayerDialog`
  （xgplayer 封装），9:16 竖版最大 720×1080，模态窗播放。
- ✅ 人脸修复（Wav2Lip 口型变形）：`worker/ai/enhancer.py` 双轨 ONNX 增强器——
  离线 CodeFormer（`w` 输入保真度，默认 0.6）、直播 GFPGANv1.4（人脸 ROI + 羽化
  遮罩）；接入 `lipsync_onnx._run_batch_frames`（offline `real.py` 默认 codeformer；
  **直播管线完全不用人脸增强**——Watchdog 架构要求恒定 24fps，见下方直播条目）；
  模型放 `worker/models/restoration/`，
  `uv run python download_models.py --models restoration` 下载；缺模型自动降级为
  no-op 不中断管线。离线效果已验收，对比视频在 `docs/videos/`
  （`noCodeFormer.mp4` vs `CodeFormer.mp4`）。
- ✅ 直播 **Watchdog 架构**（`stream_worker.py`）：独立写帧线程以恒定
  `fps`（默认 24）向 ffmpeg 写帧，读 `Ready_Frames_Queue`；队列空时**立即回退**
  base 动画帧 + 静音音频，玩家永不转圈。推理线程异步 Edge-TTS → Wav2Lip 小批量
  （8 帧）产帧入队，首批即切换说话，连续多句无缝拼接。ffmpeg 视频输入保留
  `-re`（Watchdog 兜底填帧，避免旧版 lag→EOF 复现）。管道断裂
  （`FFmpegPipeClosedError`）会让 session 标记 dead 并停止喂帧，控制监听器
  自动清理后可重新开播；Redis 断连时 1s 静默退避。
- ✅ 私有知识库（两级模型：机器人 → 知识库 Collection → 文档 Document，RAG）：
  - 存储：`knowledge_collections`（avatar_id + name，同机器人下唯一）+
    `knowledge_documents`（collection_id + content + status + source_key）两张表；
    源文件入 S3（text 生成 .txt，支持上传 .txt/.pdf，Go 用
    `github.com/ledongthuc/pdf` 提取 PDF 文本）。
  - 微服务：`rag-service/`（FastAPI + uv + zvec 全文索引，Jieba 中文分词，
    **零模型/零下载**）。Go 入库时同步 POST `/v1/knowledge/ingest`
    （`avatar_id/collection_id/source_id/text_content`），检索 POST
    `/v1/knowledge/search`（按 `avatar_id` 或 `collection_id` 标量过滤 +
    BM25 Top-3），删除走 `/v1/knowledge/delete`；数据持久化在 volume
    `rag-zvec-data:/app/zvec_data`。
  - 管理后台：`/knowledge` 知识库列表（创建/重命名/删除，删除级联清文档与索引），
    `/knowledge/$id` 知识库详情（文档增删 + 检索测试）；Avatar Studio 编辑模式
    显示该数字人的知识库概览；聊天日志页显示「命中知识库」。
  - Go 聊天端点：`llmChat` 取最近 10 条房间消息（长期记忆）+ 按 `avatar_id`
    检索该数字人全部知识库的 Top-3 注入 System Prompt（严格按知识库回答）。
  - Go 侧 `EMBED_SERVER_URL` 默认 `http://rag-service:8001`（compose 内网）。
  - ⚠️ 旧 `worker/rag_worker.py`（bge 向量 + RediSearch）已删除，相关依赖
    （pymupdf / sentence-transformers）已从 `worker/pyproject.toml` 移除；
    `redis/redis-stack-server` 已回退为 `redis:8.2.2-alpine`。
- ✅ TTS 试听走微服务：`POST /api/tts/preview` 由 api-admin 代理到
  `tts-service` 的 `/v1/tts/preview`（一次性试听，直接返回音频字节、不走
  S3）；`backend/Dockerfile` 不再捆绑 python3 / edge-tts，正式合成仍走
  `/v1/tts/synthesize` → S3 共享存储。
- ⬜ Mock 管线（`AI_MODE=mock`，Docker Worker 镜像默认）仅为占位/轻量演示。
- ✅ 客户端用户中心：`frontend-user/app/account/page.tsx`（`/account`）身份卡 +
  注册/登录/退出 + 「我的消息」（`GET /api/chat/history?userId=`）；导航身份
  胶囊点击进入；首页 Hero CTA / 卡片悬停 / 页脚入口。
- ⬜ 待办（详见 [docs/TODO.md](docs/TODO.md)）：Phase 1 的 AMD ROCm 容器
  Dockerfile 与实机验证、Phase 4.2 实机长播压测。
- ⬜ Linux/CUDA 生产部署未实测（代码路径已预留）。

## 4. 目录速览

```text
backend/   Go API（Dockerfile）
rag-service/  本地 RAG 知识库微服务（FastAPI + uv + zvec FTS/Jieba，端口 8001）
tts-service/  Edge-TTS 微服务（FastAPI + uv + edge-tts + ffmpeg，端口 8002，内网）
frontend-admin/  React 管理后台（Dockerfile + nginx.conf）
  src/features/knowledge/      知识库管理（index=Collection 列表 / detail=文档）
frontend-user/    Next.js 观众端（独立项目）：app/page.tsx 列表 + app/rooms/[avatarId] 直播间
  lib/identity.tsx      全局聊天身份（游客/注册/登录/退出）
  components/auth-modal.tsx  注册/登录弹窗
worker/
  worker.py              Worker 入口（Redis 队列、S3、Webhook 回调）
  download_models.py     一键克隆代码 + 下载/导出模型
  ai/
    real.py              RealPipeline：TTS → 渲染 → 口型
    lipsync_onnx.py      另有 iter_frames()/audio_pcm16() 供流式内存推理
    tts_real.py          GPT-SoVITS（本地 API server 模式）
    renderer_real.py     LivePortrait 渲染（含模板放慢/幅度调节）
    lipsync_onnx.py      Wav2Lip ONNX 口型（CoreML/CPU）
    face_detect_onnx.py  SCRFD ONNX 人脸检测
    onnx_utils.py        ONNX session 构建（线程限制、provider 选择）
    lipsync_real.py      torch 版 Wav2Lip（慢，仅 WAV2LIP_BACKEND=torch 对照用）
  external/  gitignore，外部推理仓库克隆（GPT-SoVITS/LivePortrait/Wav2Lip）
  models/    gitignore，权重（见下方“模型目录”）
  streaming/ffmpeg_pipe.py   ffmpeg 子进程管道（双输入，音频走 /dev/fd/3）
  streaming/subtitle.py      Pillow 字幕渲染（位置/边框/字号可配）
  fonts/                     gitignore：用户下载的免费字体（见 fonts/README.md）
  stream_worker.py       流式 Worker 入口（闲置/说话循环，与 worker.py 并存）
```

## 5. 关键约定

- 所有 Python 命令一律 `cd worker && uv run python ...`；新增依赖用 `uv add`，
  不写 requirements.txt。
- S3 环境变量双命名兼容：`S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY/S3_BUCKET`
  为项目主约定，同时接受 `RUSTFS_ENDPOINT_URL/AWS_ACCESS_KEY_ID/
  AWS_SECRET_ACCESS_KEY/S3_BUCKET_NAME` 别名（path-style，RustFS/MinIO 通用）。
- 任务队列双格式：`{type:"render",text,tts_s3_key,base_video_s3_key}`（S3
  共享存储）与旧 `{taskId,imageS3Key,scriptText,...}` 并存；render 任务按
  `type` 或按键识别分发，TTS wav 下载后由 `finally` 清理，base 视频走 LRU 缓存。
- S3 是唯一的跨服务文件通道：上传/下载都走 S3 Key/URL，不在服务间传本地路径。
- AI 逻辑与 S3/Redis 编排解耦：新模型实现 `InferencePipeline`，在
  `worker/ai/factory.py` 注册，通过 `AI_MODE` 切换。
- 权重/外部代码永不入库（`worker/models/`、`worker/external/` 已 gitignore）。
- 直播字幕字体放 `worker/fonts/`（gitignore，仅 README 入库）；设置里存的是文件名，
  换新设备需连同字体一起拷贝。
- 直播相关配置（如字幕）持久化为 Avatar 的 JSON 字段 `live_settings`，worker 通过
  start 控制消息获取；改配置后需重新 start 直播（Live Studio 保存时会自动重启）。
- 提交信息沿用仓库现有风格：`feat:` / `fix:` / `docs:` / `refactor:` 前缀 + 中文或
  英文描述。
- 修改涉及外部仓库（GPT-SoVITS/LivePortrait/Wav2Lip）时优先在 `worker/ai/` 里做
  适配层，避免直接改外部代码（升级可替换）。

## 6. 新设备快速启动（摘要）

```bash
git clone https://github.com/taochangle/LingCast.git && cd LingCast
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
- **NLTK 版本**：必须 <3.10（已 pin）；仅在 `TTS_ENGINE=gpt-sovits` 时才下载数据
  （默认 Edge-TTS 不需要）。
- **onnxruntime**：macOS 用官方 wheel（`onnxruntime>=1.17`），不要装
  `onnxruntime-silicon`（1.16.3 的命名空间包不完整）。
- **onnxruntime-rocm 与 onnxruntime 互斥**：Linux x86_64 装 rocm 组时需
  `--no-group cuda`；反之亦然，二者都提供 `onnxruntime` 包。
- **口型别用 torch 后端**：`WAV2LIP_BACKEND` 默认 onnx；torch 版在 Apple Silicon
  上要 8 分钟且打满 CPU，仅作对照。
- **ROCm 上口型走 CPU 兜底**：`WAV2LIP_PROVIDER=rocm` 时若 LSTM 算子不在 ROCm EP
  支持集内会自动逐节点回退 CPU，不影响结果。
- **Edge-TTS 需要外网**：语音合成走微软在线服务（默认引擎）；离线环境不可用。
- **G2PW 中文前端**（仅 gpt-sovits 引擎）：首次使用会从 ModelScope 下载约 1.2GB。
- **ffmpeg**：宿主机需 `brew install ffmpeg`（torchcodec 依赖）。
- **任务卡在 processing**：先看 worker 日志尾部；口型阶段卡住多半是用了旧 torch
  后端或模型缺失（`download_models.py --models wav2lip` 可补齐）。
- **直播推流没画面**：先确认 `docker compose up` 里 srs 健康、`/live/<id>.flv`
  可拉流；ffmpeg 日志在 `stream-<id>/ffmpeg.log`。音频必须与视频交错写（见
  ffmpeg_pipe.py 顶部说明），否则双管道死锁。
- **字幕字体不生效**：确认文件名与 `worker/fonts/` 里的文件一致（含扩展名），
  缺文件会自动回退系统默认字体并打 warning 日志。
- **闲置/说话切换崩溃**：两种状态的帧率与分辨率必须一致（都来自同一 base 片段）；
  视频输入带 `-re` 实时节流，勿删除。
