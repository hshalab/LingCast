// Package i18n provides lightweight request-localized user-facing messages
// for the API. The locale is detected from the Accept-Language header
// (defaults to zh-CN) and stored in the Gin context by Middleware.
package i18n

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
)

// LangKey is the Gin context key holding the resolved language tag.
const LangKey = "lang"

// DefaultLang is used when no Accept-Language header matches.
const DefaultLang = "zh"

type catalog map[string]string

var catalogs = map[string]catalog{
	"zh": zh,
	"en": en,
}

// Detect resolves an Accept-Language header value to a supported language tag
// (currently "zh" or "en"), falling back to DefaultLang.
func Detect(header string) string {
	if header == "" {
		return DefaultLang
	}
	for _, part := range strings.Split(header, ",") {
		lang := strings.TrimSpace(part)
		if idx := strings.Index(lang, ";"); idx >= 0 {
			lang = lang[:idx]
		}
		lang = strings.ToLower(strings.TrimSpace(lang))
		switch {
		case strings.HasPrefix(lang, "zh"):
			return "zh"
		case strings.HasPrefix(lang, "en"):
			return "en"
		}
	}
	return DefaultLang
}

// Middleware resolves the request locale and stores it in the Gin context.
func Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Set(LangKey, Detect(c.GetHeader("Accept-Language")))
		c.Next()
	}
}

// Lang returns the resolved language tag for the request.
func Lang(c *gin.Context) string {
	if lang, ok := c.Get(LangKey); ok {
		if s, ok := lang.(string); ok && s != "" {
			return s
		}
	}
	return DefaultLang
}

// T returns the localized message for key in the given language. Unknown
// keys fall back to English, then to the key itself.
func T(lang, key string) string {
	if msg, ok := catalogs[lang][key]; ok {
		return msg
	}
	if msg, ok := en[key]; ok {
		return msg
	}
	return key
}

// Tf formats a localized message with the given arguments (fmt.Sprintf).
func Tf(lang, key string, args ...any) string {
	return fmt.Sprintf(T(lang, key), args...)
}

// Tc is a convenience for handlers: localized message for the request.
func Tc(c *gin.Context, key string) string {
	return T(Lang(c), key)
}

// Tcf is Tc with fmt.Sprintf-style arguments.
func Tcf(c *gin.Context, key string, args ...any) string {
	return Tf(Lang(c), key, args...)
}
