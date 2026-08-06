# lingcast-admin（管理后台）

灵播 LingCast 的管理后台：数字人管理、视频生成、直播台、任务中心、知识库、
用户与聊天日志。基于 shadcn-admin 模板改造（React + TypeScript + Vite +
Tailwind + shadcn/ui）。

## 技术栈

- React 19 + TypeScript + Vite + TanStack Router
- Tailwind CSS v4 + shadcn/ui
- react-i18next（中 / 英，localStorage 记忆 + 浏览器语言检测）
- pnpm 10

## 本地开发

```bash
pnpm install
pnpm dev        # http://localhost:5173（走 Vite 代理 /api → localhost:8080）
```

## 构建 / 部署

```bash
pnpm build      # 产物在 dist/
docker compose up -d --build frontend-admin   # http://localhost:8080
```

`nginx.conf` 将 `/api/*` 代理到 api-admin、`/media/*` 代理到 RustFS、
`/live/*` 代理到 SRS，worker 回调路由到 api-scheduler。

## 主要页面

- `/avatar-library` 数字人列表（创建 / 编辑 / 删除、默认视频预览、重新生成）
- `/avatar-studio` 数字人创建 / 编辑（数字人的二级页面）
- `/knowledge` 知识库（Collection → 文档）
- `/broadcast` 视频生成（离线口播）
- `/live-studio` 直播台
- `/task-center` 任务中心
- `/users` 用户列表、`/chat-logs` 聊天日志
