package models

import "time"

// Task lifecycle statuses shared by the API and the AI worker.
const (
	TaskStatusPending    = "pending"
	TaskStatusProcessing = "processing"
	TaskStatusCompleted  = "completed"
	TaskStatusFailed     = "failed"
)

// Live session states reported to the Live Studio UI.
const (
	LiveStatusIdle   = "idle"
	LiveStatusActive = "active"
)

// Avatar lifecycle: the base driving video is generated asynchronously after
// creation (LivePortrait pre-processing), so avatars start as "initializing".
const (
	AvatarStatusInitializing = "initializing"
	AvatarStatusReady        = "ready"
	AvatarStatusFailed       = "failed"
)

// DefaultEdgeVoice is the fallback voice when no voiceId is supplied.
const DefaultEdgeVoice = "zh-CN-XiaoxiaoNeural"

// Avatar is a digital avatar material record. Files live in object storage;
// the database only stores their S3 keys.
type Avatar struct {
	ID              uint    `gorm:"primaryKey" json:"id"`
	Name            string  `gorm:"size:255;not null" json:"name"`
	ImageS3Key      string  `gorm:"size:512;not null" json:"imageS3Key"`
	VoiceAudioS3Key *string `gorm:"size:512" json:"voiceAudioS3Key,omitempty"`
	// VoiceID selects the Edge-TTS voice used for broadcast/live speech.
	VoiceID string `gorm:"size:64;not null;default:zh-CN-XiaoxiaoNeural" json:"voiceId"`
	// BaseVideoS3Key points to the pre-processed LivePortrait driving clip
	// (silent, 24fps) consumed by both the offline and live pipelines.
	BaseVideoS3Key *string   `gorm:"size:512" json:"baseVideoS3Key,omitempty"`
	Status         string    `gorm:"size:32;not null;default:initializing;index" json:"status"`
	CreatedAt      time.Time `json:"createdAt"`
}

// BroadcastTask is an async synthesis task queued to the AI worker.
type BroadcastTask struct {
	ID               uint      `gorm:"primaryKey" json:"id"`
	AvatarID         uint      `gorm:"not null;index" json:"avatarId"`
	ScriptText       string    `gorm:"type:text;not null" json:"scriptText"`
	Status           string    `gorm:"size:32;not null;default:pending;index" json:"status"`
	OutputVideoS3URL *string   `gorm:"size:1024" json:"outputVideoS3Url,omitempty"`
	ErrorMessage     *string   `gorm:"size:1024" json:"errorMessage,omitempty"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
	Avatar           Avatar    `gorm:"foreignKey:AvatarID" json:"avatar,omitempty"`
}

// LiveSession is a running live-stream session for one avatar. Status is
// "idle" while the worker feeds the silent base animation, and "active" while
// a text chunk is being lip-synced.
type LiveSession struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	AvatarID  uint      `gorm:"not null;uniqueIndex" json:"avatarId"`
	StreamID  string    `gorm:"size:128;not null" json:"streamId"`
	Status    string    `gorm:"size:32;not null;default:idle;index" json:"status"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}
