package models

import "time"

type LiveUser struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	Username     string    `gorm:"size:64;not null;uniqueIndex" json:"username"`
	PasswordHash string    `gorm:"size:255" json:"-"`
	IsGuest      bool      `gorm:"not null;default:true;index" json:"isGuest"`
	GoogleID     *string   `gorm:"size:255;uniqueIndex" json:"googleId,omitempty"`
	AppleID      *string   `gorm:"size:255;uniqueIndex" json:"appleId,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
}

type TelegramUser struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	TelegramID int64     `gorm:"uniqueIndex;not null" json:"telegramId"`
	Username   string    `gorm:"size:64;not null" json:"username"`
	CreatedAt  time.Time `json:"createdAt"`
}

type LiveMessage struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	AvatarID   uint      `gorm:"not null;index" json:"avatarId"`
	SenderID   uint      `gorm:"not null;index" json:"senderId"`
	SenderType string    `gorm:"size:32;not null;index" json:"senderType"`
	Username   string    `gorm:"size:64;not null" json:"username"`
	Role       string    `gorm:"size:16;not null;index" json:"role"` // user | bot
	Content    string    `gorm:"type:text;not null" json:"content"`
	RAGHit     bool      `gorm:"not null;default:false;index" json:"ragHit"`
	RAGSources string    `gorm:"type:text" json:"ragSources"`
	CreatedAt  time.Time `json:"createdAt"`
}
