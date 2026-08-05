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

	avatarHandler := handlers.NewAvatarHandler(db, s3, q, cfg.AvatarInitQueueKey)
	taskHandler := handlers.NewTaskHandler(db, q, s3)
	chatHandler := handlers.NewChatHandler(db)
	liveHandler := handlers.NewLiveHandler(
		db, q, s3, cfg.LiveControlQueueKey,
		cfg.OpenAIAPIKey, cfg.OpenAIBaseURL, cfg.OpenAIModel,
	)

	api := r.Group("/api")
	{
		api.POST("/tts/preview", handlers.PreviewTTS)
		api.POST("/avatars", avatarHandler.Create)
		api.GET("/avatars", avatarHandler.List)
		api.GET("/avatars/:id", avatarHandler.Get)
		api.DELETE("/avatars/:id", avatarHandler.Delete)
		api.POST("/avatars/:id/retry", avatarHandler.Retry)
		api.POST("/avatars/:id/skip", avatarHandler.Skip)
		api.PUT("/avatars/:id/live-settings", avatarHandler.UpdateLiveSettings)
		// Internal webhook: worker persists the pre-processed base video key.
		api.POST("/avatars/:id/base-video", avatarHandler.UpdateBaseVideo)
		api.POST("/tasks", taskHandler.Create)
		api.GET("/tasks", taskHandler.List)
		api.GET("/tasks/:id", taskHandler.Get)
		api.DELETE("/tasks/:id", taskHandler.Delete)
		api.POST("/tasks/:id/retry", taskHandler.Retry)
		// Internal webhook used by the Python AI worker.
		api.POST("/tasks/:id/status", taskHandler.UpdateStatus)
		// Live streaming: session lifecycle, per-avatar text intake and status.
		api.GET("/live", liveHandler.ListSessions)
		api.POST("/live/:avatarID/start", liveHandler.Start)
		api.POST("/live/:avatarID/stop", liveHandler.Stop)
		api.POST("/live/:avatarID/push", liveHandler.Push)
		api.POST("/live/:avatarID/message", liveHandler.Message)
		api.GET("/live/:avatarID/status", liveHandler.Status)
		// Audience chat identity + persisted room history.
		api.POST("/chat/guest", chatHandler.Guest)
		api.POST("/chat/register", chatHandler.Register)
		api.POST("/chat/login", chatHandler.Login)
		api.GET("/chat/history", chatHandler.History)
		api.GET("/users", chatHandler.ListUsers)
	}

	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
	return r
}
