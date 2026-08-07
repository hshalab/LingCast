package handlers

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"talkingavatar/backend/internal/i18n"
	"talkingavatar/backend/internal/models"
)

// TelegramAuthHandler validates Telegram Mini App initData (HMAC-SHA-256)
// against the bot token and upserts a ChatUser identity (no passwords).
type TelegramAuthHandler struct {
	db       *gorm.DB
	botToken string
}

func NewTelegramAuthHandler(db *gorm.DB, botToken string) *TelegramAuthHandler {
	return &TelegramAuthHandler{db: db, botToken: botToken}
}

// telegramSecret derives the HMAC secret from the bot token:
// secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token).
func telegramSecret(botToken string) []byte {
	mac := hmac.New(sha256.New, []byte("WebAppData"))
	_, _ = mac.Write([]byte(botToken))
	return mac.Sum(nil)
}

// telegramValidate verifies the initData signature (data-check-string + hash)
// and returns the decoded fields. The data-check-string is every field except
// `hash`, sorted alphabetically as key=value lines joined by '\n' (values are
// the URL-decoded ones from ParseQuery).
func telegramValidate(botToken, initData string) (map[string]string, error) {
	values, err := url.ParseQuery(initData)
	if err != nil {
		return nil, fmt.Errorf("bad initData: %w", err)
	}
	got := values.Get("hash")
	if got == "" {
		return nil, errors.New("initData missing hash")
	}

	keys := make([]string, 0, len(values))
	for k := range values {
		if k == "hash" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var check strings.Builder
	for i, k := range keys {
		if i > 0 {
			check.WriteByte('\n')
		}
		check.WriteString(k)
		check.WriteByte('=')
		check.WriteString(values.Get(k))
	}

	mac := hmac.New(sha256.New, telegramSecret(botToken))
	_, _ = mac.Write([]byte(check.String()))
	calc := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(calc), []byte(got)) {
		return nil, errors.New("initData hash mismatch")
	}

	// Freshness: Telegram recommends re-validating data older than 24h.
	if authDate := values.Get("auth_date"); authDate != "" {
		if sec, err := strconv.ParseInt(authDate, 10, 64); err == nil {
			if time.Since(time.Unix(sec, 0)) > 24*time.Hour {
				return nil, errors.New("initData expired")
			}
		}
	}

	out := make(map[string]string, len(values))
	for k, v := range values {
		if len(v) > 0 {
			out[k] = v[0]
		}
	}
	return out, nil
}

// Login handles POST /api/auth/telegram — validates initData, upserts the
// Telegram identity, sets an HttpOnly session cookie and returns the user.
// @Summary  Telegram Mini App login (initData HMAC validation)
// @Tags     auth
// @Accept   json
// @Produce  json
// @Param    request body map[string]any true "initData"
// @Success  200 {object} map[string]any
// @Router   /auth/telegram [post]
func (h *TelegramAuthHandler) Login(c *gin.Context) {
	if strings.TrimSpace(h.botToken) == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": i18n.Tc(c, "err.tg.not_configured")})
		return
	}
	var req struct {
		InitData string `json:"initData"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.InitData) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.tg.init_data_required")})
		return
	}
	fields, err := telegramValidate(h.botToken, req.InitData)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": i18n.Tc(c, "err.tg.invalid_init_data")})
		return
	}
	var tgUser struct {
		ID       int64  `json:"id"`
		Username string `json:"username"`
	}
	if err := json.Unmarshal([]byte(fields["user"]), &tgUser); err != nil || tgUser.ID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": i18n.Tc(c, "err.tg.invalid_user")})
		return
	}

	user, err := h.upsertUser(tgUser.ID, tgUser.Username)
	if err != nil {
		log.Printf("[tg] upsert user %d failed: %v", tgUser.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": i18n.Tc(c, "err.internal")})
		return
	}

	// HttpOnly cookie for session continuity; the audience chat flow also
	// passes userId explicitly, so the JSON body is the source of truth.
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie("tg_uid", strconv.FormatUint(uint64(user.ID), 10),
		30*24*3600, "/", "", false, true)
	c.JSON(http.StatusOK, gin.H{
		"userId":     user.ID,
		"username":   user.Username,
		"isGuest":    false,
		"telegramId": tgUser.ID,
	})
}

// upsertUser finds the ChatUser bound to the Telegram ID or silently creates
// one (preferring the Telegram username, falling back to tg_<id> on collision).
func (h *TelegramAuthHandler) upsertUser(tgID int64, tgUsername string) (*models.ChatUser, error) {
	var user models.ChatUser
	err := h.db.Where("telegram_id = ?", tgID).First(&user).Error
	if err == nil {
		if name := sanitizeTelegramUsername(tgUsername); name != "" && name != user.Username {
			_ = h.db.Model(&user).Update("username", name)
		}
		return &user, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	username := sanitizeTelegramUsername(tgUsername)
	if username == "" {
		username = fmt.Sprintf("tg_%d", tgID)
	}
	// Map-based create writes the keys verbatim: struct Create would skip the
	// false IsGuest zero value because of its `default:true` tag.
	createUser := func(name string) error {
		return h.db.Model(&models.ChatUser{}).Create(map[string]any{
			"username":    name,
			"is_guest":    false,
			"telegram_id": tgID,
		}).Error
	}
	if err := createUser(username); err == nil {
		// Re-read the row so the returned struct carries the DB id.
		if err := h.db.Where("telegram_id = ?", tgID).First(&user).Error; err != nil {
			return nil, err
		}
		return &user, nil
	} else if !strings.Contains(err.Error(), "Duplicate") {
		return nil, err
	}
	// Username already taken by another identity — fall back to the unique ID.
	if err := createUser(fmt.Sprintf("tg_%d", tgID)); err != nil {
		return nil, err
	}
	if err := h.db.Where("telegram_id = ?", tgID).First(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func sanitizeTelegramUsername(s string) string {
	s = strings.TrimSpace(s)
	var b strings.Builder
	for _, r := range s {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' ||
			r >= '0' && r <= '9' || r == '_' || r == '-' {
			b.WriteRune(r)
		}
	}
	out := b.String()
	if len(out) > 60 {
		out = out[:60]
	}
	return out
}
