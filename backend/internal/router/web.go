package router

import (
	"github.com/gin-gonic/gin"
	"talkingavatar/backend/internal/app"
	"talkingavatar/backend/internal/config"
	"talkingavatar/backend/internal/handlers/web"
)

func RegisterWeb(r *gin.Engine, cfg config.Config, deps *app.Deps) {
	chatHandler := web.NewChatHandler(deps.DB)

	api := r.Group("/api")
	{
		api.POST("/chat/guest", chatHandler.Guest)
		api.POST("/chat/register", chatHandler.Register)
		api.POST("/chat/login", chatHandler.Login)
		api.GET("/chat/history", chatHandler.History)
	}
}
