package router

import (
	"github.com/gin-gonic/gin"

	"talkingavatar/backend/internal/app"
	"talkingavatar/backend/internal/config"
		"talkingavatar/backend/internal/handlers/admin"
	"talkingavatar/backend/internal/handlers/live"
)

// RegisterLive wires the audience-facing API (api-user service). All
// endpoints are public; this is where the viewer app and the live-chat
// orchestrator live.
func RegisterLive(r *gin.Engine, cfg config.Config, deps *app.Deps) {
	avatarHandler := admin.NewAvatarHandler(deps.DB, deps.S3, deps.Queue, cfg.AvatarInitQueueKey)
		liveHandler := live.NewLiveHandler(
		deps.DB, deps.Queue, deps.S3,
		cfg.LiveControlQueueKey, cfg.TaskQueueKey,
		cfg.OpenAIAPIKey, cfg.OpenAIBaseURL, cfg.OpenAIModel,
		cfg.EmbedServerURL, cfg.TTSServiceURL,
	)
		
	api := r.Group("/api")
	{
		// Public avatar detail (viewer room page).
		api.GET("/avatars/:id", avatarHandler.Get)
		// Public scene list (audience scene switcher).
		api.GET("/avatars/:id/scenes", avatarHandler.ListScenes)
		// Live streaming: audience-facing read + chat intake.
		api.GET("/live", liveHandler.ListSessions)
		api.POST("/live/:avatarID/message", liveHandler.Message)
		api.POST("/live/chat", liveHandler.Chat)
		api.PUT("/live/session/:avatarID/scene", liveHandler.SwitchScene)
		api.GET("/live/:avatarID/status", liveHandler.Status)
	}
}
