package handlers

import (
	"bytes"
	"context"
	"net/http"
	"os/exec"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type previewTTSRequest struct {
	VoiceID string `json:"voiceId"`
	Text    string `json:"text"`
}

// PreviewTTS handles POST /api/tts/preview. It synthesizes a short sample
// with the selected Edge-TTS voice (via the bundled `python3 -m edge_tts`
// CLI in the API image) and returns MP3 bytes so the frontend can audition
// voices before creating an avatar.
func PreviewTTS(c *gin.Context) {
	var req previewTTSRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body: " + err.Error()})
		return
	}
	voiceID := strings.TrimSpace(req.VoiceID)
	text := strings.TrimSpace(req.Text)
	if voiceID == "" || text == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "fields 'voiceId' and 'text' are required"})
		return
	}
	if len([]rune(text)) > 200 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "preview text too long (max 200 chars)"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(
		ctx,
		"python3", "-m", "edge_tts",
		"--voice", voiceID,
		"--text", text,
		"--write-media", "-",
	)
	var out, errBuf bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errBuf
	if err := cmd.Run(); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{
			"error": "tts preview failed: " + strings.TrimSpace(errBuf.String()),
		})
		return
	}
	if out.Len() == 0 {
		c.JSON(http.StatusBadGateway, gin.H{"error": "tts preview returned empty audio"})
		return
	}
	c.Data(http.StatusOK, "audio/mpeg", out.Bytes())
}
