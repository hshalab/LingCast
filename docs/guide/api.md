# API 文档（Swagger 网关）

所有 HTTP 微服务都提供交互式 OpenAPI/Swagger 文档，由独立的 `docs` 网关
（nginx）聚合，经管理端 nginx 的 `/doc/` 前缀暴露：

| 前缀 | 服务 | 文档入口（本地） |
| --- | --- | --- |
| `/api-admin` | 管理端 API（gin-swagger） | [http://localhost:8080/doc/api-admin/swagger/index.html](http://localhost:8080/doc/api-admin/swagger/index.html) |
| `/api-user` | 观众端 / 直播聊天 API | [http://localhost:8080/doc/api-user/swagger/index.html](http://localhost:8080/doc/api-user/swagger/index.html) |
| `/api-scheduler` | Worker Webhook | [http://localhost:8080/doc/api-scheduler/swagger/index.html](http://localhost:8080/doc/api-scheduler/swagger/index.html) |
| `/service-rag` | 知识库服务（FastAPI /docs） | [http://localhost:8080/doc/service-rag/docs](http://localhost:8080/doc/service-rag/docs) |
| `/service-tts` | 语音服务（FastAPI /docs） | [http://localhost:8080/doc/service-tts/docs](http://localhost:8080/doc/service-tts/docs) |

> 网关落地页：<http://localhost:8080/doc/>。生产环境将 `localhost:8080` 替换为
> 实际入口域名即可；网关内部通过 `docs` 微服务的 nginx 按前缀反代到各服务。

## 鉴权说明

- 管理端写操作与 `/api/users`、`/api/admin/*`（除 login/me/logout）需要登录会话
- 观众端接口（直播/聊天/拉流）与 Worker Webhook 保持公开
