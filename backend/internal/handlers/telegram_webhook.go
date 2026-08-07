package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	ngrokTunnelName     = "api-gateway"
	telegramWebhookPath = "/api/telegram/webhook"
	webhookRetryEvery   = 2 * time.Second
	webhookMaxAttempts  = 10
)

// TelegramWebhookHandler discovers the public Ngrok URL of the api-gateway
// tunnel and registers it as the Telegram webhook at startup. It also serves
// the webhook endpoint itself (placeholder until the update flow lands).
type TelegramWebhookHandler struct {
	db          *gorm.DB
	botToken    string
	ngrokAPIURL string
	// telegramAPIBase is overridable in tests; production uses the real API.
	telegramAPIBase string
}

func NewTelegramWebhookHandler(db *gorm.DB, botToken, ngrokAPIURL string) *TelegramWebhookHandler {
	return &TelegramWebhookHandler{
		db:              db,
		botToken:        botToken,
		ngrokAPIURL:     ngrokAPIURL,
		telegramAPIBase: "https://api.telegram.org",
	}
}

// ngrokTunnel mirrors one entry of GET /api/tunnels.
type ngrokTunnel struct {
	Name      string `json:"name"`
	PublicURL string `json:"public_url"`
}

type ngrokTunnelsResponse struct {
	Tunnels []ngrokTunnel `json:"tunnels"`
}

// discoverPublicURL fetches the ngrok agent API and returns the public URL of
// the api-gateway tunnel (empty string when not found yet).
func (h *TelegramWebhookHandler) discoverPublicURL(ctx context.Context) (string, error) {
	reqCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(
		reqCtx,
		http.MethodGet,
		strings.TrimRight(h.ngrokAPIURL, "/")+"/api/tunnels",
		nil,
	)
	if err != nil {
		return "", err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("ngrok API unreachable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("ngrok API returned %d", resp.StatusCode)
	}
	var out ngrokTunnelsResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", fmt.Errorf("bad ngrok API response: %w", err)
	}
	for _, t := range out.Tunnels {
		if t.Name == ngrokTunnelName && strings.TrimSpace(t.PublicURL) != "" {
			return strings.TrimRight(t.PublicURL, "/"), nil
		}
	}
	return "", errors.New("api-gateway tunnel not found yet")
}

// setWebhook registers the public webhook URL with Telegram.
func (h *TelegramWebhookHandler) setWebhook(ctx context.Context, publicURL string) error {
	webhookURL := publicURL + telegramWebhookPath
	body, err := json.Marshal(map[string]string{"url": webhookURL})
	if err != nil {
		return err
	}
	reqCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(
		reqCtx,
		http.MethodPost,
		fmt.Sprintf("%s/bot%s/setWebhook", strings.TrimRight(h.telegramAPIBase, "/"), h.botToken),
		bytes.NewReader(body),
	)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("telegram setWebhook request failed: %w", err)
	}
	defer resp.Body.Close()
	var out struct {
		OK          bool   `json:"ok"`
		Description string `json:"description,omitempty"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return fmt.Errorf("bad telegram response: %w", err)
	}
	if !out.OK {
		return fmt.Errorf("telegram rejected setWebhook: %s", out.Description)
	}
	return nil
}

// RegisterWithRetry runs in a background goroutine: poll the ngrok API every
// 2s (up to 10 attempts) until the api-gateway tunnel is up, then register the
// webhook. It never blocks the Gin server from starting.
func (h *TelegramWebhookHandler) RegisterWithRetry(ctx context.Context) {
	if strings.TrimSpace(h.botToken) == "" {
		log.Printf("[tg] webhook registration skipped: TG_BOT_TOKEN not configured")
		return
	}
	if strings.TrimSpace(h.ngrokAPIURL) == "" {
		log.Printf("[tg] webhook registration skipped: NGROK_API_URL not configured")
		return
	}
	for attempt := 1; attempt <= webhookMaxAttempts; attempt++ {
		if ctx.Err() != nil {
			return
		}
		publicURL, err := h.discoverPublicURL(ctx)
		if err != nil {
			log.Printf("[tg] ngrok discovery attempt %d/%d failed: %v",
				attempt, webhookMaxAttempts, err)
		} else if err := h.setWebhook(ctx, publicURL); err != nil {
			log.Printf("[tg] setWebhook attempt %d/%d failed: %v",
				attempt, webhookMaxAttempts, err)
		} else {
			log.Printf("[tg] webhook registered: %s%s", publicURL, telegramWebhookPath)
			return
		}
		select {
		case <-time.After(webhookRetryEvery):
		case <-ctx.Done():
			return
		}
	}
	log.Printf("[tg] webhook registration failed after %d attempts", webhookMaxAttempts)
}

// Webhook handles POST /api/telegram/webhook — a placeholder that lets
// Telegram's webhook validation pass; update delivery lands here later.
// @Summary  Telegram webhook endpoint (placeholder)
// @Tags     telegram
// @Produce  json
// @Success  200 {object} map[string]any
// @Router   /telegram/webhook [post]
func (h *TelegramWebhookHandler) Webhook(c *gin.Context) {
	c.Status(http.StatusOK)
}
