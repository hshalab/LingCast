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
	router.RegisterScheduler(r, cfg, deps)

	log.Printf("api-scheduler server listening on :%s", cfg.SchedulerPort)
	if err := r.Run(":" + cfg.SchedulerPort); err != nil {
		log.Fatalf("server exited: %v", err)
	}
}
