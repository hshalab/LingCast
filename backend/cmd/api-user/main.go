package main

import (
	"context"
	"log"

	_ "talkingavatar/backend/docs"
	"talkingavatar/backend/internal/app"
	"talkingavatar/backend/internal/config"
	"talkingavatar/backend/internal/handlers"
	"talkingavatar/backend/internal/router"
)

func main() {
	cfg := config.Load()
	deps := app.Bootstrap(cfg)

	r := router.Base(cfg)
	router.RegisterUser(r, cfg, deps)

	// Discover the ngrok api-gateway public URL and register the Telegram
	// webhook in the background (retries every 2s) — never blocks startup.
	tgWebhook := handlers.NewTelegramWebhookHandler(
		deps.DB, cfg.TgBotToken, cfg.NgrokAPIURL,
		cfg.TgWebhookURL, cfg.TgMiniAppURL,
	)
	go tgWebhook.RegisterWithRetry(context.Background())

	log.Printf("api-user server listening on :%s", cfg.UserPort)
	if err := r.Run(":" + cfg.UserPort); err != nil {
		log.Fatalf("server exited: %v", err)
	}
}
