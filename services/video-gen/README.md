# video-gen-service

视频生成微服务（FastAPI + uv，端口 8003，内网）。

- 职责：provider 注册表 + Redis 任务队列（`VIDEO_GEN_QUEUE_KEY`，默认
  `talking_avatar:video_gen`），只做任务分发，不跑推理。
- 重活（LivePortrait 等）在宿主机 AI Worker 上执行：Worker 弹出队列 →
  provider 渲染 → 上传 S3 → 回调 Go 完成接口
  `POST /api/scene-videos/:id/complete`。
- 媒体只走 S3，HTTP 上只传 S3 Key。

接口：

- `POST /v1/video-gen/jobs`：提交生成任务
  `{sceneVideoId, avatarId, sceneId, sourceImageS3Key, provider, settings}`
- `GET /v1/video-gen/providers`：列出已注册 provider

当前 provider：

- `liveportrait`：可用（宿主机 Worker 执行）
- `comfyui`：预留（规划中）
