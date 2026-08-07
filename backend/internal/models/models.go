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
// JSON string on the avatar row: subtitle rendering (on/off, font file,
// position, border width and size) plus the idle-stream default videos
// (selected scene, switch mode interval/random and the N-seconds interval).
// Unknown fields are ignored by both sides.
type LiveSettings struct {
	SubtitleEnabled  bool   `json:"subtitleEnabled"`
	SubtitleFont     string `json:"subtitleFont"`     // font filename in worker/fonts/, "" = system default
	SubtitlePosition string `json:"subtitlePosition"` // "bottom" | "top"
	SubtitleBorder   int    `json:"subtitleBorder"`   // stroke width in px (0 = none)
	SubtitleSize     int    `json:"subtitleSize"`     // px
	// IdleSceneID is the scene whose videos are pushed while the avatar is
	// idle (0 = fall back to the default scene's default video only).
	IdleSceneID uint `json:"idleSceneId,omitempty"`
	// IdleSwitchMode: "interval" cycles the scene videos every
	// IdleSwitchSeconds; "random" picks a random next video at a random
	// interval.
	IdleSwitchMode    string `json:"idleSwitchMode,omitempty"`
	IdleSwitchSeconds int    `json:"idleSwitchSeconds,omitempty"`
}

// DefaultLiveSettings is applied when an avatar has no saved settings yet.
func DefaultLiveSettings() LiveSettings {
	return LiveSettings{
		SubtitleEnabled:   true,
		SubtitlePosition:  "bottom",
		SubtitleBorder:    2,
		SubtitleSize:      46,
		IdleSwitchMode:    "interval",
		IdleSwitchSeconds: 15,
	}
}

// PersonaProfile is the avatar's persona block, stored as a JSON string on
// the avatar row (age/height/weight/ethnicity/relationship/personality).
type PersonaProfile struct {
	Age                *int   `json:"age,omitempty"`
	HeightCm           *int   `json:"heightCm,omitempty"`
	WeightKg           *int   `json:"weightKg,omitempty"`
	Ethnicity          string `json:"ethnicity,omitempty"`
	RelationshipStatus string `json:"relationshipStatus,omitempty"`
	Personality        string `json:"personality,omitempty"`
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
	// Persona is the JSON-serialized PersonaProfile.
	Persona string `gorm:"type:text;not null;default:'{}'" json:"-"`
	// VoiceID selects the Edge-TTS voice used for broadcast/live speech.
	VoiceID string `gorm:"size:64;not null;default:zh-CN-XiaoxiaoNeural" json:"voiceId"`
	Status  string `gorm:"size:32;not null;default:initializing;index" json:"status"`
	// LiveSettings holds the JSON-serialized models.LiveSettings.
	LiveSettings string    `gorm:"type:text;not null;default:'{}'" json:"-"`
	CreatedAt    time.Time `json:"createdAt"`
}

// Scene groups 1-N driving videos of an avatar (e.g. 沙滩场景: 趴着/雨伞下/喝水).
// The avatar's creation-time base video becomes the default scene's default
// video; the default scene/video is the live & broadcast fallback.
type Scene struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	AvatarID    uint      `gorm:"not null;index" json:"avatarId"`
	Title       string    `gorm:"size:128;not null" json:"title"`
	Description string    `gorm:"size:512" json:"description,omitempty"`
	CoverS3Key  string    `gorm:"size:512" json:"coverS3Key"`
	IsDefault   bool      `gorm:"not null;default:false" json:"isDefault"`
	SortOrder   int       `gorm:"not null;default:0" json:"sortOrder"`
	CreatedAt   time.Time `json:"createdAt"`
}

// SceneVideo is one driving video inside a scene.
type SceneVideo struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	SceneID     uint      `gorm:"not null;index" json:"sceneId"`
	AvatarID    uint      `gorm:"not null;index" json:"avatarId"`
	S3Key       string    `gorm:"size:512;not null" json:"s3Key"`
	Description string    `gorm:"size:255" json:"description,omitempty"`
	IsDefault   bool      `gorm:"not null;default:false" json:"isDefault"`
	CreatedAt   time.Time `json:"createdAt"`
}

// BroadcastTask is an async synthesis task queued to the AI worker.
type BroadcastTask struct {
	ID         uint   `gorm:"primaryKey" json:"id"`
	AvatarID   uint   `gorm:"not null;index" json:"avatarId"`
	ScriptText string `gorm:"type:text;not null" json:"scriptText"`
	Status     string `gorm:"size:32;not null;default:pending;index" json:"status"`
	// Progress is the worker-reported percentage (0-100) while processing.
	Progress int `gorm:"not null;default:0" json:"progress"`
	// Stage is the worker-reported pipeline step: tts | lipsync | mux.
	Stage string `gorm:"size:16;not null;default:''" json:"stage,omitempty"`
	// SceneID/SceneVideoID record which scene video the task used, so retries
	// and the history table can show/show the right parameters.
	SceneID      uint `gorm:"not null;default:0" json:"sceneId"`
	SceneVideoID uint `gorm:"not null;default:0" json:"sceneVideoId"`
	// VideoS3Key is the driving video used for this task (a scene video).
	VideoS3Key string `gorm:"size:512;not null;default:''" json:"videoS3Key,omitempty"`
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
	ID       uint   `gorm:"primaryKey" json:"id"`
	AvatarID uint   `gorm:"not null;uniqueIndex" json:"avatarId"`
	StreamID string `gorm:"size:128;not null" json:"streamId"`
	Status   string `gorm:"size:32;not null;default:idle;index" json:"status"`
	// SceneID is the session's currently active scene (0 = avatar default).
	SceneID   uint      `gorm:"not null;default:0" json:"sceneId"`
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
	KnowledgeStatusIndexed = "indexed" // chunks indexed into service-rag (RAG-ready)
	KnowledgeStatusFailed  = "failed"  // extraction/ingest failed (see content)
)

// KnowledgeCollection is a GLOBAL named knowledge base (zvec "collection"
// concept). Avatars bind to collections through AvatarKnowledge (N:N);
// documents live inside a collection and are shared by bound avatars.
type KnowledgeCollection struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Name      string    `gorm:"size:128;not null;index" json:"name"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// AvatarKnowledge is the N:N binding between avatars and global knowledge
// collections. `enabled` means the collection takes part in this avatar's
// live Q&A retrieval (the edit-page multi-select).
type AvatarKnowledge struct {
	AvatarID     uint `gorm:"primaryKey;autoIncrement:false" json:"avatarId"`
	CollectionID uint `gorm:"primaryKey;autoIncrement:false" json:"collectionId"`
	Enabled      bool `gorm:"not null;default:true" json:"enabled"`
}

// KnowledgeDocument is one source document (raw text or uploaded .txt/.pdf)
// inside a knowledge collection. It is chunked and indexed into service-rag;
// the DB row mirrors the service-rag chunks via collection_id + source_id.
type KnowledgeDocument struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	CollectionID uint      `gorm:"not null;index" json:"collectionId"`
	Content      string    `gorm:"type:text;not null" json:"content"` // extracted text
	Status       string    `gorm:"size:16;not null;default:pending;index" json:"status"`
	SourceKey    string    `gorm:"size:512" json:"sourceKey,omitempty"` // S3 key of the original file
	Filename     string    `gorm:"size:255" json:"filename,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
}
