package config

import (
	"os"
	"strconv"
	"strings"
)

// Config aggregates all runtime configuration read from environment variables.
type Config struct {
	ServerPort string
	GinMode    string

	MySQLDSN string

	RedisAddr     string
	RedisPassword string
	RedisDB       int
	TaskQueueKey  string

	S3Endpoint      string
	S3AccessKey     string
	S3SecretKey     string
	S3Bucket        string
	S3UseSSL        bool
	S3PublicBaseURL string

	CORSOrigins []string
}

func env(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return strings.EqualFold(v, "true") || v == "1"
	}
	return fallback
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// Load reads configuration from environment variables with sensible defaults
// so the API can also be run locally against dockerized dependencies.
func Load() Config {
	return Config{
		ServerPort: env("API_PORT", "8080"),
		GinMode:    env("GIN_MODE", "debug"),
		MySQLDSN: env("MYSQL_DSN",
			"talking:talking123@tcp(127.0.0.1:3306)/talking_avatar?charset=utf8mb4&parseTime=True&loc=Local"),

		RedisAddr:     env("REDIS_ADDR", "127.0.0.1:6379"),
		RedisPassword: os.Getenv("REDIS_PASSWORD"),
		RedisDB:       envInt("REDIS_DB", 0),
		TaskQueueKey:  env("TASK_QUEUE_KEY", "talking_avatar:tasks"),

		S3Endpoint:      env("S3_ENDPOINT", "http://127.0.0.1:9000"),
		S3AccessKey:     env("S3_ACCESS_KEY", "minioadmin"),
		S3SecretKey:     env("S3_SECRET_KEY", "minioadmin"),
		S3Bucket:        env("S3_BUCKET", "talking-avatar"),
		S3UseSSL:        envBool("S3_USE_SSL", false),
		S3PublicBaseURL: env("S3_PUBLIC_BASE_URL", ""),

		CORSOrigins: splitCSV(env("CORS_ORIGINS",
			"http://localhost:5173,http://localhost:3000,http://localhost:8080")),
	}
}
