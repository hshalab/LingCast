// Package app holds the shared dependency bootstrap used by the three API
// microservices (api-admin, api-live, api-scheduler). They all share the same
// MariaDB / Redis / RustFS / queue configuration from environment variables.
package app

import (
	"log"

	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"

	"talkingavatar/backend/internal/config"
	"talkingavatar/backend/internal/database"
	"talkingavatar/backend/internal/queue"
	"talkingavatar/backend/internal/storage"
)

// Deps are the shared dependencies wired by Bootstrap.
type Deps struct {
	DB    *gorm.DB
	S3    *storage.Client
	Queue *queue.Queue
	Redis *redis.Client
}

// Bootstrap connects MariaDB, S3, Redis and the task queue. Failures are
// fatal — a service that cannot reach its data layer must not half-start.
func Bootstrap(cfg config.Config) *Deps {
	db, err := database.Connect(cfg.MySQLDSN, cfg.EmbedServerURL)
	if err != nil {
		log.Fatalf("connect mysql: %v", err)
	}

	s3Client, err := storage.New(cfg)
	if err != nil {
		log.Fatalf("init s3 client: %v", err)
	}

	taskQueue := queue.New(cfg.RedisAddr, cfg.RedisPassword, cfg.RedisDB, cfg.TaskQueueKey)
	redisClient := redis.NewClient(&redis.Options{
		Addr:     cfg.RedisAddr,
		Password: cfg.RedisPassword,
		DB:       cfg.RedisDB,
	})

	return &Deps{DB: db, S3: s3Client, Queue: taskQueue, Redis: redisClient}
}
