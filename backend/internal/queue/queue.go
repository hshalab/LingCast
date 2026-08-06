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
	TaskID         uint   `json:"taskId"`
	AvatarID       uint   `json:"avatarId"`
	ScriptText     string `json:"scriptText"`
	ImageS3Key     string `json:"imageS3Key"`
	BaseVideoS3Key string `json:"baseVideoS3Key,omitempty"`
	VoiceID        string `json:"voiceId,omitempty"`
}

// LiveControlPayload tells the streaming worker to start/stop the continuous
// FFmpeg pipe for an avatar's live session.
type LiveControlPayload struct {
	Action         string          `json:"action"` // "start" | "stop"
	AvatarID       uint            `json:"avatarId"`
	StreamID       string          `json:"streamId"`
	ImageS3Key     string          `json:"imageS3Key"`
	BaseVideoS3Key string          `json:"baseVideoS3Key,omitempty"`
	VoiceID        string          `json:"voiceId,omitempty"`
	LiveSettings   json.RawMessage `json:"liveSettings,omitempty"`
}

// AvatarInitPayload tells the worker to pre-process a newly created avatar
// into a silent base driving video (LivePortrait) and store it in S3.
type AvatarInitPayload struct {
	AvatarID   uint   `json:"avatarId"`
	ImageS3Key string `json:"imageS3Key"`
}

// KnowledgeIngestPayload tells the Python RAG worker to extract, chunk and
// embed one avatar's knowledge source (text or .txt/.pdf uploaded to S3).
// The worker downloads the file from S3, so the local filePath in the plan
// maps to the project's cross-service convention: S3 keys only.
type KnowledgeIngestPayload struct {
	Type        string `json:"type"` // "ingest_knowledge"
	AvatarID    uint   `json:"avatarId"`
	KnowledgeID uint   `json:"knowledgeId"`
	S3Key       string `json:"s3Key"`
	Filename    string `json:"filename,omitempty"`
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

// PushTo appends an arbitrary JSON value to a named Redis list. Used by the
// streaming queue (talking_avatar:stream_tasks) alongside the task queue.
func (q *Queue) PushTo(ctx context.Context, key string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return q.client.RPush(ctx, key, data).Err()
}

// RPushList appends a raw string to a named Redis list (e.g. a live_queue).
func (q *Queue) RPushList(ctx context.Context, key, value string) error {
	return q.client.RPush(ctx, key, value).Err()
}

// ListLen returns the length of a named Redis list.
func (q *Queue) ListLen(ctx context.Context, key string) (int64, error) {
	return q.client.LLen(ctx, key).Result()
}

// ListRange returns a slice of a named Redis list (start inclusive).
func (q *Queue) ListRange(ctx context.Context, key string, start, stop int64) ([]string, error) {
	return q.client.LRange(ctx, key, start, stop).Result()
}

// TrimList keeps only the given slice of a Redis list (used to cap history).
func (q *Queue) TrimList(ctx context.Context, key string, start, stop int64) error {
	return q.client.LTrim(ctx, key, start, stop).Err()
}

// Remove deletes an exact string value from a Redis list (LRem, count 1).
func (q *Queue) Remove(ctx context.Context, key, value string) error {
	return q.client.LRem(ctx, key, 1, value).Err()
}

// DeleteKey removes a whole Redis key (e.g. a per-avatar live queue).
func (q *Queue) DeleteKey(ctx context.Context, key string) error {
	return q.client.Del(ctx, key).Err()
}
