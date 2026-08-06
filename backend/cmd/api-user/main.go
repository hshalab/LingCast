package main

import (
	"log"

	"talkingavatar/backend/internal/app"
	"talkingavatar/backend/internal/config"
	"talkingavatar/backend/internal/router"
)

func main() {
	cfg := config.Load()
	deps := app.Bootstrap(cfg)

	r := router.Base(cfg)
	router.RegisterUser(r, cfg, deps)

	log.Printf("api-user server listening on :%s", cfg.UserPort)
	if err := r.Run(":" + cfg.UserPort); err != nil {
		log.Fatalf("server exited: %v", err)
	}
}
