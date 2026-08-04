package models

import "time"

// Task lifecycle statuses shared by the API and the AI worker.
const (
	TaskStatusPending    = "pending"
	TaskStatusProcessing = "processing"
	TaskStatusCompleted  = "completed"
	TaskStatusFailed     = "failed"
)

// Avatar is a digital avatar material record. Files live in object storage;
// the database only stores their S3 keys.
type Avatar struct {
	ID              uint      `gorm:"primaryKey" json:"id"`
	Name            string    `gorm:"size:255;not null" json:"name"`
	ImageS3Key      string    `gorm:"size:512;not null" json:"imageS3Key"`
	VoiceAudioS3Key *string   `gorm:"size:512" json:"voiceAudioS3Key,omitempty"`
	CreatedAt       time.Time `json:"createdAt"`
}

// BroadcastTask is an async synthesis task queued to the AI worker.
type BroadcastTask struct {
	ID               uint       `gorm:"primaryKey" json:"id"`
	AvatarID         uint       `gorm:"not null;index" json:"avatarId"`
	ScriptText       string     `gorm:"type:text;not null" json:"scriptText"`
	Status           string     `gorm:"size:32;not null;default:pending;index" json:"status"`
	OutputVideoS3URL *string    `gorm:"size:1024" json:"outputVideoS3Url,omitempty"`
	ErrorMessage     *string    `gorm:"size:1024" json:"errorMessage,omitempty"`
	CreatedAt        time.Time  `json:"createdAt"`
	UpdatedAt        time.Time  `json:"updatedAt"`
	Avatar           Avatar     `gorm:"foreignKey:AvatarID" json:"avatar,omitempty"`
}
