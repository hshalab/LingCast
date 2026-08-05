package handlers

import (
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"talkingavatar/backend/internal/models"
	"talkingavatar/backend/internal/queue"
	"talkingavatar/backend/internal/storage"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"github.com/openai/openai-go/responses"
)

// sentenceSplit matches a run of sentence-final punctuation (Chinese and
// English, plus newlines). Sentences are kept intact including the delimiter.
var sentenceSplit = regexp.MustCompile(`[^。！？!?；;\n]+[。！？!?；;\n]*`)

// LiveHandler manages live sessions: session lifecycle (start), per-avatar
// text intake (push, sentence-chunked into a Redis list) and status/queue
// monitoring (status) for the Live Studio frontend.
type LiveHandler struct {
	db                  *gorm.DB
	q                   *queue.Queue
	s3                  *storage.Client
	liveControlQueueKey string
	openAIAPIKey        string
	openAIBaseURL       string
	openAIModel         string
}

type startLiveRequest struct {
	StreamID string `json:"streamId"` // optional; defaults to avatar_<id>
}

type pushLiveRequest struct {
	Text string `json:"text"`
}

type liveMessageRequest struct {
	Text string `json:"text"`
}

type liveMessageResponse struct {
	Reply      string `json:"reply"`
	ChunkCount int    `json:"chunkCount"`
}

type liveSessionResponse struct {
	ID          uint   `json:"id"`
	AvatarID    uint   `json:"avatarId"`
	StreamID    string `json:"streamId"`
	Status      string `json:"status"`
	PlaybackURL string `json:"playbackUrl"`
}

type liveStatusResponse struct {
	AvatarID    uint     `json:"avatarId"`
	StreamID    string   `json:"streamId"`
	Status      string   `json:"status"`
	QueueLength int64    `json:"queueLength"`
	Pending     []string `json:"pending"`
	History     []string `json:"history"`
}

type liveSessionItem struct {
	AvatarID       uint   `json:"avatarId"`
	AvatarName     string `json:"avatarName"`
	ImageS3URL     string `json:"imageS3Url"`
	ImageS3Key     string `json:"imageS3Key"`
	BaseVideoS3Key string `json:"baseVideoS3Key"`
	VoiceID        string `json:"voiceId"`
	StreamID       string `json:"streamId"`
	Status         string `json:"status"`
}

func NewLiveHandler(db *gorm.DB, q *queue.Queue, s3 *storage.Client, liveControlQueueKey, openAIAPIKey, openAIBaseURL, openAIModel string) *LiveHandler {
	return &LiveHandler{
		db: db, q: q, s3: s3, liveControlQueueKey: liveControlQueueKey,
		openAIAPIKey: openAIAPIKey, openAIBaseURL: openAIBaseURL, openAIModel: openAIModel,
	}
}

func liveQueueKey(avatarID uint) string {
	return fmt.Sprintf("live_queue:%d", avatarID)
}

func liveHistoryKey(avatarID uint) string {
	return fmt.Sprintf("live_history:%d", avatarID)
}

// Start handles POST /api/live/:avatarID/start. It upserts a LiveSession in
// the database and tells the streaming worker to start the continuous FFmpeg
// pipe (idle mode: base animation + silent audio) for this avatar.
func (h *LiveHandler) Start(c *gin.Context) {
	avatarID, err := strconv.ParseUint(c.Param("avatarID"), 10, 64)
	if err != nil || avatarID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid avatarID"})
		return
	}

	var req startLiveRequest
	if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body: " + err.Error()})
		return
	}

	var avatar models.Avatar
	if err := h.db.First(&avatar, avatarID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "avatar not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	if avatar.Status != models.AvatarStatusReady || avatar.BaseVideoS3Key == nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "avatar is not ready yet (base video still generating), please try again later",
		})
		return
	}

	streamID := strings.TrimSpace(req.StreamID)
	if streamID == "" {
		streamID = fmt.Sprintf("avatar_%d", avatar.ID)
	}

	session := models.LiveSession{AvatarID: avatar.ID}
	err = h.db.Where(models.LiveSession{AvatarID: avatar.ID}).
		FirstOrCreate(&session).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	session.StreamID = streamID
	session.Status = models.LiveStatusIdle
	if err := h.db.Save(&session).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	payload := queue.LiveControlPayload{
		Action:         "start",
		AvatarID:       avatar.ID,
		StreamID:       streamID,
		ImageS3Key:     avatar.ImageS3Key,
		BaseVideoS3Key: *avatar.BaseVideoS3Key,
		VoiceID:        avatar.VoiceID,
	}
	if err := h.q.PushTo(c.Request.Context(), h.liveControlQueueKey, payload); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "notify worker failed: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, liveSessionResponse{
		ID:          session.ID,
		AvatarID:    avatar.ID,
		StreamID:    streamID,
		Status:      models.LiveStatusIdle,
		PlaybackURL: "/live/" + streamID + ".flv",
	})
}

// Stop handles POST /api/live/:avatarID/stop — tells the worker to close the
// FFmpeg pipe for this avatar's live session and removes the session record
// (GET status then returns 404 until the stream is started again).
func (h *LiveHandler) Stop(c *gin.Context) {
	avatarID, err := strconv.ParseUint(c.Param("avatarID"), 10, 64)
	if err != nil || avatarID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid avatarID"})
		return
	}

	var session models.LiveSession
	if err := h.db.Where("avatar_id = ?", avatarID).First(&session).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "live session not started"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	payload := queue.LiveControlPayload{
		Action:   "stop",
		AvatarID: session.AvatarID,
		StreamID: session.StreamID,
	}
	if err := h.q.PushTo(c.Request.Context(), h.liveControlQueueKey, payload); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "notify worker failed: " + err.Error()})
		return
	}
	if err := h.db.Delete(&session).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"stopped": session.AvatarID})
}

// Push handles POST /api/live/:avatarID/push. It chunks the incoming text by
// sentences and appends them to live_queue:<avatarID> for the worker.
func (h *LiveHandler) Push(c *gin.Context) {
	avatarID, err := strconv.ParseUint(c.Param("avatarID"), 10, 64)
	if err != nil || avatarID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid avatarID"})
		return
	}

	var req pushLiveRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body: " + err.Error()})
		return
	}
	if strings.TrimSpace(req.Text) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "field 'text' is required"})
		return
	}

	var avatar models.Avatar
	if err := h.db.First(&avatar, avatarID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "avatar not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	chunks := splitSentences(req.Text)
	key := liveQueueKey(avatar.ID)
	historyKey := liveHistoryKey(avatar.ID)
	for _, text := range chunks {
		if err := h.q.RPushList(c.Request.Context(), key, text); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "push chunk failed: " + err.Error()})
			return
		}
		_ = h.q.RPushList(c.Request.Context(), historyKey, text)
	}
	_ = h.q.TrimList(c.Request.Context(), historyKey, -200, -1)
	length, _ := h.q.ListLen(c.Request.Context(), key)
	c.JSON(http.StatusAccepted, gin.H{"accepted": len(chunks), "queueLength": length})
}

// Message handles POST /api/live/:avatarID/message — the audience-side chat
// entry. The user text goes to the LLM (OpenAI-compatible, DeepSeek by
// default), and the model's reply is sentence-chunked into the live queue so
// the worker can speak it (TTS -> lip-sync -> push). Without an API key the
// incoming text is spoken verbatim (test mode).
func (h *LiveHandler) Message(c *gin.Context) {
	avatarID, err := strconv.ParseUint(c.Param("avatarID"), 10, 64)
	if err != nil || avatarID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid avatarID"})
		return
	}
	var req liveMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Text) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "field 'text' is required"})
		return
	}

	var avatar models.Avatar
	if err := h.db.First(&avatar, avatarID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "avatar not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	reply := h.llmChat(c, req.Text, avatar.Name)
	chunks := splitSentences(reply)
	if len(chunks) == 0 {
		c.JSON(http.StatusBadGateway, gin.H{"error": "llm returned empty reply"})
		return
	}

	key := liveQueueKey(avatar.ID)
	historyKey := liveHistoryKey(avatar.ID)
	for _, text := range chunks {
		_ = h.q.RPushList(c.Request.Context(), key, text)
		_ = h.q.RPushList(c.Request.Context(), historyKey, text)
	}
	_ = h.q.TrimList(c.Request.Context(), historyKey, -200, -1)

	c.JSON(http.StatusOK, liveMessageResponse{Reply: reply, ChunkCount: len(chunks)})
}

// llmChat sends the user text to the LLM through the OpenAI SDK pointed at the
// configured base URL (DeepSeek by default, Responses API) and returns the
// assistant's reply. Without an API key the input is spoken verbatim (test).
func (h *LiveHandler) llmChat(c *gin.Context, userText, avatarName string) string {
	if strings.TrimSpace(h.openAIAPIKey) == "" {
		log.Printf("[llm] OPENAI_API_KEY not set, speaking the input verbatim")
		return userText
	}

	client := openai.NewClient(
		option.WithBaseURL(strings.TrimRight(h.openAIBaseURL, "/")),
		option.WithAPIKey(h.openAIAPIKey),
	)
	resp, err := client.Responses.New(c.Request.Context(), responses.ResponseNewParams{
		Model: h.openAIModel,
		Instructions: openai.String("你是一个直播间里的数字人主播「" + avatarName +
			"」，用简短、口语化、中文回复观众消息，单次回复不超过3句话。"),
		Input:           responses.ResponseNewParamsInputUnion{OfString: openai.String(userText)},
		Temperature:     openai.Float(0.8),
		MaxOutputTokens: openai.Int(300),
	})
	if err != nil {
		log.Printf("[llm] request failed: %v", err)
		return userText
	}
	reply := strings.TrimSpace(resp.OutputText())
	if reply == "" {
		return userText
	}
	log.Printf("[llm] %s -> %s", userText, reply)
	return reply
}

// Status handles GET /api/live/:avatarID/status. It returns the live session
// state plus the pending text chunks (and queue length) so the frontend can
// monitor what is waiting to be rendered.
func (h *LiveHandler) Status(c *gin.Context) {
	avatarID, err := strconv.ParseUint(c.Param("avatarID"), 10, 64)
	if err != nil || avatarID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid avatarID"})
		return
	}

	var session models.LiveSession
	if err := h.db.Where("avatar_id = ?", avatarID).First(&session).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "live session not started"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	key := liveQueueKey(uint(avatarID))
	length, _ := h.q.ListLen(c.Request.Context(), key)
	pending, _ := h.q.ListRange(c.Request.Context(), key, 0, 19)
	if pending == nil {
		pending = []string{}
	}
	history, _ := h.q.ListRange(c.Request.Context(), liveHistoryKey(uint(avatarID)), 0, -1)
	if history == nil {
		history = []string{}
	}
	// Newest first for display.
	for i, j := 0, len(history)-1; i < j; i, j = i+1, j-1 {
		history[i], history[j] = history[j], history[i]
	}

	c.JSON(http.StatusOK, liveStatusResponse{
		AvatarID:    session.AvatarID,
		StreamID:    session.StreamID,
		Status:      session.Status,
		QueueLength: length,
		Pending:     pending,
		History:     history,
	})
}

// ListSessions handles GET /api/live — returns every active live session
// with its avatar info, so the Live Studio can render a switching list.
func (h *LiveHandler) ListSessions(c *gin.Context) {
	var sessions []models.LiveSession
	if err := h.db.Find(&sessions).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	items := make([]liveSessionItem, 0, len(sessions))
	for _, s := range sessions {
		var avatar models.Avatar
		item := liveSessionItem{
			AvatarID: s.AvatarID,
			StreamID: s.StreamID,
			Status:   s.Status,
		}
		if err := h.db.First(&avatar, s.AvatarID).Error; err == nil {
			item.AvatarName = avatar.Name
			item.ImageS3URL = h.s3.PublicURL(avatar.ImageS3Key)
			item.ImageS3Key = avatar.ImageS3Key
			item.VoiceID = avatar.VoiceID
			if avatar.BaseVideoS3Key != nil {
				item.BaseVideoS3Key = *avatar.BaseVideoS3Key
			}
		}
		items = append(items, item)
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
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
