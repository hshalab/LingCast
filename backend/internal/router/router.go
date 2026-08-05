package router

import (
	"net/http"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"talkingavatar/backend/internal/config"
	"talkingavatar/backend/internal/handlers"
	"talkingavatar/backend/internal/queue"
	"talkingavatar/backend/internal/storage"
)

// New wires the Gin engine, CORS middleware and all routes.
func New(cfg config.Config, db *gorm.DB, s3 *storage.Client, q *queue.Queue) *gin.Engine {
	gin.SetMode(cfg.GinMode)

	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())

	// CORS must allow the Vite dev server (e.g. http://localhost:5173) as
	// well as the nginx-served app origin.
	r.Use(cors.New(cors.Config{
		AllowOrigins:     cfg.CORSOrigins,
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	avatarHandler := handlers.NewAvatarHandler(db, s3)
	taskHandler := handlers.NewTaskHandler(db, q)
	liveHandler := handlers.NewLiveHandler(db, q, cfg.LiveControlQueueKey)

	api := r.Group("/api")
	{
		api.POST("/avatars", avatarHandler.Create)
		api.GET("/avatars", avatarHandler.List)
		api.POST("/tasks", taskHandler.Create)
		api.GET("/tasks/:id", taskHandler.Get)
		// Internal webhook used by the Python AI worker.
		api.POST("/tasks/:id/status", taskHandler.UpdateStatus)
		// Live streaming: session lifecycle, per-avatar text intake and status.
		api.POST("/live/:avatarID/start", liveHandler.Start)
		api.POST("/live/:avatarID/push", liveHandler.Push)
		api.GET("/live/:avatarID/status", liveHandler.Status)
	}

	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
	return r
}
