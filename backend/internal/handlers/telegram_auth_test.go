package handlers

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"testing"
	"time"
)

// buildTelegramInitData signs fields the same way the Telegram client does:
// sorted key=value lines (minus hash) -> HMAC-SHA256 with the WebAppData
// secret derived from the bot token.
func buildTelegramInitData(botToken string, fields map[string]string) string {
	keys := make([]string, 0, len(fields))
	for k := range fields {
		if k != "hash" {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	var check strings.Builder
	for i, k := range keys {
		if i > 0 {
			check.WriteByte('\n')
		}
		check.WriteString(k)
		check.WriteByte('=')
		check.WriteString(fields[k])
	}
	mac := hmac.New(sha256.New, telegramSecret(botToken))
	_, _ = mac.Write([]byte(check.String()))
	fields["hash"] = hex.EncodeToString(mac.Sum(nil))

	vals := url.Values{}
	for k, v := range fields {
		vals.Set(k, v)
	}
	return vals.Encode()
}

func TestTelegramValidate(t *testing.T) {
	token := "123456:TEST-BOT-TOKEN"
	userJSON, _ := json.Marshal(map[string]any{
		"id":         279058397,
		"first_name": "Alice",
		"username":   "alice_tg",
	})
	fields := map[string]string{
		"query_id":  "AAHdF6IQAAAAAN0XohDhrOrc",
		"user":      string(userJSON),
		"auth_date": fmt.Sprintf("%d", time.Now().Unix()),
	}
	initData := buildTelegramInitData(token, fields)

	parsed, err := telegramValidate(token, initData)
	if err != nil {
		t.Fatalf("valid initData rejected: %v", err)
	}
	if parsed["user"] != string(userJSON) {
		t.Fatalf("user field mismatch: %q", parsed["user"])
	}

	// Any tampering must fail validation.
	if _, err := telegramValidate(token, strings.Replace(initData, "alice_tg", "mallory_tg", 1)); err == nil {
		t.Fatal("tampered initData accepted")
	}
	if _, err := telegramValidate("000000:WRONG-TOKEN", initData); err == nil {
		t.Fatal("wrong bot token accepted")
	}
}

func TestSanitizeTelegramUsername(t *testing.T) {
	if got := sanitizeTelegramUsername(" Alice_2 "); got != "Alice_2" {
		t.Fatalf("got %q", got)
	}
	if got := sanitizeTelegramUsername("中文名字!"); got != "" {
		t.Fatalf("got %q", got)
	}
}
