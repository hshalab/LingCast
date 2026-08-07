package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"talkingavatar/backend/internal/i18n"
	"talkingavatar/backend/internal/models"
)

const adminSessionTTL = 24 * time.Hour

// AdminHandler manages the admin login session (Redis-backed opaque token in
// an HttpOnly cookie). Credentials come from ADMIN_USERNAME / ADMIN_PASSWORD.
type AdminHandler struct {
	redis    *redis.Client
	db       *gorm.DB
	seedUser string
	seedPass string
}

func NewAdminHandler(db *gorm.DB, rc *redis.Client, seedUser, seedPass string) *AdminHandler {
	h := &AdminHandler{redis: rc, db: db, seedUser: seedUser, seedPass: seedPass}
	h.seed()
	return h
}

// seed creates the admin account from env credentials on first start (idempotent).
func (h *AdminHandler) seed() {
	var count int64
	if err := h.db.Model(&models.AdminUser{}).Count(&count).Error; err != nil || count > 0 {
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(h.seedPass), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("[admin] seed password hash failed: %v", err)
		return
	}
	if err := h.db.Create(&models.AdminUser{
		Username:     h.seedUser,
		DisplayName:  h.seedUser,
		PasswordHash: string(hash),
	}).Error; err != nil {
		log.Printf("[admin] seed failed: %v", err)
	}
}

func (h *AdminHandler) findUser(username string) (*models.AdminUser, error) {
	var user models.AdminUser
	err := h.db.Where("username = ?", strings.TrimSpace(username)).First(&user).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func adminSessionKey(token string) string {
	return "admin:session:" + token
}

// Login handles POST /api/admin/login.
// Login handles POST /api/admin/login.
// @Summary  Admin login (HttpOnly cookie session)
// @Tags     admin
// @Accept   json
// @Produce  json
// @Param    request body map[string]any true "username + password"
// @Success  200 {object} map[string]any
// @Failure  401 {object} map[string]any
// @Router   /admin/login [post]
func (h *AdminHandler) Login(c *gin.Context) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.invalid_request")})
		return
	}
	user, err := h.findUser(req.Username)
	if err != nil || bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)) != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": i18n.Tc(c, "err.admin.bad_credentials")})
		return
	}

	token, err := randomToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": i18n.Tc(c, "err.admin.session_issue")})
		return
	}
	ctx := c.Request.Context()
	if err := h.redis.Set(ctx, adminSessionKey(token), user.Username, adminSessionTTL).Err(); err != nil {
		log.Printf("[admin] session store failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": i18n.Tc(c, "err.admin.session_store_failed")})
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
	c.JSON(http.StatusOK, gin.H{"username": user.Username, "name": user.DisplayName})
}

func randomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// Me handles GET /api/admin/me — tells the frontend whether the session is valid.
// Me handles GET /api/admin/me.
// @Summary  Current admin profile
// @Tags     admin
// @Produce  json
// @Success  200 {object} map[string]any
// @Router   /admin/me [get]
func (h *AdminHandler) Me(c *gin.Context) {
	username, ok := h.sessionUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": i18n.Tc(c, "err.admin.not_logged_in")})
		return
	}
	user, err := h.findUser(username)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": i18n.Tc(c, "err.admin.account_missing")})
		return
	}
	c.JSON(http.StatusOK, gin.H{"username": user.Username, "name": user.DisplayName})
}

// Logout handles POST /api/admin/logout.
// Logout handles POST /api/admin/logout.
// @Summary  Admin logout
// @Tags     admin
// @Produce  json
// @Success  200 {object} map[string]any
// @Router   /admin/logout [post]
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

// ChangeName handles POST /api/admin/change-name — updates the display name.
// ChangeName handles POST /api/admin/change-name.
// @Summary  Change the admin display name
// @Tags     admin
// @Accept   json
// @Produce  json
// @Param    request body map[string]any true "new display name"
// @Success  200 {object} map[string]any
// @Router   /admin/change-name [post]
func (h *AdminHandler) ChangeName(c *gin.Context) {
	username, ok := h.sessionUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": i18n.Tc(c, "err.admin.not_logged_in")})
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.invalid_request")})
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || len(name) > 32 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.admin.name_length")})
		return
	}
	if err := h.db.Model(&models.AdminUser{}).
		Where("username = ?", username).
		Update("display_name", name).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"name": name})
}

// ChangePassword handles POST /api/admin/change-password.
// ChangePassword handles POST /api/admin/change-password.
// @Summary  Change the admin password (current password required)
// @Tags     admin
// @Accept   json
// @Produce  json
// @Param    request body map[string]any true "currentPassword + newPassword"
// @Success  200 {object} map[string]any
// @Router   /admin/change-password [post]
func (h *AdminHandler) ChangePassword(c *gin.Context) {
	username, ok := h.sessionUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": i18n.Tc(c, "err.admin.not_logged_in")})
		return
	}
	var req struct {
		OldPassword string `json:"oldPassword"`
		NewPassword string `json:"newPassword"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.invalid_request")})
		return
	}
	if len(req.NewPassword) < 4 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.admin.password_short")})
		return
	}
	user, err := h.findUser(username)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": i18n.Tc(c, "err.admin.account_missing")})
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.OldPassword)) != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.admin.old_password_wrong")})
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": i18n.Tc(c, "err.admin.password_hash_failed")})
		return
	}
	if err := h.db.Model(user).Update("password_hash", string(hash)).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
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
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": i18n.Tc(c, "err.admin.require_login")})
			return
		}
		c.Next()
	}
}
