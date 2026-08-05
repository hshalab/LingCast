package handlers

import (
	"errors"
	"fmt"
	"math/rand/v2"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"talkingavatar/backend/internal/models"
)

// ChatHandler manages viewer chat identities and the persisted per-room chat
// history (viewer messages + bot replies).
type ChatHandler struct {
	db *gorm.DB
}

func NewChatHandler(db *gorm.DB) *ChatHandler {
	return &ChatHandler{db: db}
}

type chatIdentityResponse struct {
	UserID   uint   `json:"userId"`
	Username string `json:"username"`
	IsGuest  bool   `json:"isGuest"`
}

// Guest handles POST /api/chat/guest — creates a temporary viewer identity
// (no password) used to watch rooms and chat without an account.
func (h *ChatHandler) Guest(c *gin.Context) {
	for attempt := 0; attempt < 5; attempt++ {
		u := models.ChatUser{Username: fmt.Sprintf("游客%04d", rand.IntN(10000)), IsGuest: true}
		if err := h.db.Create(&u).Error; err != nil {
			// unique-index collision: retry with another suffix
			continue
		}
		c.JSON(http.StatusOK, chatIdentityResponse{UserID: u.ID, Username: u.Username, IsGuest: true})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": "could not allocate a guest identity"})
}

type chatRegisterRequest struct {
	GuestUserID uint   `json:"guestUserId"`
	Username    string `json:"username"`
	Password    string `json:"password"`
}

// Register handles POST /api/chat/register — upgrades the current guest row
// into a real account (same user ID, so the guest's chat history is kept).
func (h *ChatHandler) Register(c *gin.Context) {
	var req chatRegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
		return
	}
	username := strings.TrimSpace(req.Username)
	if username == "" || len(username) > 32 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "用户名需为 1-32 个字符"})
		return
	}
	if len(req.Password) < 4 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "密码至少 4 位"})
		return
	}

	var taken models.ChatUser
	if err := h.db.Where("username = ?", username).First(&taken).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "用户名已被占用"})
		return
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "password hash failed"})
		return
	}

	if req.GuestUserID != 0 {
		var guest models.ChatUser
		if err := h.db.First(&guest, req.GuestUserID).Error; err == nil {
			if !guest.IsGuest {
				c.JSON(http.StatusConflict, gin.H{"error": "该身份已注册，请直接登录"})
				return
			}
			guest.Username = username
			guest.PasswordHash = string(hash)
			guest.IsGuest = false
			if err := h.db.Save(&guest).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, chatIdentityResponse{UserID: guest.ID, Username: guest.Username})
			return
		}
	}

	// No usable guest row: create a fresh account.
	u := models.ChatUser{Username: username, PasswordHash: string(hash)}
	if err := h.db.Create(&u).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, chatIdentityResponse{UserID: u.ID, Username: u.Username})
}

type chatLoginRequest struct {
	GuestUserID uint   `json:"guestUserId"`
	Username    string `json:"username"`
	Password    string `json:"password"`
}

// Login handles POST /api/chat/login — verifies an account and merges the
// current guest's chat messages into it, so nothing is lost when switching
// from a guest session to a logged-in account.
func (h *ChatHandler) Login(c *gin.Context) {
	var req chatLoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
		return
	}

	var user models.ChatUser
	if err := h.db.Where("username = ?", strings.TrimSpace(req.Username)).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "用户名或密码错误"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	if user.IsGuest ||
		bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)) != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "用户名或密码错误"})
		return
	}

	if req.GuestUserID != 0 && req.GuestUserID != user.ID {
		if err := h.db.Model(&models.ChatMessage{}).
			Where("user_id = ?", req.GuestUserID).
			Update("user_id", user.ID).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		_ = h.db.Delete(&models.ChatUser{}, req.GuestUserID)
	}

	c.JSON(http.StatusOK, chatIdentityResponse{UserID: user.ID, Username: user.Username})
}

// History handles GET /api/chat/history?avatarId= — the persisted room chat
// (viewer messages + bot replies), newest 200 rows ordered oldest first.
func (h *ChatHandler) History(c *gin.Context) {
	avatarID, err := strconv.ParseUint(c.Query("avatarId"), 10, 64)
	if err != nil || avatarID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "avatarId is required"})
		return
	}
	var msgs []models.ChatMessage
	if err := h.db.Where("avatar_id = ?", avatarID).
		Order("id asc").Limit(200).Find(&msgs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": msgs})
}
