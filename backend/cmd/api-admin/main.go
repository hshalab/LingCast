// LingCast API — admin console microservice.
// @title LingCast API
// @version 1.0.0
// @description LingCast 数字人直播平台 API（api-admin / api-user / api-scheduler 共用一份 OpenAPI 文档；管理端写操作与 /users、/admin/* 需登录会话，观众端与 Worker Webhook 公开）。
// @host localhost:8080
// @BasePath /api
package main

import (
	"log"

	"talkingavatar/backend/internal/app"
	"talkingavatar/backend/internal/config"
	"talkingavatar/backend/internal/router"
	_ "talkingavatar/backend/docs"
)

func main() {
	cfg := config.Load()
	deps := app.Bootstrap(cfg)

	r := router.Base(cfg)
	router.RegisterAdmin(r, cfg, deps)

	log.Printf("api-admin server listening on :%s", cfg.AdminPort)
	if err := r.Run(":" + cfg.AdminPort); err != nil {
		log.Fatalf("server exited: %v", err)
	}
}
