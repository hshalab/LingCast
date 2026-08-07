package router

import (
	"github.com/gin-gonic/gin"
	"talkingavatar/backend/internal/app"
	"talkingavatar/backend/internal/config"
)

func RegisterWeb(r *gin.Engine, cfg config.Config, deps *app.Deps) {
	api := r.Group("/api")
	{
		// Placeholder for future third-party web logins (Google/Apple)
		api.GET("/ping", func(c *gin.Context) {
			c.JSON(200, gin.H{"message": "api-web placeholder"})
		})
	}
}
