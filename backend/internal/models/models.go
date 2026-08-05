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
	AvatarStatusSkipped      = "skipped"
)

// DefaultEdgeVoice is the fallback voice when no voiceId is supplied.
const DefaultEdgeVoice = "zh-CN-XiaoxiaoNeural"

// LiveSettings is the per-avatar live-streaming configuration persisted as a
// JSON string on the avatar row (subtitles: on/off, font file, position,
// border width and size). Unknown fields are ignored by both sides.
type LiveSettings struct {
	SubtitleEnabled  bool   `json:"subtitleEnabled"`
	SubtitleFont     string `json:"subtitleFont"`     // font filename in worker/fonts/, "" = system default
	SubtitlePosition string `json:"subtitlePosition"` // "bottom" | "top"
	SubtitleBorder   int    `json:"subtitleBorder"`   // stroke width in px (0 = none)
	SubtitleSize     int    `json:"subtitleSize"`     // px
}

// DefaultLiveSettings is applied when an avatar has no saved settings yet.
func DefaultLiveSettings() LiveSettings {
	return LiveSettings{
		SubtitleEnabled:  true,
		SubtitlePosition: "bottom",
		SubtitleBorder:   2,
		SubtitleSize:     46,
	}
}

// Avatar is a digital avatar material record. Files live in object storage;
// the database only stores their S3 keys.
type Avatar struct {
	ID         uint   `gorm:"primaryKey" json:"id"`
	Name       string `gorm:"size:255;not null" json:"name"`
	ImageS3Key string `gorm:"size:512;not null" json:"imageS3Key"`
	// Category groups avatars for the audience home page filter
	// (闲聊/知识/娱乐/游戏/带货/其他; empty -> 其他).
	Category string `gorm:"size:32;not null;default:其他" json:"category"`
	// VoiceID selects the Edge-TTS voice used for broadcast/live speech.
	VoiceID string `gorm:"size:64;not null;default:zh-CN-XiaoxiaoNeural" json:"voiceId"`
	// BaseVideoS3Key points to the pre-processed LivePortrait driving clip
	// (silent, 24fps) consumed by both the offline and live pipelines.
	BaseVideoS3Key *string `gorm:"size:512" json:"baseVideoS3Key,omitempty"`
	Status         string  `gorm:"size:32;not null;default:initializing;index" json:"status"`
	// LiveSettings holds the JSON-serialized models.LiveSettings.
	LiveSettings string    `gorm:"type:text;not null;default:'{}'" json:"-"`
	CreatedAt    time.Time `json:"createdAt"`
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

// ChatUser is a chat identity. Guests are auto-created rows without a
// password; registering upgrades the guest row (same ID -> history kept),
// logging in merges the guest's messages into the existing account.
type ChatUser struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	Username     string    `gorm:"size:64;not null;uniqueIndex" json:"username"`
	PasswordHash string    `gorm:"size:255" json:"-"`
	IsGuest      bool      `gorm:"not null;default:true;index" json:"isGuest"`
	CreatedAt    time.Time `json:"createdAt"`
}

// ChatMessage is one persisted line of a room chat: a viewer message or the
// bot's reply (role = user | bot, username snapshot at send time).
type ChatMessage struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	AvatarID  uint      `gorm:"not null;index" json:"avatarId"`
	UserID    uint      `gorm:"not null;index" json:"userId"`
	Username  string    `gorm:"size:64;not null" json:"username"`
	Role      string    `gorm:"size:16;not null;index" json:"role"` // user | bot
	Content   string    `gorm:"type:text;not null" json:"content"`
	CreatedAt time.Time `json:"createdAt"`
}
