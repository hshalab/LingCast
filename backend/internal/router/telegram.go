package router

import (
	"github.com/gin-gonic/gin"
	"talkingavatar/backend/internal/app"
	"talkingavatar/backend/internal/config"
	"talkingavatar/backend/internal/handlers/telegram"
)

func RegisterTelegram(r *gin.Engine, cfg config.Config, deps *app.Deps) {
	tgAuthHandler := telegram.NewTelegramAuthHandler(deps.DB, cfg.TgBotToken)
	tgWebhookHandler := telegram.NewTelegramWebhookHandler(
		deps.DB, cfg.TgBotToken, cfg.NgrokAPIURL,
		cfg.TgWebhookURL, cfg.TgMiniAppURL,
	)

	api := r.Group("/api")
	{
		api.POST("/auth/telegram", tgAuthHandler.Login)
		api.POST("/telegram/webhook", tgWebhookHandler.Webhook)
	}
}
