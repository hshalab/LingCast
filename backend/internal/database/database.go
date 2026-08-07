package database

import (
	"encoding/json"
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
		&models.Scene{},
		&models.SceneVideo{},
		&models.AvatarKnowledge{},
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
	if err := migrateScenes(db); err != nil {
		return nil, err
	}
	if err := migrateGlobalKnowledge(db); err != nil {
		return nil, err
	}
	return db, nil
}

// migrateGlobalKnowledge converts per-avatar knowledge collections into
// global collections + the AvatarKnowledge N:N binding table.
func migrateGlobalKnowledge(db *gorm.DB) error {
	if !db.Migrator().HasColumn(&models.KnowledgeCollection{}, "avatar_id") {
		return nil // already migrated (or fresh schema)
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(
			`INSERT IGNORE INTO avatar_knowledge (avatar_id, collection_id, enabled)
			 SELECT avatar_id, id, enabled FROM knowledge_collections WHERE avatar_id IS NOT NULL`,
		).Error; err != nil {
			return err
		}
		if tx.Migrator().HasIndex(&models.KnowledgeCollection{}, "idx_collection_avatar_name") {
			if err := tx.Migrator().DropIndex(&models.KnowledgeCollection{}, "idx_collection_avatar_name"); err != nil {
				return err
			}
		}
		for _, col := range []string{"avatar_id", "enabled"} {
			if err := tx.Migrator().DropColumn(&models.KnowledgeCollection{}, col); err != nil {
				return err
			}
		}
		return nil
	})
}

// migrateScenes performs the one-time scene/persona migration:
//   - persona: legacy avatar columns (age/height/weight/ethnicity/
//     relationship/personality) -> avatar.persona JSON;
//   - scenes: each avatar gets a default scene (cover = avatar image) whose
//     default video is the legacy base_video_s3_key; old avatar_videos rows
//     are moved into the default scene;
//   - cleanup: drop the legacy columns and the avatar_videos table.
//
// Idempotent: skipped when the legacy columns are already gone or the scenes
// table already has rows.
func migrateScenes(db *gorm.DB) error {
	if !db.Migrator().HasColumn(&models.Avatar{}, "base_video_s3_key") {
		return nil // fresh schema or already migrated
	}
	var count int64
	if err := db.Model(&models.Scene{}).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil // already migrated
	}

	return db.Transaction(func(tx *gorm.DB) error {
		type legacyAvatar struct {
			ID                 uint
			Age                *int
			HeightCm           *int
			WeightKg           *int
			Ethnicity          string
			RelationshipStatus string
			Personality        string
			ImageS3Key         string
			BaseVideoS3Key     *string
		}
		var rows []legacyAvatar
		if err := tx.Raw(
			`SELECT id, age, height_cm, weight_kg, ethnicity,
			        relationship_status, personality, image_s3_key, base_video_s3_key
			 FROM avatars`,
		).Scan(&rows).Error; err != nil {
			return err
		}

		for _, r := range rows {
			persona, err := json.Marshal(models.PersonaProfile{
				Age:                r.Age,
				HeightCm:           r.HeightCm,
				WeightKg:           r.WeightKg,
				Ethnicity:          r.Ethnicity,
				RelationshipStatus: r.RelationshipStatus,
				Personality:        r.Personality,
			})
			if err != nil {
				return err
			}
			if err := tx.Model(&models.Avatar{}).Where("id = ?", r.ID).
				Update("persona", string(persona)).Error; err != nil {
				return err
			}

			scene := models.Scene{
				AvatarID:   r.ID,
				Title:      "默认场景",
				CoverS3Key: r.ImageS3Key,
				IsDefault:  true,
			}
			if err := tx.Create(&scene).Error; err != nil {
				return err
			}
			if r.BaseVideoS3Key != nil && *r.BaseVideoS3Key != "" {
				if err := tx.Create(&models.SceneVideo{
					SceneID:     scene.ID,
					AvatarID:    r.ID,
					S3Key:       *r.BaseVideoS3Key,
					Description: "默认",
					IsDefault:   true,
				}).Error; err != nil {
					return err
				}
			}

			type legacyVideo struct {
				Name  string
				S3Key string
			}
			var videos []legacyVideo
			if err := tx.Raw(
				`SELECT name, s3_key FROM avatar_videos WHERE avatar_id = ?`, r.ID,
			).Scan(&videos).Error; err != nil {
				return err
			}
			for _, v := range videos {
				if err := tx.Create(&models.SceneVideo{
					SceneID:     scene.ID,
					AvatarID:    r.ID,
					S3Key:       v.S3Key,
					Description: v.Name,
				}).Error; err != nil {
					return err
				}
			}
		}

		for _, col := range []string{
			"base_video_s3_key", "age", "height_cm", "weight_kg",
			"ethnicity", "relationship_status", "personality",
		} {
			if err := tx.Migrator().DropColumn(&models.Avatar{}, col); err != nil {
				return err
			}
		}
		if tx.Migrator().HasTable("avatar_videos") {
			if err := tx.Migrator().DropTable("avatar_videos"); err != nil {
				return err
			}
		}
		return nil
	})
}
