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
	// Persona profile: used both as creation metadata and as the built-in
	// prompt for LLM chat (age/height/weight/ethnicity/relationship/personality).
	Age                *int   `gorm:"null" json:"age,omitempty"`
	HeightCm           *int   `gorm:"null" json:"heightCm,omitempty"`
	WeightKg           *int   `gorm:"null" json:"weightKg,omitempty"`
	Ethnicity          string `gorm:"size:32" json:"ethnicity,omitempty"`
	RelationshipStatus string `gorm:"size:16" json:"relationshipStatus,omitempty"`
	Personality        string `gorm:"size:255" json:"personality,omitempty"`
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

// AvatarVideo is an extra driving video for an avatar (multiple styles).
// The avatar's default base video (avatars.base_video_s3_key) is exposed as
// a `system` entry by the API; rows here are user uploads (e.g. clips made
// with other AI tools) that the broadcast page can pick instead.
type AvatarVideo struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	AvatarID  uint      `gorm:"not null;index" json:"avatarId"`
	Name      string    `gorm:"size:128" json:"name"`
	S3Key     string    `gorm:"size:512;not null" json:"s3Key"`
	Source    string    `gorm:"size:16;not null;default:upload" json:"source"` // upload
	CreatedAt time.Time `json:"createdAt"`
}

// BroadcastTask is an async synthesis task queued to the AI worker.
type BroadcastTask struct {
	ID               uint      `gorm:"primaryKey" json:"id"`
	AvatarID         uint      `gorm:"not null;index" json:"avatarId"`
	ScriptText       string    `gorm:"type:text;not null" json:"scriptText"`
	Status           string    `gorm:"size:32;not null;default:pending;index" json:"status"`
	// Progress is the worker-reported percentage (0-100) while processing.
	Progress         int       `gorm:"not null;default:0" json:"progress"`
	// Stage is the worker-reported pipeline step: tts | lipsync | mux.
	Stage            string    `gorm:"size:16;not null;default:''" json:"stage,omitempty"`
	// TtsS3Key caches the synthesized TTS wav (S3) so a retry can reuse it.
	TtsS3Key         *string   `gorm:"size:512" json:"ttsS3Key,omitempty"`
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
	ID         uint      `gorm:"primaryKey" json:"id"`
	AvatarID   uint      `gorm:"not null;index" json:"avatarId"`
	UserID     uint      `gorm:"not null;index" json:"userId"`
	Username   string    `gorm:"size:64;not null" json:"username"`
	Role       string    `gorm:"size:16;not null;index" json:"role"` // user | bot
	Content    string    `gorm:"type:text;not null" json:"content"`
	RAGHit     bool      `gorm:"not null;default:false;index" json:"ragHit"` // bot reply used knowledge base facts
	RAGSources string    `gorm:"type:text" json:"ragSources"`                // JSON array of the retrieved fact chunks
	CreatedAt  time.Time `json:"createdAt"`
}

// AdminUser is the management-backend account. The row is seeded from
// ADMIN_USERNAME/ADMIN_PASSWORD on first start; afterwards name and password
// are editable through the API and persist in MariaDB.
type AdminUser struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	Username     string    `gorm:"size:64;not null;uniqueIndex" json:"username"`
	DisplayName  string    `gorm:"size:64;not null" json:"name"`
	PasswordHash string    `gorm:"size:255;not null" json:"-"`
	CreatedAt    time.Time `json:"createdAt"`
}

// Knowledge ingestion lifecycle.
const (
	KnowledgeStatusPending = "pending" // row created, not ingested yet
	KnowledgeStatusIndexed = "indexed" // chunks indexed into rag-service (RAG-ready)
	KnowledgeStatusFailed  = "failed"  // extraction/ingest failed (see content)
)

// KnowledgeCollection is a named knowledge base (zvec "collection" concept)
// that belongs to exactly one avatar. Documents live under a collection.
type KnowledgeCollection struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	AvatarID  uint      `gorm:"not null;index;uniqueIndex:idx_collection_avatar_name" json:"avatarId"`
	Name      string    `gorm:"size:128;not null;uniqueIndex:idx_collection_avatar_name" json:"name"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// KnowledgeDocument is one source document (raw text or uploaded .txt/.pdf)
// inside a knowledge collection. It is chunked and indexed into rag-service;
// the DB row mirrors the rag-service chunks via collection_id + source_id.
type KnowledgeDocument struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	CollectionID uint      `gorm:"not null;index" json:"collectionId"`
	Content      string    `gorm:"type:text;not null" json:"content"` // extracted text
	Status       string    `gorm:"size:16;not null;default:pending;index" json:"status"`
	SourceKey    string    `gorm:"size:512" json:"sourceKey,omitempty"` // S3 key of the original file
	Filename     string    `gorm:"size:255" json:"filename,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
}
