package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"talkingavatar/backend/internal/i18n"
)

type previewTTSRequest struct {
	VoiceID string `json:"voiceId"`
	Text    string `json:"text"`
}

// PreviewTTS returns the gin handler for POST /api/tts/preview. Voice
// audition is delegated to the service-tts microservice over HTTP — the API
// image no longer bundles python3 / edge-tts. The preview is a one-shot
// throwaway sample, so the service streams the bytes back directly (no S3).
// @Summary  Voice audition (MP3 bytes, proxied to service-tts)
// @Tags     tts
// @Accept   json
// @Produce  audio/mpeg
// @Param    request body map[string]any true "voiceId + text (<=200 chars)"
// @Success  200 {string} string "audio/mpeg bytes"
// @Failure  400 {object} map[string]any
// @Router   /tts/preview [post]
func PreviewTTS(serviceURL string) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req previewTTSRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tcf(c, "err.invalid_request_body", err.Error())})
			return
		}
		voiceID := strings.TrimSpace(req.VoiceID)
		text := strings.TrimSpace(req.Text)
		if voiceID == "" || text == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.tts.fields_required")})
			return
		}
		if len([]rune(text)) > 200 {
			c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.tts.text_too_long")})
			return
		}

		body, err := json.Marshal(map[string]string{"voiceId": voiceID, "text": text})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
		defer cancel()
		url := strings.TrimRight(serviceURL, "/") + "/v1/tts/preview"
		httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{
				"error": i18n.Tcf(c, "err.tts.preview_failed", err.Error()),
			})
			return
		}
		httpReq.Header.Set("Content-Type", "application/json")

		resp, err := http.DefaultClient.Do(httpReq)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{
				"error": i18n.Tcf(c, "err.tts.preview_failed", err.Error()),
			})
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			msg, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
			c.JSON(http.StatusBadGateway, gin.H{
				"error": i18n.Tcf(c, "err.tts.preview_failed", strings.TrimSpace(string(msg))),
			})
			return
		}

		data, err := io.ReadAll(resp.Body)
		if err != nil || len(data) == 0 {
			c.JSON(http.StatusBadGateway, gin.H{"error": i18n.Tc(c, "err.tts.empty_audio")})
			return
		}
		c.Data(http.StatusOK, "audio/mpeg", data)
	}
}
