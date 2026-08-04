# Talking Avatar Platform (口播数字人系统)

轻量级端到端 AI 数字人合成平台：管理后台（React + shadcn-admin）、Go (Gin + GORM) API 控制面、Python AI 推理 Worker（boto3 + Redis），以及 S3 兼容对象存储层（开发环境用 MinIO 模拟 RustFS）。

## 架构

```text
浏览器 ──> Nginx (frontend, 唯一对外端口)
             ├── /api    ──> Go API (Gin) ──> MariaDB / Redis / S3
             └── /media  ──> MinIO (S3 兼容, 模拟 RustFS)

Python AI Worker ──> Redis 队列 / boto3 下载素材
                  ──> Mock 推理 (sleep 10s + ffmpeg 合成占位视频)
                  ──> 上传产物到 S3, 通过 Webhook 回写任务状态
```

MariaDB、Redis、对象存储、API、Worker 均只在内网通信，不对宿主机开放端口。

## 快速开始

```bash
cp .env.example .env
docker compose up --build
```

然后访问 <http://localhost:8080>，左侧菜单进入 **Avatar Studio**。

本地前端开发（Vite，端口 5173）：

```bash
cd frontend
cp .env.example .env.local   # VITE_API_BASE_URL=http://localhost:8080
pnpm install
pnpm dev
```

## 数据流

1. 前端上传形象图片（必填）与克隆音频（可选），`POST /api/avatars` 直传对象存储，S3 Key 存入 MariaDB。
2. 提交播报脚本，`POST /api/tasks` 创建任务并把 `{taskId, avatarId, scriptText, imageS3Key, voiceAudioS3Key}` 压入 Redis 队列。
3. Worker 通过 `boto3` 下载素材到本地 `/tmp`，执行 AI 管线（当前为 Mock：睡眠 10 秒后用 ffmpeg 渲染占位视频）。
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

AI 逻辑与 S3/Redis 编排完全解耦：

1. 在 `worker/ai/` 下实现 `InferencePipeline`（参考 `MockPipeline`）。
2. 在 `worker/ai/factory.py` 注册新管线，例如 `{"liveportrait": LivePortraitPipeline}`。
3. 设置环境变量 `AI_MODE=liveportrait` 重启 Worker。

## 生产注意事项

- 开发环境通过 MinIO 模拟 RustFS，并开放了 bucket 的公开读权限（便于浏览器直接播放视频）。生产环境应改用真实 RustFS 并使用私有 bucket + 预签名 URL，调整 `S3_PUBLIC_BASE_URL` 与 nginx `/media` 代理。
- 生产环境请收紧 Worker 回调 Webhook 的鉴权。
