package handlers

import (
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"talkingavatar/backend/internal/models"
	"talkingavatar/backend/internal/queue"
)

// sentenceSplit matches a run of sentence-final punctuation (Chinese and
// English, plus newlines). Sentences are kept intact including the delimiter.
var sentenceSplit = regexp.MustCompile(`[^。！？!?；;\n]+[。！？!?；;\n]*`)

// StreamHandler starts live streaming sessions: it splits a long text into
// sentence-level chunks and pushes them sequentially to the stream queue.
type StreamHandler struct {
	db             *gorm.DB
	q              *queue.Queue
	streamQueueKey string
}

type createStreamRequest struct {
	StreamID string `json:"streamId"` // optional; defaults to avatar_<id>_<ts>
	AvatarID uint   `json:"avatarId"`
	Text     string `json:"text"`
}

type createStreamResponse struct {
	StreamID   string `json:"streamId"`
	ChunkCount int    `json:"chunkCount"`
	Queue      string `json:"queue"`
	Playback   string `json:"playbackUrl,omitempty"`
}

func NewStreamHandler(db *gorm.DB, q *queue.Queue, streamQueueKey string) *StreamHandler {
	return &StreamHandler{db: db, q: q, streamQueueKey: streamQueueKey}
}

// Create handles POST /api/stream. It accepts a long text (or a stream of
// text), splits it into sentence chunks and pushes them in order to the Redis
// stream queue for stream_worker.py to pick up.
func (h *StreamHandler) Create(c *gin.Context) {
	var req createStreamRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body: " + err.Error()})
		return
	}
	if req.AvatarID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "field 'avatarId' is required"})
		return
	}
	if strings.TrimSpace(req.Text) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "field 'text' is required"})
		return
	}

	var avatar models.Avatar
	if err := h.db.First(&avatar, req.AvatarID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "avatar not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	chunks := splitSentences(req.Text)
	if len(chunks) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "text contains no sentences"})
		return
	}

	streamID := strings.TrimSpace(req.StreamID)
	if streamID == "" {
		streamID = fmt.Sprintf("avatar_%d_%d", avatar.ID, time.Now().UnixMilli())
	}

	for i, text := range chunks {
		payload := queue.StreamPayload{
			StreamID:        streamID,
			AvatarID:        avatar.ID,
			ChunkIndex:      i,
			Text:            text,
			ImageS3Key:      avatar.ImageS3Key,
			VoiceAudioS3Key: valueOrEmpty(avatar.VoiceAudioS3Key),
		}
		if err := h.q.PushTo(c.Request.Context(), h.streamQueueKey, payload); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "push stream chunk failed: " + err.Error()})
			return
		}
	}

	c.JSON(http.StatusAccepted, createStreamResponse{
		StreamID:   streamID,
		ChunkCount: len(chunks),
		Queue:      h.streamQueueKey,
		Playback:   "/live/" + streamID + ".flv",
	})
}

func splitSentences(text string) []string {
	matches := sentenceSplit.FindAllString(text, -1)
	out := make([]string, 0, len(matches))
	for _, m := range matches {
		if s := strings.TrimSpace(m); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func valueOrEmpty(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
