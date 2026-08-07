package web

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"gorm.io/gorm"

	"talkingavatar/backend/internal/app"
	"talkingavatar/backend/internal/config"
	"talkingavatar/backend/internal/i18n"
	"talkingavatar/backend/internal/models"
)

func getOauthConfig(cfg config.Config) *oauth2.Config {
	return &oauth2.Config{
		ClientID:     cfg.GoogleClientID,
		ClientSecret: cfg.GoogleClientSecret,
		RedirectURL:  cfg.GoogleRedirectURL,
		Scopes: []string{
			"https://www.googleapis.com/auth/userinfo.email",
			"https://www.googleapis.com/auth/userinfo.profile",
		},
		Endpoint: google.Endpoint,
	}
}

func generateState() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func GoogleLogin(c *gin.Context, cfg config.Config, deps *app.Deps) {
	if cfg.GoogleClientID == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Google OAuth not configured"})
		return
	}
	state := generateState()
	deps.Redis.Set(context.Background(), "oauth_state:"+state, "1", 5*time.Minute)

	url := getOauthConfig(cfg).AuthCodeURL(state)
	c.Redirect(http.StatusTemporaryRedirect, url)
}

func GoogleCallback(c *gin.Context, cfg config.Config, deps *app.Deps) {
	state := c.Query("state")
	code := c.Query("code")

	val, err := deps.Redis.Get(context.Background(), "oauth_state:"+state).Result()
	if err != nil || val != "1" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired state"})
		return
	}
	deps.Redis.Del(context.Background(), "oauth_state:"+state)

	token, err := getOauthConfig(cfg).Exchange(context.Background(), code)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to exchange token"})
		return
	}

	client := getOauthConfig(cfg).Client(context.Background(), token)
	resp, err := client.Get("https://www.googleapis.com/oauth2/v2/userinfo")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get user info"})
		return
	}
	defer resp.Body.Close()

	var userInfo struct {
		ID    string `json:"id"`
		Email string `json:"email"`
		Name  string `json:"name"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&userInfo); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to decode user info"})
		return
	}

	user, err := upsertGoogleUser(deps.DB, userInfo.ID, userInfo.Email, userInfo.Name)
	if err != nil {
		log.Printf("[web] upsert google user %s failed: %v", userInfo.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": i18n.Tc(c, "err.internal")})
		return
	}

	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie("web_uid", strconv.FormatUint(uint64(user.ID), 10),
		30*24*3600, "/", "", false, true)

	c.Redirect(http.StatusTemporaryRedirect, "http://localhost:3001/")
}

func upsertGoogleUser(db *gorm.DB, googleID, email, name string) (*models.LiveUser, error) {
	var user models.LiveUser
	err := db.Where("google_id = ?", googleID).First(&user).Error
	if err == nil {
		return &user, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	username := name
	if username == "" {
		parts := strings.Split(email, "@")
		if len(parts) > 0 {
			username = parts[0]
		}
	}
	if username == "" {
		username = "user_" + googleID[:8]
	}
	// Sanitize username simple rule for now
	username = strings.ReplaceAll(username, " ", "_")
	
	createUser := func(uname string) error {
		createMap := map[string]any{
			"username":  uname,
			"is_guest":  false,
			"google_id": googleID,
		}
		return db.Model(&models.LiveUser{}).Create(createMap).Error
	}

	if err := createUser(username); err == nil {
		if err := db.Where("google_id = ?", googleID).First(&user).Error; err != nil {
			return nil, err
		}
		return &user, nil
	} else if !strings.Contains(err.Error(), "Duplicate") {
		return nil, err
	}

	if err := createUser(username + "_" + googleID[:4]); err != nil {
		return nil, err
	}
	if err := db.Where("google_id = ?", googleID).First(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func GetMe(c *gin.Context, cfg config.Config, deps *app.Deps) {
	uidStr, err := c.Cookie("web_uid")
	if err != nil || uidStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not logged in"})
		return
	}
	uid, _ := strconv.Atoi(uidStr)
	var user models.LiveUser
	if err := deps.DB.First(&user, uid).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"id": user.ID,
		"username": user.Username,
		"isGuest": user.IsGuest,
	})
}

func Logout(c *gin.Context, cfg config.Config, deps *app.Deps) {
	c.SetCookie("web_uid", "", -1, "/", "", false, true)
	c.Redirect(http.StatusTemporaryRedirect, "http://localhost:3001/")
}
