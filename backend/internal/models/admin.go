package models

import "time"

type AdminUser struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	Username     string    `gorm:"size:64;not null;uniqueIndex" json:"username"`
	DisplayName  string    `gorm:"size:64;not null" json:"name"`
	PasswordHash string    `gorm:"size:255;not null" json:"-"`
	CreatedAt    time.Time `json:"createdAt"`
}
