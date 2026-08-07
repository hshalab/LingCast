package database

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"talkingavatar/backend/internal/models"
)

// Connect opens the MySQL connection and runs migrations. It retries for a
// while so the API container can start before MySQL is fully ready. ragURL is
// the service-rag base URL used to re-ingest legacy knowledge documents.
func Connect(dsn, ragURL string) (*gorm.DB, error) {
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

	// Old versions (before the two-level knowledge model) stored per-avatar
	// knowledge documents in the avatar_knowledges table. The current model
	// reuses that name for the N:N binding table, so move the legacy table
	// aside BEFORE AutoMigrate (non-destructive) or GORM fails trying to
	// reshape it ("Multiple primary key defined").
	if err := preserveLegacyAvatarKnowledge(db); err != nil {
		return nil, err
	}

	if err := db.AutoMigrate(
		&models.Avatar{},
		&models.Scene{},
		&models.SceneVideo{},
		&models.AvatarKnowledge{},
		&models.BroadcastTask{},
		&models.LiveSession{},
		&models.LiveUser{},
		&models.TelegramUser{},
		&models.LiveMessage{},
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
	if err := migrateLegacyKnowledgeDocs(db, ragURL); err != nil {
		return nil, err
	}
	return db, nil
}

// preserveLegacyAvatarKnowledge renames the legacy per-avatar document table
// (avatar_knowledges with id/content/status/source_key/filename) to
// avatar_knowledges_legacy so AutoMigrate can create the fresh N:N binding
// table. Idempotent: no-op once the table has the new binding shape.
func preserveLegacyAvatarKnowledge(db *gorm.DB) error {
	if !db.Migrator().HasTable("avatar_knowledges") {
		return nil
	}
	if !db.Migrator().HasColumn(&models.AvatarKnowledge{}, "content") {
		return nil // already the new binding shape
	}
	if db.Migrator().HasTable("avatar_knowledges_legacy") {
		// A previous interrupted run already saved the legacy copy; drop the
		// stale old-shape table so AutoMigrate can build the binding table.
		return db.Migrator().DropTable("avatar_knowledges")
	}
	if err := db.Migrator().RenameTable("avatar_knowledges", "avatar_knowledges_legacy"); err != nil {
		// Multiple API replicas may race the rename; if another process already
		// moved the table, treat it as done.
		if db.Migrator().HasTable("avatar_knowledges_legacy") &&
			!db.Migrator().HasColumn(&models.AvatarKnowledge{}, "content") {
			return nil
		}
		return err
	}
	return nil
}

// migrateGlobalKnowledge converts per-avatar knowledge collections into
// global collections + the AvatarKnowledge N:N binding table.
func migrateGlobalKnowledge(db *gorm.DB) error {
	if !db.Migrator().HasColumn(&models.KnowledgeCollection{}, "avatar_id") {
		return nil // already migrated (or fresh schema)
	}
	return db.Transaction(func(tx *gorm.DB) error {
		// Older schema had no `enabled` column on collections; the binding
		// table gets enabled=true for every migrated collection then.
		enabledExpr := "enabled"
		if !tx.Migrator().HasColumn(&models.KnowledgeCollection{}, "enabled") {
			enabledExpr = "TRUE"
		}
		if err := tx.Exec(
			`INSERT IGNORE INTO avatar_knowledges (avatar_id, collection_id, enabled)
			 SELECT avatar_id, id, `+enabledExpr+` FROM knowledge_collections WHERE avatar_id IS NOT NULL`,
		).Error; err != nil {
			return err
		}
		if tx.Migrator().HasIndex(&models.KnowledgeCollection{}, "idx_collection_avatar_name") {
			if err := tx.Migrator().DropIndex(&models.KnowledgeCollection{}, "idx_collection_avatar_name"); err != nil {
				return err
			}
		}
		for _, col := range []string{"avatar_id", "enabled"} {
			if !tx.Migrator().HasColumn(&models.KnowledgeCollection{}, col) {
				continue
			}
			if err := tx.Migrator().DropColumn(&models.KnowledgeCollection{}, col); err != nil {
				return err
			}
		}
		return nil
	})
}

// migrateLegacyKnowledgeDocs moves rows from the legacy per-avatar document
// table (avatar_knowledges_legacy) into the current global model: one global
// collection per old avatar, documents copied to knowledge_documents, the
// collection bound to that avatar (enabled), and the text re-ingested into
// service-rag so retrieval works. The legacy table is dropped only after every
// row migrated successfully (ingest included), so an interrupted run retries
// idempotently on the next start.
func migrateLegacyKnowledgeDocs(db *gorm.DB, ragURL string) error {
	if !db.Migrator().HasTable("avatar_knowledges_legacy") {
		return nil
	}
	type legacyRow struct {
		ID        uint
		AvatarID  uint
		Content   string
		SourceKey *string
		Filename  *string
		CreatedAt *time.Time
	}
	var rows []legacyRow
	if err := db.Table("avatar_knowledges_legacy").Find(&rows).Error; err != nil {
		return err
	}
	if len(rows) == 0 {
		return db.Migrator().DropTable("avatar_knowledges_legacy")
	}

	collectionByAvatar := map[uint]uint{}
	completed := true
	for _, r := range rows {
		colID, ok := collectionByAvatar[r.AvatarID]
		if !ok {
			name := fmt.Sprintf("旧知识库 #%d", r.AvatarID)
			var col models.KnowledgeCollection
			err := db.Where("name = ?", name).First(&col).Error
			switch {
			case errors.Is(err, gorm.ErrRecordNotFound):
				col = models.KnowledgeCollection{Name: name}
				if err := db.Create(&col).Error; err != nil {
					log.Printf("[migrate] create legacy knowledge collection failed: %v", err)
					completed = false
					continue
				}
			case err != nil:
				log.Printf("[migrate] lookup legacy knowledge collection failed: %v", err)
				completed = false
				continue
			}
			colID = col.ID
			collectionByAvatar[r.AvatarID] = colID

			var bind models.AvatarKnowledge
			err = db.Where("avatar_id = ? AND collection_id = ?", r.AvatarID, colID).
				First(&bind).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				if err := db.Create(&models.AvatarKnowledge{
					AvatarID:     r.AvatarID,
					CollectionID: colID,
					Enabled:      true,
				}).Error; err != nil {
					log.Printf("[migrate] bind legacy collection to avatar %d failed: %v", r.AvatarID, err)
					completed = false
					continue
				}
			} else if err != nil {
				log.Printf("[migrate] lookup avatar knowledge binding failed: %v", err)
				completed = false
				continue
			}
		}

		// Find-or-create the document (idempotency guard for interrupted runs).
		var doc models.KnowledgeDocument
		err := db.Where("collection_id = ? AND content = ?", colID, r.Content).
			First(&doc).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			doc = models.KnowledgeDocument{
				CollectionID: colID,
				Content:      r.Content,
				Status:       models.KnowledgeStatusPending,
			}
			if r.SourceKey != nil {
				doc.SourceKey = *r.SourceKey
			}
			if r.Filename != nil {
				doc.Filename = *r.Filename
			}
			if r.CreatedAt != nil {
				doc.CreatedAt = *r.CreatedAt
			}
			if err := db.Create(&doc).Error; err != nil {
				log.Printf("[migrate] insert legacy knowledge document failed: %v", err)
				completed = false
				continue
			}
		} else if err != nil {
			log.Printf("[migrate] lookup legacy document failed: %v", err)
			completed = false
			continue
		}

		// Re-ingest until it succeeds; already-indexed docs are skipped.
		if doc.Status != models.KnowledgeStatusIndexed && strings.TrimSpace(ragURL) != "" {
			if err := reingestKnowledgeDoc(ragURL, colID, doc.ID, r.Content); err != nil {
				log.Printf("[migrate] re-ingest legacy document #%d failed: %v (will retry on next start)", doc.ID, err)
				completed = false
			} else {
				_ = db.Model(&doc).Update("status", models.KnowledgeStatusIndexed)
				log.Printf("[migrate] legacy knowledge document #%d migrated to collection %d", doc.ID, colID)
			}
		}
	}

	if !completed {
		return nil // keep the legacy table for an idempotent retry
	}
	return db.Migrator().DropTable("avatar_knowledges_legacy")
}

// reingestKnowledgeDoc pushes a migrated legacy document into service-rag so
// its chunks are indexed under the new global collection.
func reingestKnowledgeDoc(ragURL string, collectionID, sourceID uint, content string) error {
	body, err := json.Marshal(map[string]any{
		"avatar_id":     0,
		"collection_id": collectionID,
		"source_id":     sourceID,
		"text_content":  content,
		"replace":       true, // idempotent: rebuild this document's chunks
	})
	if err != nil {
		return err
	}
	resp, err := http.Post(
		strings.TrimRight(ragURL, "/")+"/v1/knowledge/ingest",
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("service-rag ingest returned %d", resp.StatusCode)
	}
	return nil
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
			if tx.Migrator().HasTable("avatar_videos") {
				if err := tx.Raw(
					`SELECT name, s3_key FROM avatar_videos WHERE avatar_id = ?`, r.ID,
				).Scan(&videos).Error; err != nil {
					return err
				}
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
