package models

import "time"

const (
	AvatarStatusInitializing = "initializing"
	AvatarStatusReady        = "ready"
	AvatarStatusFailed       = "failed"
	AvatarStatusSkipped      = "skipped"
)

const DefaultEdgeVoice = "zh-CN-XiaoxiaoNeural"

type LiveSettings struct {
	SubtitleEnabled  bool   `json:"subtitleEnabled"`
	SubtitleFont     string `json:"subtitleFont"`
	SubtitlePosition string `json:"subtitlePosition"`
	SubtitleBorder   int    `json:"subtitleBorder"`
	SubtitleSize     int    `json:"subtitleSize"`
	IdleSceneID uint `json:"idleSceneId,omitempty"`
	IdleSwitchMode    string `json:"idleSwitchMode,omitempty"`
	IdleSwitchSeconds int    `json:"idleSwitchSeconds,omitempty"`
}

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

type PersonaProfile struct {
	Age                *int   `json:"age,omitempty"`
	HeightCm           *int   `json:"heightCm,omitempty"`
	WeightKg           *int   `json:"weightKg,omitempty"`
	Ethnicity          string `json:"ethnicity,omitempty"`
	RelationshipStatus string `json:"relationshipStatus,omitempty"`
	Personality        string `json:"personality,omitempty"`
}

type Avatar struct {
	ID         uint   `gorm:"primaryKey" json:"id"`
	Name       string `gorm:"size:255;not null" json:"name"`
	ImageS3Key string `gorm:"size:512;not null" json:"imageS3Key"`
	Category string `gorm:"size:32;not null;default:其他" json:"category"`
	Persona string `gorm:"type:text;not null;default:'{}'" json:"-"`
	VoiceID string `gorm:"size:64;not null;default:zh-CN-XiaoxiaoNeural" json:"voiceId"`
	Status  string `gorm:"size:32;not null;default:initializing;index" json:"status"`
	LiveSettings string    `gorm:"type:text;not null;default:'{}'" json:"-"`
	CreatedAt    time.Time `json:"createdAt"`
}

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

type SceneVideo struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	SceneID     uint      `gorm:"not null;index" json:"sceneId"`
	AvatarID    uint      `gorm:"not null;index" json:"avatarId"`
	S3Key       string    `gorm:"size:512;not null" json:"s3Key"`
	Description string    `gorm:"size:255" json:"description,omitempty"`
	IsDefault   bool      `gorm:"not null;default:false" json:"isDefault"`
	CreatedAt   time.Time `json:"createdAt"`
}
