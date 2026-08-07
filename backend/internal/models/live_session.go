package models

import "time"

const (
	LiveStatusIdle   = "idle"
	LiveStatusActive = "active"
)

type LiveSession struct {
	ID       uint   `gorm:"primaryKey" json:"id"`
	AvatarID uint   `gorm:"not null;uniqueIndex" json:"avatarId"`
	StreamID string `gorm:"size:128;not null" json:"streamId"`
	Status   string `gorm:"size:32;not null;default:idle;index" json:"status"`
	SceneID   uint      `gorm:"not null;default:0" json:"sceneId"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}
