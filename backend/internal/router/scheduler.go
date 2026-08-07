package router

import (
	"github.com/gin-gonic/gin"

	"talkingavatar/backend/internal/app"
	"talkingavatar/backend/internal/config"
		"talkingavatar/backend/internal/handlers/admin"
	"talkingavatar/backend/internal/handlers/live"
)

// RegisterScheduler wires the worker-callback API (api-scheduler service).
// The Python worker reports task/asset progress here; nothing is admin- or
// viewer-facing.
func RegisterScheduler(r *gin.Engine, cfg config.Config, deps *app.Deps) {
	avatarHandler := admin.NewAvatarHandler(deps.DB, deps.S3, deps.Queue, cfg.AvatarInitQueueKey)
	taskHandler := admin.NewTaskHandler(deps.DB, deps.Queue, deps.S3)
	liveHandler := live.NewLiveHandler(
		deps.DB, deps.Queue, deps.S3,
		cfg.LiveControlQueueKey, cfg.TaskQueueKey,
		cfg.OpenAIAPIKey, cfg.OpenAIBaseURL, cfg.OpenAIModel,
		cfg.EmbedServerURL, cfg.TTSServiceURL,
	)

	api := r.Group("/api")
	{
		// Internal webhook: worker persists the pre-processed base video key.
		api.POST("/avatars/:id/default-video", avatarHandler.UpdateDefaultVideo)
		// Internal webhook used by the Python AI worker.
		api.POST("/tasks/:id/status", taskHandler.UpdateStatus)
		// Internal endpoint used by stream_worker to restore active live sessions.
		api.GET("/live", liveHandler.ListSessions)
	}
}
