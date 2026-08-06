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
	router.RegisterAdmin(r, cfg, deps)

	log.Printf("api-admin server listening on :%s", cfg.AdminPort)
	if err := r.Run(":" + cfg.AdminPort); err != nil {
		log.Fatalf("server exited: %v", err)
	}
}
