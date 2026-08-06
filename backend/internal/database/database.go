package database

import (
	"log"
	"time"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"talkingavatar/backend/internal/models"
)

// Connect opens the MySQL connection and runs migrations. It retries for a
// while so the API container can start before MySQL is fully ready.
func Connect(dsn string) (*gorm.DB, error) {
	var (
		db  *gorm.DB
		err error
	)

	for attempt := 1; attempt <= 15; attempt++ {
		db, err = gorm.Open(mysql.Open(dsn), &gorm.Config{
			Logger: logger.Default.LogMode(logger.Warn),
		})
		if err == nil {
			break
		}
		log.Printf("waiting for mysql (attempt %d/15): %v", attempt, err)
		time.Sleep(2 * time.Second)
	}
	if err != nil {
		return nil, err
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	sqlDB.SetMaxOpenConns(25)
	sqlDB.SetMaxIdleConns(5)
	sqlDB.SetConnMaxLifetime(5 * time.Minute)

	if err := db.AutoMigrate(
		&models.Avatar{},
		&models.BroadcastTask{},
		&models.LiveSession{},
		&models.ChatUser{},
		&models.ChatMessage{},
		&models.AdminUser{},
		&models.KnowledgeCollection{},
		&models.KnowledgeDocument{},
	); err != nil {
		return nil, err
	}
	return db, nil
}
