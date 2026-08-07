package web

import (
	"encoding/json"
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
	SenderID   uint   `json:"senderId"`
	Username string `json:"username"`
	IsGuest  bool   `json:"isGuest"`
}

// Guest handles POST /api/chat/guest — creates a temporary viewer identity
// (no password) used to watch rooms and chat without an account.
// Guest handles POST /api/chat/guest.
// @Summary  Get a temporary guest identity
// @Tags     chat
// @Produce  json
// @Success  200 {object} map[string]any
// @Router   /chat/guest [post]
func (h *ChatHandler) Guest(c *gin.Context) {
	for attempt := 0; attempt < 5; attempt++ {
		u := models.LiveUser{Username: fmt.Sprintf("游客%04d", rand.IntN(10000)), IsGuest: true}
		if err := h.db.Create(&u).Error; err != nil {
			// unique-index collision: retry with another suffix
			continue
		}
		c.JSON(http.StatusOK, chatIdentityResponse{SenderID: u.ID, Username: u.Username, IsGuest: true})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": i18n.Tc(c, "err.chat.guest_alloc_failed")})
}

type chatRegisterRequest struct {
	GuestSenderID uint   `json:"guestUserId"`
	Username    string `json:"username"`
	Password    string `json:"password"`
}

// Register handles POST /api/chat/register — upgrades the current guest row
// into a real account (same user ID, so the guest's chat history is kept).
// Register handles POST /api/chat/register.
// @Summary  Register (upgrades the guest row, keeps history)
// @Tags     chat
// @Accept   json
// @Produce  json
// @Param    request body map[string]any true "registration form"
// @Success  200 {object} map[string]any
// @Router   /chat/register [post]
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

	var taken models.LiveUser
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

	if req.GuestSenderID != 0 {
		var guest models.LiveUser
		if err := h.db.First(&guest, req.GuestSenderID).Error; err == nil {
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
			c.JSON(http.StatusOK, chatIdentityResponse{SenderID: guest.ID, Username: guest.Username})
			return
		}
	}

	// No usable guest row: create a fresh account.
	u := models.LiveUser{Username: username, PasswordHash: string(hash)}
	if err := h.db.Create(&u).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, chatIdentityResponse{SenderID: u.ID, Username: u.Username})
}

type chatLoginRequest struct {
	GuestSenderID uint   `json:"guestUserId"`
	Username    string `json:"username"`
	Password    string `json:"password"`
}

// Login handles POST /api/chat/login — verifies an account and merges the
// current guest's chat messages into it, so nothing is lost when switching
// from a guest session to a logged-in account.
// Login handles POST /api/chat/login.
// @Summary  Login (merges guest messages into the account)
// @Tags     chat
// @Accept   json
// @Produce  json
// @Param    request body map[string]any true "login form"
// @Success  200 {object} map[string]any
// @Router   /chat/login [post]
func (h *ChatHandler) Login(c *gin.Context) {
	var req chatLoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tcf(c, "err.invalid_request_detail", err.Error())})
		return
	}

	var user models.LiveUser
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

	if req.GuestSenderID != 0 && req.GuestSenderID != user.ID {
		if err := h.db.Model(&models.LiveMessage{}).
			Where("sender_id = ?", req.GuestSenderID).
			Update("sender_id", user.ID).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		_ = h.db.Delete(&models.LiveUser{}, req.GuestSenderID)
	}

	c.JSON(http.StatusOK, chatIdentityResponse{SenderID: user.ID,
		Username: user.Username})
}

// History handles GET /api/chat/history?avatarId= — the persisted room chat
// (viewer messages + bot replies), newest 200 rows ordered oldest first.
// History handles GET /api/chat/history.
// @Summary  Persisted room chat history (paginated)
// @Tags     chat
// @Produce  json
// @Param    avatarId query int false "Filter by avatar"
// @Param    senderId query int false "Filter by user"
// @Param    page query int false "Page (1-based)"
// @Param    pageSize query int false "Page size"
// @Success  200 {object} map[string]any
// @Router   /chat/history [get]
func (h *ChatHandler) History(c *gin.Context) {
	var avatarID uint64
	if q := c.Query("avatarId"); q != "" {
		id, err := strconv.ParseUint(q, 10, 64)
		if err != nil || id == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.chat.avatar_id_required")})
			return
		}
		avatarID = id
	}
	userID, _ := strconv.ParseUint(c.Query("senderId"), 10, 64)
	if avatarID == 0 && userID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.chat.avatar_id_required")})
		return
	}
	var msgs []models.LiveMessage
	q := h.db.Model(&models.LiveMessage{})
	if avatarID > 0 {
		q = q.Where("avatar_id = ?", avatarID)
	}
	if userID > 0 {
		q = q.Where("sender_id = ?", userID)
	}
	if err := q.
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

type chatLogItem struct {
	ID         uint      `json:"id"`
	AvatarID   uint      `json:"avatarId"`
	AvatarName string    `json:"avatarName,omitempty"`
	SenderID     uint      `json:"senderId"`
	Username   string    `json:"username"`
	Role       string    `json:"role"`
	Content    string    `json:"content"`
	RAGHit     bool      `json:"ragHit"`
	RAGSources []string  `json:"ragSources,omitempty"`
	CreatedAt  time.Time `json:"createdAt"`
}

// ListUsers handles GET /api/users — the persisted chat users (guests and
// registered accounts) with their message counts, newest first.
// ListUsers handles GET /api/users.
// @Summary  User list (guests/accounts + message counts)
// @Tags     admin
// @Produce  json
// @Success  200 {object} map[string]any
// @Router   /users [get]
func (h *ChatHandler) ListUsers(c *gin.Context) {
	var users []models.LiveUser
	if err := h.db.Order("id desc").Limit(500).Find(&users).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	type countRow struct {
		SenderID uint
		C      int64
	}
	var counts []countRow
	if err := h.db.Model(&models.LiveMessage{}).
		Select("sender_id, count(*) as c").
		Where("role = ?", "user").
		Group("sender_id").
		Scan(&counts).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	msgCount := make(map[uint]int64, len(counts))
	for _, row := range counts {
		msgCount[row.SenderID] = row.C
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

// Logs handles GET /api/chat/logs — admin chat log with filters:
// ?avatarId=<id> &senderId=<id> &date=YYYY-MM-DD &q=<keyword>.
// Bot replies carry ragHit + the exact knowledge chunks that were retrieved.
// Logs handles GET /api/chat/logs.
// @Summary  Admin chat logs (avatarId/senderId/date/q + pagination)
// @Tags     admin
// @Produce  json
// @Param    avatarId query int false "Filter by avatar"
// @Param    senderId query int false "Filter by user"
// @Param    date query string false "Filter by date (YYYY-MM-DD)"
// @Param    q query string false "Keyword in message content"
// @Param    page query int false "Page (1-based)"
// @Param    pageSize query int false "Page size"
// @Success  200 {object} map[string]any
// @Router   /chat/logs [get]
func (h *ChatHandler) Logs(c *gin.Context) {
	type row struct {
		models.LiveMessage
		AvatarName string `json:"avatarName"`
	}
	q := h.db.Model(&models.LiveMessage{}).
		Select("live_messages.*, avatars.name AS avatar_name").
		Joins("LEFT JOIN avatars ON avatars.id = live_messages.avatar_id")

	if avatarID := c.Query("avatarId"); avatarID != "" {
		if id, err := strconv.ParseUint(avatarID, 10, 64); err == nil && id > 0 {
			q = q.Where("live_messages.avatar_id = ?", id)
		}
	}
	if userID := c.Query("senderId"); userID != "" {
		if id, err := strconv.ParseUint(userID, 10, 64); err == nil && id > 0 {
			q = q.Where("live_messages.sender_id = ?", id)
		}
	}
	if date := strings.TrimSpace(c.Query("date")); date != "" {
		if t, err := time.Parse("2006-01-02", date); err == nil {
			q = q.Where(
				"live_messages.created_at >= ? AND live_messages.created_at < ?",
				t, t.Add(24*time.Hour),
			)
		}
	}
	if kw := strings.TrimSpace(c.Query("q")); kw != "" {
		like := "%" + kw + "%"
		q = q.Where("live_messages.content LIKE ?", like)
	}

	page := 1
	pageSize := 20
	if p, err := strconv.Atoi(c.DefaultQuery("page", "1")); err == nil && p > 0 {
		page = p
	}
	if ps, err := strconv.Atoi(c.DefaultQuery("pageSize", "20")); err == nil && ps > 0 {
		pageSize = min(ps, 100)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	var rows []row
	if err := q.Order("live_messages.id desc").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	items := make([]chatLogItem, 0, len(rows))
	for _, r := range rows {
		item := chatLogItem{
			ID:         r.ID,
			AvatarID:   r.AvatarID,
			AvatarName: r.AvatarName,
			SenderID:     r.SenderID,
			Username:   r.Username,
			Role:       r.Role,
			Content:    r.Content,
			RAGHit:     r.RAGHit,
			CreatedAt:  r.CreatedAt,
		}
		if r.RAGSources != "" {
			var sources []string
			if err := json.Unmarshal([]byte(r.RAGSources), &sources); err == nil {
				item.RAGSources = sources
			}
		}
		items = append(items, item)
	}
	c.JSON(http.StatusOK, gin.H{
		"data":     items,
		"total":    total,
		"page":     page,
		"pageSize": pageSize,
	})
}
