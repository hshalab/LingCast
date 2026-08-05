package handlers

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

const adminSessionTTL = 24 * time.Hour

// AdminHandler manages the admin login session (Redis-backed opaque token in
// an HttpOnly cookie). Credentials come from ADMIN_USERNAME / ADMIN_PASSWORD.
type AdminHandler struct {
	redis    *redis.Client
	username string
	password string
}

func NewAdminHandler(rc *redis.Client, username, password string) *AdminHandler {
	return &AdminHandler{redis: rc, username: username, password: password}
}

func adminSessionKey(token string) string {
	return "admin:session:" + token
}

// Login handles POST /api/admin/login.
func (h *AdminHandler) Login(c *gin.Context) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	u := strings.TrimSpace(req.Username)
	userOK := subtle.ConstantTimeCompare([]byte(u), []byte(h.username)) == 1
	passOK := subtle.ConstantTimeCompare([]byte(req.Password), []byte(h.password)) == 1
	if !userOK || !passOK {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "用户名或密码错误"})
		return
	}

	token, err := randomToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "session issue"})
		return
	}
	ctx := c.Request.Context()
	if err := h.redis.Set(ctx, adminSessionKey(token), h.username, adminSessionTTL).Err(); err != nil {
		log.Printf("[admin] session store failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "session store failed"})
		return
	}
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     "admin_token",
		Value:    token,
		Path:     "/",
		MaxAge:   int(adminSessionTTL.Seconds()),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	c.JSON(http.StatusOK, gin.H{"username": h.username})
}

func randomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// Me handles GET /api/admin/me — tells the frontend whether the session is valid.
func (h *AdminHandler) Me(c *gin.Context) {
	username, ok := h.sessionUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未登录"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"username": username})
}

// Logout handles POST /api/admin/logout.
func (h *AdminHandler) Logout(c *gin.Context) {
	if token, err := c.Cookie("admin_token"); err == nil && token != "" {
		_ = h.redis.Del(c.Request.Context(), adminSessionKey(token)).Err()
	}
	http.SetCookie(c.Writer, &http.Cookie{
		Name: "admin_token", Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, SameSite: http.SameSiteLaxMode,
	})
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// sessionUser returns the logged-in admin username from the cookie, if valid.
func (h *AdminHandler) sessionUser(c *gin.Context) (string, bool) {
	token, err := c.Cookie("admin_token")
	if err != nil || token == "" {
		return "", false
	}
	username, err := h.redis.Get(c.Request.Context(), adminSessionKey(token)).Result()
	if err != nil {
		return "", false
	}
	return username, true
}

// RequireAdmin is a Gin middleware guarding admin-only routes.
func (h *AdminHandler) RequireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		if _, ok := h.sessionUser(c); !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "请先登录管理员账号"})
			return
		}
		c.Next()
	}
}
