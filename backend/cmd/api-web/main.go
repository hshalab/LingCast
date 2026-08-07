package main

import (
	"log"

	_ "talkingavatar/backend/docs"
	"talkingavatar/backend/internal/app"
	"talkingavatar/backend/internal/config"
	"talkingavatar/backend/internal/router"
)

func main() {
	cfg := config.Load()
	deps := app.Bootstrap(cfg)

	r := router.Base(cfg)
	router.RegisterWeb(r, cfg, deps)

	log.Printf("api-web server listening on :%s", cfg.WebPort)
	if err := r.Run(":" + cfg.WebPort); err != nil {
		log.Fatalf("server exited: %v", err)
	}
}
