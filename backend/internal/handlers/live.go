package handlers

import (
	"bytes"
	"encoding/json"
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

	"talkingavatar/backend/internal/i18n"
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
	embedServerURL      string
}

type startLiveRequest struct {
	StreamID string `json:"streamId"` // optional; defaults to avatar_<id>
}

type pushLiveRequest struct {
	Text string `json:"text"`
}

type liveMessageRequest struct {
	Text     string `json:"text"`
	UserID   uint   `json:"userId"`
	Username string `json:"username"`
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
	AvatarID           uint                `json:"avatarId"`
	AvatarName         string              `json:"avatarName"`
	Category           string              `json:"category"`
	Age                *int                `json:"age,omitempty"`
	HeightCm           *int                `json:"heightCm,omitempty"`
	WeightKg           *int                `json:"weightKg,omitempty"`
	Ethnicity          string              `json:"ethnicity,omitempty"`
	RelationshipStatus string              `json:"relationshipStatus,omitempty"`
	Personality        string              `json:"personality,omitempty"`
	ImageS3URL         string              `json:"imageS3Url"`
	ImageS3Key         string              `json:"imageS3Key"`
	BaseVideoS3Key     string              `json:"baseVideoS3Key"`
	VoiceID            string              `json:"voiceId"`
	StreamID           string              `json:"streamId"`
	Status             string              `json:"status"`
	LiveSettings       models.LiveSettings `json:"liveSettings"`
}

func NewLiveHandler(db *gorm.DB, q *queue.Queue, s3 *storage.Client, liveControlQueueKey, openAIAPIKey, openAIBaseURL, openAIModel, embedServerURL string) *LiveHandler {
	return &LiveHandler{
		db: db, q: q, s3: s3, liveControlQueueKey: liveControlQueueKey,
		openAIAPIKey: openAIAPIKey, openAIBaseURL: openAIBaseURL, openAIModel: openAIModel,
		embedServerURL: embedServerURL,
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
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.live.invalid_avatar_id")})
		return
	}

	var req startLiveRequest
	if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tcf(c, "err.invalid_request_body", err.Error())})
		return
	}

	var avatar models.Avatar
	if err := h.db.First(&avatar, avatarID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": i18n.Tc(c, "err.live.avatar_not_found")})
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
	liveSettings := strings.TrimSpace(avatar.LiveSettings)
	if liveSettings == "" {
		liveSettings = "{}"
	}
	payload.LiveSettings = json.RawMessage(liveSettings)
	if err := h.q.PushTo(c.Request.Context(), h.liveControlQueueKey, payload); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": i18n.Tcf(c, "err.live.notify_worker_failed", err.Error())})
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
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.live.invalid_avatar_id")})
		return
	}

	var session models.LiveSession
	if err := h.db.Where("avatar_id = ?", avatarID).First(&session).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": i18n.Tc(c, "err.live.session_not_started")})
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
		c.JSON(http.StatusInternalServerError, gin.H{"error": i18n.Tcf(c, "err.live.notify_worker_failed", err.Error())})
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
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.live.invalid_avatar_id")})
		return
	}

	var req pushLiveRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tcf(c, "err.invalid_request_body", err.Error())})
		return
	}
	if strings.TrimSpace(req.Text) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.live.text_required")})
		return
	}

	var avatar models.Avatar
	if err := h.db.First(&avatar, avatarID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": i18n.Tc(c, "err.live.avatar_not_found")})
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
			c.JSON(http.StatusInternalServerError, gin.H{"error": i18n.Tcf(c, "err.live.push_chunk_failed", err.Error())})
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
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.live.invalid_avatar_id")})
		return
	}
	var req liveMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Text) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.live.text_required")})
		return
	}

	var avatar models.Avatar
	if err := h.db.First(&avatar, avatarID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": i18n.Tc(c, "err.live.avatar_not_found")})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	// Persist the viewer message (identity comes from the audience client;
	// 直播台 test messages fall back to a guest-ish snapshot).
	sender := strings.TrimSpace(req.Username)
	if sender == "" {
		sender = "游客"
	}
	_ = h.db.Create(&models.ChatMessage{
		AvatarID: avatar.ID,
		UserID:   req.UserID,
		Username: sender,
		Role:     "user",
		Content:  strings.TrimSpace(req.Text),
	})

	reply := h.llmChat(c, req.Text, avatar)
	chunks := splitSentences(reply)
	if len(chunks) == 0 {
		c.JSON(http.StatusBadGateway, gin.H{"error": i18n.Tc(c, "err.live.llm_empty_reply")})
		return
	}

	// Persist the bot's full reply as one message (monitor shows the whole
	// reply; the worker speaks it sentence by sentence).
	_ = h.db.Create(&models.ChatMessage{
		AvatarID: avatar.ID,
		Username: avatar.Name,
		Role:     "bot",
		Content:  reply,
	})

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
func (h *LiveHandler) llmChat(c *gin.Context, userText string, avatar models.Avatar) string {
	if strings.TrimSpace(h.openAIAPIKey) == "" {
		log.Printf("[llm] OPENAI_API_KEY not set, speaking the input verbatim")
		return userText
	}

	client := openai.NewClient(
		option.WithBaseURL(strings.TrimRight(h.openAIBaseURL, "/")),
		option.WithAPIKey(h.openAIAPIKey),
	)
	lang := i18n.Lang(c)
	memory := h.recentMessages(avatar.ID, 10)
	ragFacts := h.retrieveKnowledge(avatar.ID, userText)
	if len(ragFacts) > 0 {
		log.Printf("[rag] avatar %d retrieved %d fact(s)", avatar.ID, len(ragFacts))
	}
	resp, err := client.Responses.New(c.Request.Context(), responses.ResponseNewParams{
		Model:           h.openAIModel,
		Instructions:    openai.String(chatSystemPrompt(avatar, lang, memory, ragFacts)),
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

// recentMessages returns the last `limit` persisted room messages (viewer
// messages + bot replies) for one avatar, oldest first — the avatar's
// long-term memory across viewers in this live session.
func (h *LiveHandler) recentMessages(avatarID uint, limit int) []models.ChatMessage {
	var msgs []models.ChatMessage
	if err := h.db.Where("avatar_id = ?", avatarID).
		Order("id desc").Limit(limit).Find(&msgs).Error; err != nil {
		log.Printf("[memory] failed to load history: %v", err)
		return nil
	}
	for i, j := 0, len(msgs)-1; i < j; i, j = i+1, j-1 {
		msgs[i], msgs[j] = msgs[j], msgs[i]
	}
	return msgs
}

// retrieveKnowledge embeds the user message via the local RAG worker's HTTP
// endpoint and returns the Top-K chunks for THIS avatar only (the query is
// filtered by avatar_id in Redis). Any failure degrades gracefully: the chat
// simply continues without knowledge context.
func (h *LiveHandler) retrieveKnowledge(avatarID uint, text string) []string {
	if strings.TrimSpace(h.embedServerURL) == "" {
		return nil
	}
	body, err := json.Marshal(map[string]any{
		"avatarId": avatarID,
		"text":     text,
		"topK":     3,
	})
	if err != nil {
		return nil
	}
	resp, err := http.Post(
		strings.TrimRight(h.embedServerURL, "/")+"/search",
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		log.Printf("[rag] embed server unreachable (%v); continuing without knowledge", err)
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		log.Printf("[rag] embed server returned %d; continuing without knowledge", resp.StatusCode)
		return nil
	}
	var out struct {
		Chunks []struct {
			Content string `json:"content"`
		} `json:"chunks"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		log.Printf("[rag] bad embed response: %v", err)
		return nil
	}
	facts := make([]string, 0, len(out.Chunks))
	for _, c := range out.Chunks {
		if s := strings.TrimSpace(c.Content); s != "" {
			facts = append(facts, s)
		}
	}
	return facts
}

// chatSystemPrompt builds the LLM persona prompt for one avatar. The
// avatar's creation-time profile (age/height/weight/ethnicity/relationship/
// personality) is baked in so viewers can ask about it naturally. Optional
// RAG facts (private knowledge base, isolated per avatar) and the last N room
// messages (long-term memory) are injected so the bot answers from them.
func chatSystemPrompt(a models.Avatar, lang string, memory []models.ChatMessage, ragFacts []string) string {
	zh := lang == "" || lang == "zh"
	profile := []string{}
	if a.Age != nil {
		if zh {
			profile = append(profile, fmt.Sprintf("年龄 %d 岁", *a.Age))
		} else {
			profile = append(profile, fmt.Sprintf("Age %d", *a.Age))
		}
	}
	if a.HeightCm != nil {
		if zh {
			profile = append(profile, fmt.Sprintf("身高 %d 厘米", *a.HeightCm))
		} else {
			profile = append(profile, fmt.Sprintf("Height %d cm", *a.HeightCm))
		}
	}
	if a.WeightKg != nil {
		if zh {
			profile = append(profile, fmt.Sprintf("体重 %d 公斤", *a.WeightKg))
		} else {
			profile = append(profile, fmt.Sprintf("Weight %d kg", *a.WeightKg))
		}
	}
	if s := strings.TrimSpace(a.Ethnicity); s != "" {
		if zh {
			profile = append(profile, "族裔 "+s)
		} else {
			profile = append(profile, "Ethnicity "+s)
		}
	}
	if s := strings.TrimSpace(a.RelationshipStatus); s != "" {
		if zh {
			profile = append(profile, "感情状态 "+s)
		} else {
			profile = append(profile, "Relationship "+s)
		}
	}
	if s := strings.TrimSpace(a.Personality); s != "" {
		if zh {
			profile = append(profile, "性格 "+s)
		} else {
			profile = append(profile, "Personality "+s)
		}
	}

	var persona string
	if zh {
		persona = "你是一个直播间里的数字人主播「" + a.Name + "」。"
	} else {
		persona = "You are a digital human streamer named \"" + a.Name + "\". "
	}
	if len(profile) > 0 {
		if zh {
			persona += "你的人物设定：" + strings.Join(profile, "，") + "。"
		} else {
			persona += "Your profile: " + strings.Join(profile, ", ") + ". "
		}
	}
	if zh {
		persona += "用简短、口语化、中文回复观众消息，单次回复不超过3句话。" +
			"观众问起你的年龄、身高、体重、族裔、感情状态或性格时，严格按照设定回答。"
	} else {
		persona += "Reply to viewers in short, conversational English, at most 3 sentences per reply. " +
			"When asked about your age, height, weight, ethnicity, relationship status or personality, " +
			"answer strictly according to the profile above."
	}

	// Private knowledge base (strictly per-avatar): answer ONLY from these
	// facts; admit ignorance instead of making things up.
	if len(ragFacts) > 0 {
		if zh {
			persona += "\n以下是该数字人的私有知识库内容（必须严格依据这些事实回答）："
			for i, f := range ragFacts {
				persona += fmt.Sprintf("\n%d. %s", i+1, f)
			}
			persona += "\n如果问题在上述事实中没有提到，必须如实说“这个我不太清楚”。"
		} else {
			persona += "\nThe private knowledge base for this avatar (answer strictly based on these facts):"
			for i, f := range ragFacts {
				persona += fmt.Sprintf("\n%d. %s", i+1, f)
			}
			persona += "\nIf the question is not mentioned in the facts above, say you don't know."
		}
	}

	// Long-term memory: the last few room messages, so the bot follows up
	// naturally instead of starting every reply from scratch.
	if len(memory) > 0 {
		if zh {
			persona += "\n最近的对话记录："
		} else {
			persona += "\nRecent conversation:"
		}
		for _, m := range memory {
			role := "user"
			if m.Role == "bot" {
				role = "assistant"
			}
			persona += fmt.Sprintf("\n%s: %s", role, m.Content)
		}
	}
	return persona
}

// Status handles GET /api/live/:avatarID/status. It returns the live session
// state plus the pending text chunks (and queue length) so the frontend can
// monitor what is waiting to be rendered.
func (h *LiveHandler) Status(c *gin.Context) {
	avatarID, err := strconv.ParseUint(c.Param("avatarID"), 10, 64)
	if err != nil || avatarID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.live.invalid_avatar_id")})
		return
	}

	var session models.LiveSession
	if err := h.db.Where("avatar_id = ?", avatarID).First(&session).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": i18n.Tc(c, "err.live.session_not_started")})
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
			item.Category = normalizeCategory(avatar.Category)
			item.Age = avatar.Age
			item.HeightCm = avatar.HeightCm
			item.WeightKg = avatar.WeightKg
			item.Ethnicity = avatar.Ethnicity
			item.RelationshipStatus = avatar.RelationshipStatus
			item.Personality = avatar.Personality
			item.ImageS3URL = h.s3.PublicURL(avatar.ImageS3Key)
			item.ImageS3Key = avatar.ImageS3Key
			item.VoiceID = avatar.VoiceID
			if avatar.BaseVideoS3Key != nil {
				item.BaseVideoS3Key = *avatar.BaseVideoS3Key
			}
			item.LiveSettings = parseLiveSettings(avatar.LiveSettings)
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
