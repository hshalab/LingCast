package handlers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestDiscoverPublicURL(t *testing.T) {
	ngrok := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/tunnels" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"tunnels": []map[string]any{
				{"name": "tg-app", "public_url": "https://tg.ngrok.app"},
				{"name": "api-gateway", "public_url": "https://api.ngrok.app"},
			},
		})
	}))
	defer ngrok.Close()

	h := NewTelegramWebhookHandler(nil, "token", ngrok.URL, "", "")
	got, err := h.discoverPublicURL(context.Background(), ngrokWebhookTunnel)
	if err != nil || got != "https://api.ngrok.app" {
		t.Fatalf("webhook tunnel discovery: url=%q err=%v", got, err)
	}
	got, err = h.discoverPublicURL(context.Background(), ngrokMiniAppTunnel)
	if err != nil || got != "https://tg.ngrok.app" {
		t.Fatalf("mini app tunnel discovery: url=%q err=%v", got, err)
	}
}

func TestDiscoverPublicURLTunnelNotReady(t *testing.T) {
	ngrok := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"tunnels": []any{}})
	}))
	defer ngrok.Close()

	h := NewTelegramWebhookHandler(nil, "token", ngrok.URL, "", "")
	if _, err := h.discoverPublicURL(context.Background(), ngrokWebhookTunnel); err == nil {
		t.Fatal("expected an error when the tunnel is missing")
	}
}

func TestSetWebhook(t *testing.T) {
	var gotBody string
	tg := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer tg.Close()

	h := &TelegramWebhookHandler{botToken: "token", telegramAPIBase: tg.URL}
	if err := h.setWebhook(context.Background(), "https://api.ngrok.app/api/telegram/webhook"); err != nil {
		t.Fatalf("setWebhook failed: %v", err)
	}
	var payload map[string]string
	_ = json.Unmarshal([]byte(gotBody), &payload)
	if payload["url"] != "https://api.ngrok.app/api/telegram/webhook" {
		t.Fatalf("got payload %q", gotBody)
	}
}

func TestSetChatMenuButton(t *testing.T) {
	var gotBody string
	tg := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/bottoken/setChatMenuButton" {
			http.NotFound(w, r)
			return
		}
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer tg.Close()

	h := &TelegramWebhookHandler{botToken: "token", telegramAPIBase: tg.URL}
	if err := h.setChatMenuButton(context.Background(), "https://tg.ngrok.app"); err != nil {
		t.Fatalf("setChatMenuButton failed: %v", err)
	}
	var payload struct {
		MenuButton struct {
			Type   string `json:"type"`
			WebApp struct {
				URL string `json:"url"`
			} `json:"web_app"`
		} `json:"menu_button"`
	}
	_ = json.Unmarshal([]byte(gotBody), &payload)
	if payload.MenuButton.Type != "web_app" || payload.MenuButton.WebApp.URL != "https://tg.ngrok.app" {
		t.Fatalf("got payload %q", gotBody)
	}
}

func TestRegisterWithRetryNgrokFallback(t *testing.T) {
	var polls atomic.Int32
	ngrok := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if polls.Add(1) < 3 {
			_ = json.NewEncoder(w).Encode(map[string]any{"tunnels": []any{}})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"tunnels": []map[string]any{
				{"name": "api-gateway", "public_url": "https://api.ngrok.app"},
				{"name": "tg-app", "public_url": "https://tg.ngrok.app"},
			},
		})
	}))
	defer ngrok.Close()

	var calls []string
	tg := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.URL.Path)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer tg.Close()

	h := &TelegramWebhookHandler{
		botToken:        "token",
		ngrokAPIURL:     ngrok.URL,
		telegramAPIBase: tg.URL,
	}
	h.RegisterWithRetry(context.Background())

	// Two attempts x two tunnel lookups (webhook + mini app) per attempt.
	if polls.Load() != 4 {
		t.Fatalf("ngrok polled %d times, want 4", polls.Load())
	}
	got := map[string]bool{}
	for _, c := range calls {
		got[c] = true
	}
	if !got["/bottoken/setWebhook"] || !got["/bottoken/setChatMenuButton"] {
		t.Fatalf("missing registrations, got %v", calls)
	}
}

func TestRegisterWithRetryEnvOverrideSkipsNgrok(t *testing.T) {
	var ngrokCalls atomic.Int32
	ngrok := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		ngrokCalls.Add(1)
		http.Error(w, "should not be polled", http.StatusInternalServerError)
	}))
	defer ngrok.Close()

	var gotURLs []string
	tg := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		var payload map[string]any
		_ = json.Unmarshal(b, &payload)
		if url, ok := payload["url"].(string); ok {
			gotURLs = append(gotURLs, url)
		} else if mb, ok := payload["menu_button"].(map[string]any); ok {
			if wa, ok := mb["web_app"].(map[string]any); ok {
				gotURLs = append(gotURLs, wa["url"].(string))
			}
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer tg.Close()

	h := &TelegramWebhookHandler{
		botToken:        "token",
		ngrokAPIURL:     ngrok.URL,
		webhookURL:      "https://app.example.com/api/telegram/webhook",
		miniAppURL:      "https://t.example.com/app",
		telegramAPIBase: tg.URL,
	}
	h.RegisterWithRetry(context.Background())

	if ngrokCalls.Load() != 0 {
		t.Fatalf("ngrok was polled %d times, want 0", ngrokCalls.Load())
	}
	if len(gotURLs) != 2 ||
		gotURLs[0] != "https://app.example.com/api/telegram/webhook" ||
		gotURLs[1] != "https://t.example.com/app" {
		t.Fatalf("registered URLs = %v", gotURLs)
	}
}

func TestRegisterWithRetrySkipsWithoutToken(t *testing.T) {
	h := NewTelegramWebhookHandler(nil, "", "http://ngrok:4040", "", "")
	h.RegisterWithRetry(context.Background()) // must return immediately
}
