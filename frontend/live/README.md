# Talking Avatar 客户端（观众端）

独立的 Next.js + TailwindCSS 项目，面向观众：查看开播机器人、进入房间、观看直播并
发消息给数字人。**不属于管理后台**。

## 本地开发

```bash
cd frontend/live
cp .env.example .env.local   # API_ORIGIN 默认 http://localhost:8080
pnpm install
pnpm dev                     # http://localhost:3000
```

`next.config.ts` 会把 `/api/*` 与 `/live/*` 在服务端代理到 `API_ORIGIN`
（默认宿主机 `http://localhost:8080`），因此浏览器无需处理 CORS。

## 生产构建（可选的 Docker 部署）

```bash
docker compose build frontend-live && docker compose up -d frontend-live   # http://localhost:3000
```

## 页面

- `/`：开播数字人列表（`GET /api/live`，3s 轮询）
- `/rooms/:avatarId`：直播间（xgplayer 拉 HTTP-FLV + 聊天输入
  `POST /api/live/:avatarId/message`，2s 轮询开播状态）
