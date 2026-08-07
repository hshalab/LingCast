package models

import "time"

const (
	KnowledgeStatusPending = "pending"
	KnowledgeStatusIndexed = "indexed"
	KnowledgeStatusFailed  = "failed"
)

type KnowledgeCollection struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Name      string    `gorm:"size:128;not null;index" json:"name"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type AvatarKnowledge struct {
	AvatarID     uint `gorm:"primaryKey;autoIncrement:false" json:"avatarId"`
	CollectionID uint `gorm:"primaryKey;autoIncrement:false" json:"collectionId"`
	Enabled      bool `gorm:"not null;default:true" json:"enabled"`
}

type KnowledgeDocument struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	CollectionID uint      `gorm:"not null;index" json:"collectionId"`
	Content      string    `gorm:"type:text;not null" json:"content"`
	Status       string    `gorm:"size:16;not null;default:pending;index" json:"status"`
	SourceKey    string    `gorm:"size:512" json:"sourceKey,omitempty"`
	Filename     string    `gorm:"size:255" json:"filename,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
}
