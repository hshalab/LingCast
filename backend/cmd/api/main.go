package main

import (
	"log"

	"talkingavatar/backend/internal/config"
	"talkingavatar/backend/internal/database"
	"talkingavatar/backend/internal/queue"
	"talkingavatar/backend/internal/router"
	"talkingavatar/backend/internal/storage"
)

func main() {
	cfg := config.Load()

	db, err := database.Connect(cfg.MySQLDSN)
	if err != nil {
		log.Fatalf("connect mysql: %v", err)
	}

	s3Client, err := storage.New(cfg)
	if err != nil {
		log.Fatalf("init s3 client: %v", err)
	}

	taskQueue := queue.New(cfg.RedisAddr, cfg.RedisPassword, cfg.RedisDB, cfg.TaskQueueKey)

	r := router.New(cfg, db, s3Client, taskQueue)
	log.Printf("api server listening on :%s", cfg.ServerPort)
	if err := r.Run(":" + cfg.ServerPort); err != nil {
		log.Fatalf("server exited: %v", err)
	}
}
