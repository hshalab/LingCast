package handlers

import (
	"errors"
	"fmt"
	"math/rand/v2"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"talkingavatar/backend/internal/i18n"
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
	c.JSON(http.StatusInternalServerError, gin.H{"error": i18n.Tc(c, "err.chat.guest_alloc_failed")})
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
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tcf(c, "err.invalid_request_detail", err.Error())})
		return
	}
	username := strings.TrimSpace(req.Username)
	if username == "" || len(username) > 32 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.chat.username_length")})
		return
	}
	if len(req.Password) < 4 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.chat.password_short")})
		return
	}

	var taken models.ChatUser
	if err := h.db.Where("username = ?", username).First(&taken).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": i18n.Tc(c, "err.chat.username_taken")})
		return
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": i18n.Tc(c, "err.admin.password_hash_failed")})
		return
	}

	if req.GuestUserID != 0 {
		var guest models.ChatUser
		if err := h.db.First(&guest, req.GuestUserID).Error; err == nil {
			if !guest.IsGuest {
				c.JSON(http.StatusConflict, gin.H{"error": i18n.Tc(c, "err.chat.already_registered")})
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
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tcf(c, "err.invalid_request_detail", err.Error())})
		return
	}

	var user models.ChatUser
	if err := h.db.Where("username = ?", strings.TrimSpace(req.Username)).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": i18n.Tc(c, "err.chat.bad_credentials")})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	if user.IsGuest ||
		bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)) != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": i18n.Tc(c, "err.chat.bad_credentials")})
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
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.chat.avatar_id_required")})
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

type userListItem struct {
	ID           uint      `json:"id"`
	Username     string    `json:"username"`
	IsGuest      bool      `json:"isGuest"`
	MessageCount int64     `json:"messageCount"`
	CreatedAt    time.Time `json:"createdAt"`
}

// ListUsers handles GET /api/users — the persisted chat users (guests and
// registered accounts) with their message counts, newest first.
func (h *ChatHandler) ListUsers(c *gin.Context) {
	var users []models.ChatUser
	if err := h.db.Order("id desc").Limit(500).Find(&users).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	type countRow struct {
		UserID uint
		C      int64
	}
	var counts []countRow
	if err := h.db.Model(&models.ChatMessage{}).
		Select("user_id, count(*) as c").
		Where("role = ?", "user").
		Group("user_id").
		Scan(&counts).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	msgCount := make(map[uint]int64, len(counts))
	for _, row := range counts {
		msgCount[row.UserID] = row.C
	}

	items := make([]userListItem, 0, len(users))
	for _, u := range users {
		items = append(items, userListItem{
			ID:           u.ID,
			Username:     u.Username,
			IsGuest:      u.IsGuest,
			MessageCount: msgCount[u.ID],
			CreatedAt:    u.CreatedAt,
		})
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}
