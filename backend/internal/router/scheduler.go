package router

import (
	"github.com/gin-gonic/gin"

	"talkingavatar/backend/internal/app"
	"talkingavatar/backend/internal/config"
	"talkingavatar/backend/internal/handlers"
)

// RegisterScheduler wires the worker-callback API (api-scheduler service).
// The Python worker reports task/asset progress here; nothing is admin- or
// viewer-facing.
func RegisterScheduler(r *gin.Engine, cfg config.Config, deps *app.Deps) {
	avatarHandler := handlers.NewAvatarHandler(deps.DB, deps.S3, deps.Queue, cfg.AvatarInitQueueKey)
	taskHandler := handlers.NewTaskHandler(deps.DB, deps.Queue, deps.S3)
	liveHandler := handlers.NewLiveHandler(
		deps.DB, deps.Queue, deps.S3,
		cfg.LiveControlQueueKey, cfg.TaskQueueKey,
		cfg.OpenAIAPIKey, cfg.OpenAIBaseURL, cfg.OpenAIModel,
		cfg.EmbedServerURL, cfg.TTSServiceURL,
	)

	api := r.Group("/api")
	{
		// Internal webhook: worker persists the pre-processed base video key.
		api.POST("/avatars/:id/base-video", avatarHandler.UpdateBaseVideo)
		// Internal webhook used by the Python AI worker.
		api.POST("/tasks/:id/status", taskHandler.UpdateStatus)
		// Internal endpoint used by stream_worker to restore active live sessions.
		api.GET("/live", liveHandler.ListSessions)
	}
}
