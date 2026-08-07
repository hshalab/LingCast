package main

import (
	"context"
	"log"

	_ "talkingavatar/backend/docs"
	"talkingavatar/backend/internal/app"
	"talkingavatar/backend/internal/config"
	"talkingavatar/backend/internal/handlers/telegram"
	"talkingavatar/backend/internal/router"
)

func main() {
	cfg := config.Load()
	deps := app.Bootstrap(cfg)

	r := router.Base(cfg)
	router.RegisterTelegram(r, cfg, deps)

	tgWebhook := telegram.NewTelegramWebhookHandler(
		deps.DB, cfg.TgBotToken, cfg.NgrokAPIURL,
		cfg.TgWebhookURL, cfg.TgMiniAppURL,
	)
	go tgWebhook.RegisterWithRetry(context.Background())

	log.Printf("api-telegram server listening on :%s", cfg.TelegramPort)
	if err := r.Run(":" + cfg.TelegramPort); err != nil {
		log.Fatalf("server exited: %v", err)
	}
}
