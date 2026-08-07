package telegram

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	ngrokWebhookTunnel  = "api-gateway"
	ngrokMiniAppTunnel  = "tg-app"
	telegramWebhookPath = "/api/telegram/webhook"
	webhookRetryEvery   = 2 * time.Second
	webhookMaxAttempts  = 10
)

// TelegramWebhookHandler resolves the public Telegram-facing URLs (fixed
// production domains first, ngrok tunnel discovery as fallback), registers
// the update webhook and the Mini App menu button, and serves the webhook
// endpoint itself (placeholder until the update flow lands).
type TelegramWebhookHandler struct {
	db              *gorm.DB
	botToken        string
	ngrokAPIURL     string
	webhookURL      string // TG_WEBHOOK_URL ("" = discover via ngrok)
	miniAppURL      string // TG_MINIAPP_URL ("" = discover via ngrok)
	telegramAPIBase string
}

func NewTelegramWebhookHandler(db *gorm.DB, botToken, ngrokAPIURL, webhookURL, miniAppURL string) *TelegramWebhookHandler {
	return &TelegramWebhookHandler{
		db:              db,
		botToken:        botToken,
		ngrokAPIURL:     ngrokAPIURL,
		webhookURL:      strings.TrimSpace(webhookURL),
		miniAppURL:      strings.TrimSpace(miniAppURL),
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
// the named tunnel (empty string when not found yet).
func (h *TelegramWebhookHandler) discoverPublicURL(ctx context.Context, tunnelName string) (string, error) {
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
		if t.Name == tunnelName && strings.TrimSpace(t.PublicURL) != "" {
			return strings.TrimRight(t.PublicURL, "/"), nil
		}
	}
	return "", fmt.Errorf("ngrok tunnel %q not found yet", tunnelName)
}

// setWebhook registers the resolved webhook URL with Telegram.
func (h *TelegramWebhookHandler) setWebhook(ctx context.Context, webhookURL string) error {
	body, err := json.Marshal(map[string]string{"url": webhookURL})
	if err != nil {
		return err
	}
	return h.telegramPost(ctx, "setWebhook", body)
}

// setChatMenuButton points the bot's menu button at the Mini App web_app URL.
func (h *TelegramWebhookHandler) setChatMenuButton(ctx context.Context, miniAppURL string) error {
	body, err := json.Marshal(map[string]any{
		"menu_button": map[string]any{
			"type":    "web_app",
			"text":    "灵播",
			"web_app": map[string]string{"url": miniAppURL},
		},
	})
	if err != nil {
		return err
	}
	return h.telegramPost(ctx, "setChatMenuButton", body)
}

// telegramPost posts a JSON payload to a bot API method and checks ok.
func (h *TelegramWebhookHandler) telegramPost(ctx context.Context, method string, body []byte) error {
	reqCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(
		reqCtx,
		http.MethodPost,
		fmt.Sprintf("%s/bot%s/%s", strings.TrimRight(h.telegramAPIBase, "/"), h.botToken, method),
		bytes.NewReader(body),
	)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("telegram %s request failed: %w", method, err)
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
		return fmt.Errorf("telegram rejected %s: %s", method, out.Description)
	}
	return nil
}

// RegisterWithRetry resolves the webhook + Mini App URLs (environment first,
// ngrok discovery as fallback) and registers them with Telegram. When both
// TG_WEBHOOK_URL and TG_MINIAPP_URL are set, ngrok is never polled. Runs in a
// background goroutine so it never blocks the Gin server from starting.
func (h *TelegramWebhookHandler) RegisterWithRetry(ctx context.Context) {
	if strings.TrimSpace(h.botToken) == "" {
		log.Printf("[tg] Telegram registration skipped: TG_BOT_TOKEN not configured")
		return
	}
	needWebhook := h.webhookURL == ""
	needMiniApp := h.miniAppURL == ""
	if (needWebhook || needMiniApp) && strings.TrimSpace(h.ngrokAPIURL) == "" {
		log.Printf("[tg] Telegram registration skipped: NGROK_API_URL not configured")
		return
	}
	if !needWebhook {
		log.Printf("[tg] webhook URL from environment: %s", h.webhookURL)
	}
	if !needMiniApp {
		log.Printf("[tg] mini app URL from environment: %s", h.miniAppURL)
	}

	webhookURL, miniAppURL := h.webhookURL, h.miniAppURL
	if needWebhook || needMiniApp {
		for attempt := 1; attempt <= webhookMaxAttempts; attempt++ {
			if ctx.Err() != nil {
				return
			}
			done := true
			if needWebhook && webhookURL == "" {
				if u, err := h.discoverPublicURL(ctx, ngrokWebhookTunnel); err != nil {
					log.Printf("[tg] ngrok webhook discovery attempt %d/%d failed: %v",
						attempt, webhookMaxAttempts, err)
					done = false
				} else {
					webhookURL = u + telegramWebhookPath
					log.Printf("[tg] webhook URL from ngrok (%s): %s", ngrokWebhookTunnel, webhookURL)
				}
			}
			if needMiniApp && miniAppURL == "" {
				if u, err := h.discoverPublicURL(ctx, ngrokMiniAppTunnel); err != nil {
					log.Printf("[tg] ngrok mini app discovery attempt %d/%d failed: %v",
						attempt, webhookMaxAttempts, err)
					done = false
				} else {
					miniAppURL = u
					log.Printf("[tg] mini app URL from ngrok (%s): %s", ngrokMiniAppTunnel, miniAppURL)
				}
			}
			if done {
				break
			}
			select {
			case <-time.After(webhookRetryEvery):
			case <-ctx.Done():
				return
			}
		}
	}

	if webhookURL != "" {
		if err := h.setWebhook(ctx, webhookURL); err != nil {
			log.Printf("[tg] setWebhook failed: %v", err)
		} else {
			log.Printf("[tg] webhook registered: %s", webhookURL)
		}
	} else {
		log.Printf("[tg] webhook registration failed after %d attempts", webhookMaxAttempts)
	}
	if miniAppURL != "" {
		if err := h.setChatMenuButton(ctx, miniAppURL); err != nil {
			log.Printf("[tg] setChatMenuButton failed: %v", err)
		} else {
			log.Printf("[tg] mini app menu button registered: %s", miniAppURL)
		}
	} else {
		log.Printf("[tg] mini app menu button registration failed after %d attempts", webhookMaxAttempts)
	}
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
