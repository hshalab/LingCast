package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
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

	h := NewTelegramWebhookHandler(nil, "token", ngrok.URL)
	url, err := h.discoverPublicURL(context.Background())
	if err != nil {
		t.Fatalf("discovery failed: %v", err)
	}
	if url != "https://api.ngrok.app" {
		t.Fatalf("got %q, want https://api.ngrok.app", url)
	}
}

func TestDiscoverPublicURLTunnelNotReady(t *testing.T) {
	ngrok := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"tunnels": []any{}})
	}))
	defer ngrok.Close()

	h := NewTelegramWebhookHandler(nil, "token", ngrok.URL)
	if _, err := h.discoverPublicURL(context.Background()); err == nil {
		t.Fatal("expected an error when the api-gateway tunnel is missing")
	}
}

func TestSetWebhook(t *testing.T) {
	var gotURL string
	tg := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/bottoken/setWebhook" {
			http.NotFound(w, r)
			return
		}
		var body struct {
			URL string `json:"url"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		gotURL = body.URL
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer tg.Close()

	h := &TelegramWebhookHandler{botToken: "token", telegramAPIBase: tg.URL}
	if err := h.setWebhook(context.Background(), "https://api.ngrok.app"); err != nil {
		t.Fatalf("setWebhook failed: %v", err)
	}
	if gotURL != "https://api.ngrok.app/api/telegram/webhook" {
		t.Fatalf("got webhook url %q", gotURL)
	}
}

func TestRegisterWithRetry(t *testing.T) {
	var calls atomic.Int32
	ngrok := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		// Tunnel appears only on the 3rd poll: exercises the retry path.
		if calls.Add(1) < 3 {
			_ = json.NewEncoder(w).Encode(map[string]any{"tunnels": []any{}})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"tunnels": []map[string]any{
				{"name": "api-gateway", "public_url": "https://api.ngrok.app"},
			},
		})
	}))
	defer ngrok.Close()

	var registered atomic.Int32
	tg := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/bottoken/setWebhook" {
			http.NotFound(w, r)
			return
		}
		registered.Add(1)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer tg.Close()

	h := &TelegramWebhookHandler{
		botToken:        "token",
		ngrokAPIURL:     ngrok.URL,
		telegramAPIBase: tg.URL,
	}
	h.RegisterWithRetry(context.Background())

	if registered.Load() != 1 {
		t.Fatalf("setWebhook called %d times, want 1", registered.Load())
	}
	if calls.Load() != 3 {
		t.Fatalf("ngrok polled %d times, want 3", calls.Load())
	}
}

func TestRegisterWithRetrySkipsWithoutToken(t *testing.T) {
	h := NewTelegramWebhookHandler(nil, "", "http://ngrok:4040")
	h.RegisterWithRetry(context.Background()) // must return immediately, no panic
	if !strings.Contains(t.Name(), "Skip") {
		t.Log("no-op path OK")
	}
}
