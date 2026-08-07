---
layout: home

hero:
  name: LingCast
  text: 灵播 · 端到端口播数字人平台
  tagline: LivePortrait 基础动画 + Edge-TTS 语音 + Wav2Lip(ONNX) 口型合成，支持离线视频生成与实时直播。
  image:
    src: /images/logo.svg
    alt: LingCast
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/start
    - theme: alt
      text: API 文档
      link: /guide/api
    - theme: alt
      text: GitHub
      link: https://github.com/taochangle/LingCast

features:
  - title: 数字人创建与管理
    details: 形象图 + Edge-TTS 音色 + 人物设定，LivePortrait 自动生成 24fps 基础驱动视频（去眨眼、保留耸肩）。
  - title: 离线视频生成
    details: 脚本 → Edge-TTS → Wav2Lip(ONNX) 口型 → 成品 MP4，支持 CodeFormer 人脸修复。
  - title: 实时直播
    details: Watchdog 架构恒定 24fps 推流（SRS + RTMP/HTTP-FLV），队列空自动回退基础动画，播放不转圈。
  - title: 知识库 RAG + 长期记忆
    details: service-rag（zvec 全文索引）按数字人隔离检索 Top-3，注入 DeepSeek 回复，支持多轮上下文。
  - title: 微服务化
    details: api-admin / api-user / api-scheduler + service-rag / service-tts + RustFS 共享存储，文档经 Swagger 网关聚合。
  - title: 多硬件支持
    details: macOS Apple Silicon（MPS/CoreML）实测；Linux NVIDIA CUDA 与 AMD ROCm 路径已预留。
---
