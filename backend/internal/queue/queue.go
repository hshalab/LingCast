package queue

import (
	"context"
	"encoding/json"
	"time"

	"github.com/redis/go-redis/v9"
)

// TaskPayload is the JSON message pushed to Redis and consumed by the
// Python AI worker. It carries S3 keys instead of local paths so the
// services stay decoupled from each other's filesystems.
type TaskPayload struct {
	TaskID          uint   `json:"taskId"`
	AvatarID        uint   `json:"avatarId"`
	ScriptText      string `json:"scriptText"`
	ImageS3Key      string `json:"imageS3Key"`
	VoiceAudioS3Key string `json:"voiceAudioS3Key,omitempty"`
}

// Queue wraps a Redis list used as a FIFO task queue.
type Queue struct {
	client *redis.Client
	key    string
}

func New(addr, password string, db int, key string) *Queue {
	client := redis.NewClient(&redis.Options{
		Addr:         addr,
		Password:     password,
		DB:           db,
		DialTimeout:  5 * time.Second,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 5 * time.Second,
	})
	return &Queue{client: client, key: key}
}

// Push appends a task payload to the queue (worker uses BLPOP).
func (q *Queue) Push(ctx context.Context, payload TaskPayload) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return q.client.RPush(ctx, q.key, data).Err()
}
