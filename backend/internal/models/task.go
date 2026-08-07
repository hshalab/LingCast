package models

import "time"

const (
	TaskStatusPending    = "pending"
	TaskStatusProcessing = "processing"
	TaskStatusCompleted  = "completed"
	TaskStatusFailed     = "failed"
)

type BroadcastTask struct {
	ID         uint   `gorm:"primaryKey" json:"id"`
	AvatarID   uint   `gorm:"not null;index" json:"avatarId"`
	ScriptText string `gorm:"type:text;not null" json:"scriptText"`
	Status     string `gorm:"size:32;not null;default:pending;index" json:"status"`
	Progress int `gorm:"not null;default:0" json:"progress"`
	Stage string `gorm:"size:16;not null;default:''" json:"stage,omitempty"`
	SceneID      uint `gorm:"not null;default:0" json:"sceneId"`
	SceneVideoID uint `gorm:"not null;default:0" json:"sceneVideoId"`
	VideoS3Key string `gorm:"size:512;not null;default:''" json:"videoS3Key,omitempty"`
	TtsS3Key         *string   `gorm:"size:512" json:"ttsS3Key,omitempty"`
	OutputVideoS3URL *string   `gorm:"size:1024" json:"outputVideoS3Url,omitempty"`
	ErrorMessage     *string   `gorm:"size:1024" json:"errorMessage,omitempty"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
	Avatar           Avatar    `gorm:"foreignKey:AvatarID" json:"avatar,omitempty"`
}
