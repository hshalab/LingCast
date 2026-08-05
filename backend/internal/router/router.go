package router

import (
	"net/http"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
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
	adminHandler := handlers.NewAdminHandler(
		redis.NewClient(&redis.Options{
			Addr:     cfg.RedisAddr,
			Password: cfg.RedisPassword,
			DB:       cfg.RedisDB,
		}),
		cfg.AdminUsername,
		cfg.AdminPassword,
	)

	api := r.Group("/api")
	{
		// ---- Admin auth (login/me/logout are public by design) ----
		api.POST("/admin/login", adminHandler.Login)
		api.GET("/admin/me", adminHandler.Me)
		api.POST("/admin/logout", adminHandler.Logout)

		// ---- Public: audience client + worker webhooks ----
		api.GET("/avatars/:id", avatarHandler.Get)
		// Internal webhook: worker persists the pre-processed base video key.
		api.POST("/avatars/:id/base-video", avatarHandler.UpdateBaseVideo)
		// Internal webhook used by the Python AI worker.
		api.POST("/tasks/:id/status", taskHandler.UpdateStatus)
		// Live streaming: audience-facing read + chat intake.
		api.GET("/live", liveHandler.ListSessions)
		api.POST("/live/:avatarID/message", liveHandler.Message)
		api.GET("/live/:avatarID/status", liveHandler.Status)
		// Audience chat identity + persisted room history.
		api.POST("/chat/guest", chatHandler.Guest)
		api.POST("/chat/register", chatHandler.Register)
		api.POST("/chat/login", chatHandler.Login)
		api.GET("/chat/history", chatHandler.History)

		// ---- Protected: admin-only operations ----
		protected := api.Group("", adminHandler.RequireAdmin())
		{
			protected.POST("/tts/preview", handlers.PreviewTTS)
			protected.POST("/avatars", avatarHandler.Create)
			protected.GET("/avatars", avatarHandler.List)
			protected.PUT("/avatars/:id", avatarHandler.Update)
			protected.DELETE("/avatars/:id", avatarHandler.Delete)
			protected.POST("/avatars/:id/retry", avatarHandler.Retry)
			protected.POST("/avatars/:id/skip", avatarHandler.Skip)
			protected.PUT("/avatars/:id/live-settings", avatarHandler.UpdateLiveSettings)
			protected.POST("/tasks", taskHandler.Create)
			protected.GET("/tasks", taskHandler.List)
			protected.GET("/tasks/:id", taskHandler.Get)
			protected.DELETE("/tasks/:id", taskHandler.Delete)
			protected.POST("/tasks/:id/retry", taskHandler.Retry)
			protected.POST("/live/:avatarID/start", liveHandler.Start)
			protected.POST("/live/:avatarID/stop", liveHandler.Stop)
			protected.POST("/live/:avatarID/push", liveHandler.Push)
			protected.GET("/users", chatHandler.ListUsers)
		}
	}

	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
	return r
}
