# tts-service（Edge-TTS 微服务）

生产就绪的 Edge-TTS FastAPI 微服务，遵循 **S3 共享存储** 规则：音频永远不通过
HTTP 响应或 Redis 传输，只返回 S3 Object Key。

## 数据流

1. `edge-tts`（async API，`edge_tts.Communicate`）合成语音 → 临时文件；
2. `ffmpeg`（async subprocess）转成 **16kHz / 16-bit / Mono PCM WAV**
   （Wav2Lip 下游要求的格式）；
3. `boto3` 经 `asyncio.to_thread` 上传 S3（MinIO，path-style），不阻塞事件循环；
4. 响应只返回 `s3_key` + 元数据；
5. `finally` 删除全部临时文件，容器磁盘不堆积。

S3 配置全部来自环境变量（不硬编码）：
`S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY`。

## 本地运行

```bash
cd tts-service
uv sync
export S3_ENDPOINT=http://localhost:9000
export S3_BUCKET=talking-avatar
export S3_ACCESS_KEY=minioadmin
export S3_SECRET_KEY=minioadmin
uv run uvicorn main:app --host 0.0.0.0 --port 8002
```

## API

```bash
curl http://localhost:8002/healthz

curl -X POST http://localhost:8002/v1/tts/synthesize \
  -H 'Content-Type: application/json' \
  -d '{"text": "你好，欢迎来到直播间！", "voiceId": "zh-CN-XiaoxiaoNeural"}'
```

响应（仅 S3 key + 元数据）：

```json
{
  "status": "success",
  "s3_key": "tts/20260806/3f2a...wav",
  "metadata": {
    "format": "wav",
    "sample_rate": 16000,
    "channels": 1,
    "bits": 16,
    "duration_sec": 3.2,
    "bytes": 102400,
    "voice_id": "zh-CN-XiaoxiaoNeural"
  }
}
```

## Docker

```bash
docker build -t tts-service .
docker run --rm -p 8002:8002 \
  -e S3_ENDPOINT=http://minio:9000 \
  -e S3_BUCKET=talking-avatar \
  -e S3_ACCESS_KEY=minioadmin \
  -e S3_SECRET_KEY=minioadmin \
  tts-service
```

镜像内已安装 `ffmpeg`。
