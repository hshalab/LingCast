package router

import (
	"github.com/gin-gonic/gin"

	"talkingavatar/backend/internal/app"
	"talkingavatar/backend/internal/config"
	"talkingavatar/backend/internal/handlers"
)

// RegisterUser wires the audience-facing API (api-user service). All
// endpoints are public; this is where the viewer app and the live-chat
// orchestrator live.
func RegisterUser(r *gin.Engine, cfg config.Config, deps *app.Deps) {
	avatarHandler := handlers.NewAvatarHandler(deps.DB, deps.S3, deps.Queue, cfg.AvatarInitQueueKey)
	chatHandler := handlers.NewChatHandler(deps.DB)
	liveHandler := handlers.NewLiveHandler(
		deps.DB, deps.Queue, deps.S3,
		cfg.LiveControlQueueKey, cfg.TaskQueueKey,
		cfg.OpenAIAPIKey, cfg.OpenAIBaseURL, cfg.OpenAIModel,
		cfg.EmbedServerURL, cfg.TTSServiceURL,
	)

	api := r.Group("/api")
	{
		// Public avatar detail (viewer room page).
		api.GET("/avatars/:id", avatarHandler.Get)
		// Live streaming: audience-facing read + chat intake.
		api.GET("/live", liveHandler.ListSessions)
		api.POST("/live/:avatarID/message", liveHandler.Message)
		api.POST("/live/chat", liveHandler.Chat)
		api.GET("/live/:avatarID/status", liveHandler.Status)
		// Audience chat identity + persisted room history.
		api.POST("/chat/guest", chatHandler.Guest)
		api.POST("/chat/register", chatHandler.Register)
		api.POST("/chat/login", chatHandler.Login)
		api.GET("/chat/history", chatHandler.History)
	}
}
