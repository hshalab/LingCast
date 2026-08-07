package router

import (
	"github.com/gin-gonic/gin"
	"talkingavatar/backend/internal/app"
	"talkingavatar/backend/internal/config"
	"talkingavatar/backend/internal/handlers/web"
)

func RegisterWeb(r *gin.Engine, cfg config.Config, deps *app.Deps) {
	api := r.Group("/api")
	{
		// Placeholder for future third-party web logins (Google/Apple)
		api.GET("/ping", func(c *gin.Context) {
			c.JSON(200, gin.H{"message": "api-web placeholder"})
		})
		
		api.GET("/auth/google/login", func(c *gin.Context) {
			web.GoogleLogin(c, cfg, deps)
		})
		api.GET("/auth/google/callback", func(c *gin.Context) {
			web.GoogleCallback(c, cfg, deps)
		})
		api.GET("/auth/me", func(c *gin.Context) {
			web.GetMe(c, cfg, deps)
		})
		api.GET("/auth/logout", func(c *gin.Context) {
			web.Logout(c, cfg, deps)
		})
	}
}
