package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"talkingavatar/backend/internal/i18n"
	"talkingavatar/backend/internal/models"
	"talkingavatar/backend/internal/queue"
	"talkingavatar/backend/internal/storage"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"github.com/openai/openai-go/packages/param"
	"github.com/openai/openai-go/responses"
)

// sentenceSplit matches a run of sentence-final punctuation (Chinese and
// English, plus newlines). Sentences are kept intact including the delimiter.
var sentenceSplit = regexp.MustCompile(`[^。！？!?；;\n]+[。！？!?；;\n]*`)

// sentenceBoundaryChars are the delimiters used by the STREAMING splitter
// (Chinese comma included, per the orchestrator spec). Fragments shorter than
// minSentenceRunes are merged into the following sentence so comma splits do
// not produce one-character TTS jobs.
const sentenceBoundaryChars = "。，！？.!?"
const minSentenceRunes = 2

// indexSentenceBoundary returns the byte offset just AFTER the first sentence
// boundary rune in s (delimiter included), or -1 when none is found. It walks
// runes so multi-byte CJK punctuation is never split.
func indexSentenceBoundary(s string) int {
	for i, r := range s {
		if strings.ContainsRune(sentenceBoundaryChars, r) {
			return i + utf8.RuneLen(r)
		}
	}
	return -1
}

// sentenceCollector accumulates streaming LLM deltas and yields complete
// sentences. It is NOT safe for concurrent use — the orchestrator feeds it
// from the single stream loop, which is what keeps the sentence order exact.
type sentenceCollector struct {
	buf     strings.Builder // current unfinished sentence
	pending strings.Builder // fragments too short to submit on their own
}

// feed appends one delta and returns any complete sentences it produced.
func (sc *sentenceCollector) feed(delta string) []string {
	sc.buf.WriteString(delta)
	var out []string
	for {
		cur := sc.buf.String()
		idx := indexSentenceBoundary(cur)
		if idx < 0 {
			break
		}
		part := cur[:idx] // sentence + its delimiter
		rest := cur[idx:]
		sc.buf.Reset()
		sc.buf.WriteString(rest)

		if utf8.RuneCountInString(strings.TrimSpace(part)) >= minSentenceRunes {
			if sc.pending.Len() > 0 {
				part = sc.pending.String() + part
				sc.pending.Reset()
			}
			if s := strings.TrimSpace(part); s != "" {
				out = append(out, s)
			}
		} else {
			sc.pending.WriteString(part)
		}
	}
	return out
}

// flush returns any buffered remainder as one final sentence (stream end).
func (sc *sentenceCollector) flush() []string {
	tail := sc.pending.String() + sc.buf.String()
	sc.pending.Reset()
	sc.buf.Reset()
	if s := strings.TrimSpace(tail); utf8.RuneCountInString(s) >= minSentenceRunes {
		return []string{s}
	}
	return nil
}

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
	ttsServiceURL       string
	taskQueueKey        string
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

// liveChatRequest is the input of POST /api/live/chat. sessionId identifies
// the avatar's live session — in this platform a session maps 1:1 to an
// avatar (live_sessions.avatar_id), so chat_messages are keyed by avatar_id.
type liveChatRequest struct {
	SessionID uint   `json:"sessionId"`
	Text      string `json:"text"`
	UserID    uint   `json:"userId"`
	Username  string `json:"username"`
}

// liveChatResponse reports the orchestration result. Only counters and the
// full reply text are returned — media never crosses this HTTP response.
type liveChatResponse struct {
	Status    string `json:"status"`
	Sentences int    `json:"sentences"`
	Queued    int    `json:"queued"`
	Reply     string `json:"reply,omitempty"`
}

// renderTaskPayload is pushed to the Redis task queue (talking_avatar:tasks)
// for EACH sentence. Services communicate exclusively via S3 object keys —
// no raw audio/video bytes ever travel in the payload.
type renderTaskPayload struct {
	Type           string `json:"type"` // "render"
	Text           string `json:"text"`
	TTSS3Key       string `json:"tts_s3_key"`
	BaseVideoS3Key string `json:"base_video_s3_key"`
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

func NewLiveHandler(db *gorm.DB, q *queue.Queue, s3 *storage.Client, liveControlQueueKey, taskQueueKey, openAIAPIKey, openAIBaseURL, openAIModel, embedServerURL, ttsServiceURL string) *LiveHandler {
	return &LiveHandler{
		db: db, q: q, s3: s3, liveControlQueueKey: liveControlQueueKey,
		openAIAPIKey: openAIAPIKey, openAIBaseURL: openAIBaseURL, openAIModel: openAIModel,
		embedServerURL: embedServerURL, ttsServiceURL: ttsServiceURL,
		taskQueueKey: taskQueueKey,
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
// entry. It persists the viewer message and returns 202 immediately; the LLM
// round trip (memory + RAG + DeepSeek) and the queueing of the bot's reply
// run in a background goroutine so the sender never blocks on model latency.
// Without an API key the incoming text is spoken verbatim (test mode).
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
	userMsg := models.ChatMessage{
		AvatarID: avatar.ID,
		UserID:   req.UserID,
		Username: sender,
		Role:     "user",
		Content:  strings.TrimSpace(req.Text),
	}
	if err := h.db.Create(&userMsg).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Background LLM + queueing: detached from the request (the client gets
	// 202 immediately); bounded by a hard timeout so a slow/hung model can
	// never stall the worker queue or leak goroutines indefinitely.
	lang := i18n.Lang(c)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	go func() {
		defer cancel()
		h.processChatReply(ctx, lang, req.Text, avatar, req.UserID)
	}()

	c.JSON(http.StatusAccepted, gin.H{"accepted": true, "messageId": userMsg.ID})
}

// processChatReply runs off-request: generate the bot reply (long-term memory
// + RAG + LLM), persist it, then sentence-chunk it into the live queue. Any
// failure is logged and degrades gracefully (the viewer still sees their own
// message via history polling; the bot simply stays silent on this one).
func (h *LiveHandler) processChatReply(ctx context.Context, lang, userText string, avatar models.Avatar, userID uint) {
	reply, ragFacts := h.llmChat(ctx, lang, userText, avatar)
	chunks := splitSentences(reply)
	if len(chunks) == 0 {
		log.Printf("[live] avatar %d empty LLM reply, skipping bot message", avatar.ID)
		return
	}

	ragJSON := ""
	if len(ragFacts) > 0 {
		if b, err := json.Marshal(ragFacts); err == nil {
			ragJSON = string(b)
		}
	}
	if err := h.db.Create(&models.ChatMessage{
		AvatarID:   avatar.ID,
		UserID:     userID,
		Username:   avatar.Name,
		Role:       "bot",
		Content:    reply,
		RAGHit:     len(ragFacts) > 0,
		RAGSources: ragJSON,
	}).Error; err != nil {
		log.Printf("[live] avatar %d failed to persist bot reply: %v", avatar.ID, err)
		return
	}

	key := liveQueueKey(avatar.ID)
	historyKey := liveHistoryKey(avatar.ID)
	for _, text := range chunks {
		_ = h.q.RPushList(ctx, key, text)
		_ = h.q.RPushList(ctx, historyKey, text)
	}
	_ = h.q.TrimList(ctx, historyKey, -200, -1)
	log.Printf("[live] avatar %d bot reply queued (%d chunks)", avatar.ID, len(chunks))
}

// Chat implements POST /api/live/chat — the live-chat orchestrator. It runs
// the pipeline in a strict order:
//
//  1. Long-term memory: fetch the last 10 chat_messages of this session
//     (avatar_id) and format them as LLM messages [{"role","content"}].
//  2. RAG knowledge: POST to the knowledge service
//     (http://rag-service:8001/v1/knowledge/search) with a 500ms timeout;
//     on timeout/failure log a warning and continue WITHOUT knowledge.
//  3. Streaming LLM (DeepSeek Responses, stream=true): tokens are appended
//     to a sentence buffer and split on Chinese/English punctuation
//     [。，！？.!?]; each complete sentence is handed to step 4 immediately.
//  4. Ordered TTS + queueing: sentences are synthesized and pushed to the
//     Redis queue (talking_avatar:tasks) ONE BY ONE in the exact order the
//     LLM produced them — the serial loop guarantees no race can reorder
//     them. Each TTS call (http://tts-service:8002/v1/tts/synthesize) is
//     bounded by a 3s timeout and returns an S3 key; the render payload
//     carries only S3 keys.
//
// Client disconnects: the request context is honored everywhere (LLM stream,
// TTS calls, Redis pushes); the loop bails out as soon as ctx is canceled,
// so no goroutine is spawned and nothing leaks.
func (h *LiveHandler) Chat(c *gin.Context) {
	var req liveChatRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.SessionID == 0 || strings.TrimSpace(req.Text) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.live.text_required")})
		return
	}

	var avatar models.Avatar
	if err := h.db.First(&avatar, req.SessionID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": i18n.Tc(c, "err.live.avatar_not_found")})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	if strings.TrimSpace(strPtrOrEmpty(avatar.BaseVideoS3Key)) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.live.base_video_missing")})
		return
	}

	ctx := c.Request.Context()
	userText := strings.TrimSpace(req.Text)

	// Persist the viewer message so long-term memory stays populated.
	sender := strings.TrimSpace(req.Username)
	if sender == "" {
		sender = "游客"
	}
	_ = h.db.Create(&models.ChatMessage{
		AvatarID: avatar.ID,
		UserID:   req.UserID,
		Username: sender,
		Role:     "user",
		Content:  userText,
	})

	// ---- 1. Long-term memory (GORM -> standard LLM messages) ----
	msgs := h.recentMessages(avatar.ID, 10)
	input := make(responses.ResponseInputParam, 0, len(msgs)+1)
	for _, m := range msgs {
		role := responses.EasyInputMessageRoleUser
		if m.Role == "bot" {
			role = responses.EasyInputMessageRoleAssistant
		}
		input = append(input, responses.ResponseInputItemUnionParam{
			OfMessage: &responses.EasyInputMessageParam{
				Role: role,
				Content: responses.EasyInputMessageContentUnionParam{
					OfString: param.NewOpt(m.Content),
				},
			},
		})
	}
	input = append(input, responses.ResponseInputItemUnionParam{
		OfMessage: &responses.EasyInputMessageParam{
			Role: responses.EasyInputMessageRoleUser,
			Content: responses.EasyInputMessageContentUnionParam{
				OfString: param.NewOpt(userText),
			},
		},
	})

	// ---- 2. RAG knowledge (500ms timeout, graceful fallback) ----
	ragFacts := h.retrieveKnowledge(ctx, avatar.ID, userText, 500*time.Millisecond)
	systemPrompt := chatSystemPrompt(avatar, i18n.Lang(c), nil, ragFacts)

	// ---- 3. Streaming LLM + sentence chunking ----
	client := openai.NewClient(
		option.WithBaseURL(strings.TrimRight(h.openAIBaseURL, "/")),
		option.WithAPIKey(h.openAIAPIKey),
	)
	stream := client.Responses.NewStreaming(ctx, responses.ResponseNewParams{
		Model:           h.openAIModel,
		Instructions:    openai.String(systemPrompt),
		Input:           responses.ResponseNewParamsInputUnion{OfInputItemList: input},
		Temperature:     openai.Float(0.8),
		MaxOutputTokens: openai.Int(300),
	})
	defer stream.Close()

	collector := &sentenceCollector{}
	sentences := make([]string, 0, 8)
	var reply strings.Builder
	for stream.Next() {
		event := stream.Current()
		delta := event.AsResponseOutputTextDelta()
		if delta.Type != "response.output_text.delta" {
			continue
		}
		reply.WriteString(delta.Delta)
		sentences = append(sentences, collector.feed(delta.Delta)...)

		// Bail out promptly if the Gin client disconnected mid-stream.
		if ctx.Err() != nil {
			log.Printf("[chat] client disconnected during streaming; stopping")
			return
		}
	}
	if err := stream.Err(); err != nil {
		log.Printf("[chat] LLM stream error (partial reply kept): %v", err)
	}
	sentences = append(sentences, collector.flush()...)

	// ---- 4. Ordered TTS synthesis + queueing (serial => strict order) ----
	queued := 0
	for _, sentence := range sentences {
		if ctx.Err() != nil {
			log.Printf("[chat] client disconnected; %d/%d sentences queued", queued, len(sentences))
			return
		}
		if err := h.synthesizeAndEnqueue(ctx, avatar, sentence); err != nil {
			// One bad sentence must not crash the whole turn.
			log.Printf("[chat] sentence skipped (%v): %q", err, sentence)
			continue
		}
		queued++
	}

	finalReply := strings.TrimSpace(reply.String())
	ragJSON := ""
	if len(ragFacts) > 0 {
		if b, err := json.Marshal(ragFacts); err == nil {
			ragJSON = string(b)
		}
	}
	_ = h.db.Create(&models.ChatMessage{
		AvatarID:   avatar.ID,
		UserID:     req.UserID,
		Username:   avatar.Name,
		Role:       "bot",
		Content:    finalReply,
		RAGHit:     len(ragFacts) > 0,
		RAGSources: ragJSON,
	})

	c.JSON(http.StatusOK, liveChatResponse{
		Status:    "success",
		Sentences: len(sentences),
		Queued:    queued,
		Reply:     finalReply,
	})
}

// synthesizeAndEnqueue runs ONE sentence through tts-service (3s timeout),
// reads the returned S3 key and pushes a render task to the Redis queue.
// The call is serial, which is what preserves the LLM's sentence order.
func (h *LiveHandler) synthesizeAndEnqueue(ctx context.Context, avatar models.Avatar, sentence string) error {
	if strings.TrimSpace(h.ttsServiceURL) == "" {
		return fmt.Errorf("tts-service URL not configured")
	}
	body, err := json.Marshal(map[string]any{
		"text":    sentence,
		"voiceId": avatar.VoiceID,
	})
	if err != nil {
		return err
	}
	reqCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(
		reqCtx,
		http.MethodPost,
		strings.TrimRight(h.ttsServiceURL, "/")+"/v1/tts/synthesize",
		bytes.NewReader(body),
	)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("tts-service request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("tts-service returned %d", resp.StatusCode)
	}
	var out struct {
		S3Key string `json:"s3_key"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return fmt.Errorf("bad tts-service response: %w", err)
	}
	if strings.TrimSpace(out.S3Key) == "" {
		return fmt.Errorf("tts-service returned an empty s3_key")
	}

	payload := renderTaskPayload{
		Type:           "render",
		Text:           sentence,
		TTSS3Key:       out.S3Key,
		BaseVideoS3Key: strPtrOrEmpty(avatar.BaseVideoS3Key),
	}
	return h.q.PushTo(ctx, h.taskQueueKey, payload)
}

// strPtrOrEmpty dereferences a *string (GORM pointer columns) safely.
func strPtrOrEmpty(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// llmChat sends the user text to the LLM through the OpenAI SDK pointed at the
// configured base URL (DeepSeek by default, Responses API) and returns the
// assistant's reply. `ctx`/`lang` are passed in so callers can run it
// synchronously (orchestrator) or in a background goroutine (chat message).
// Without an API key the input is spoken verbatim (test).
func (h *LiveHandler) llmChat(ctx context.Context, lang, userText string, avatar models.Avatar) (string, []string) {
	if strings.TrimSpace(h.openAIAPIKey) == "" {
		log.Printf("[llm] OPENAI_API_KEY not set, speaking the input verbatim")
		return userText, nil
	}

	client := openai.NewClient(
		option.WithBaseURL(strings.TrimRight(h.openAIBaseURL, "/")),
		option.WithAPIKey(h.openAIAPIKey),
	)
	memory := h.recentMessages(avatar.ID, 10)
	ragFacts := h.retrieveKnowledge(ctx, avatar.ID, userText, 500*time.Millisecond)
	if len(ragFacts) > 0 {
		log.Printf("[rag] avatar %d retrieved %d fact(s)", avatar.ID, len(ragFacts))
	}
	resp, err := client.Responses.New(ctx, responses.ResponseNewParams{
		Model:           h.openAIModel,
		Instructions:    openai.String(chatSystemPrompt(avatar, lang, memory, ragFacts)),
		Input:           responses.ResponseNewParamsInputUnion{OfString: openai.String(userText)},
		Temperature:     openai.Float(0.8),
		MaxOutputTokens: openai.Int(300),
	})
	if err != nil {
		log.Printf("[llm] request failed: %v", err)
		return userText, ragFacts
	}
	reply := strings.TrimSpace(resp.OutputText())
	if reply == "" {
		return userText, ragFacts
	}
	log.Printf("[llm] %s -> %s", userText, reply)
	return reply, ragFacts
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

// retrieveKnowledge sends the user message to the knowledge service
// (rag-service, zvec Jieba FTS + per-avatar scalar filter) and returns the
// Top-K chunks for THIS avatar only. The request is bounded by `timeout`
// (the orchestrator uses 500ms); any failure or timeout degrades gracefully —
// the chat continues WITHOUT knowledge and never crashes the request.
func (h *LiveHandler) retrieveKnowledge(ctx context.Context, avatarID uint, text string, timeout time.Duration) []string {
	if strings.TrimSpace(h.embedServerURL) == "" {
		return nil
	}
	body, err := json.Marshal(map[string]any{
		"avatar_id": avatarID,
		"query":     text,
	})
	if err != nil {
		return nil
	}
	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(
		reqCtx,
		http.MethodPost,
		strings.TrimRight(h.embedServerURL, "/")+"/v1/knowledge/search",
		bytes.NewReader(body),
	)
	if err != nil {
		return nil
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("[rag] knowledge service unreachable (%v); continuing without knowledge", err)
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		log.Printf("[rag] embed server returned %d; continuing without knowledge", resp.StatusCode)
		return nil
	}
	var out struct {
		Contexts []string `json:"contexts"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		log.Printf("[rag] bad embed response: %v", err)
		return nil
	}
	return out.Contexts
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
		persona += "用简短、口语化、中文回复观众消息，单次回复不超过3句话（讲解知识库内容时可适当展开）。" +
			"观众问起你的年龄、身高、体重、族裔、感情状态或性格时，严格按照设定回答。"
	} else {
		persona += "Reply to viewers in short, conversational English, at most 3 sentences per reply (feel free to elaborate when explaining knowledge-base facts). " +
			"When asked about your age, height, weight, ethnicity, relationship status or personality, " +
			"answer strictly according to the profile above."
	}

	// Private knowledge base (strictly per-avatar): answer ONLY from these
	// facts; admit ignorance instead of making things up. A viewer may send
	// just a keyword — treat it as "tell me about this topic" and proactively
	// explain the matching facts instead of echoing the keyword.
	if len(ragFacts) > 0 {
		if zh {
			persona += "\n以下是该数字人的私有知识库资料（必须严格依据这些资料回答，可直接引用原文）："
			for i, f := range ragFacts {
				persona += fmt.Sprintf("\n%d. %s", i+1, f)
			}
			persona += "\n观众的消息可能只是关键词而不是完整问句：只要关键词对应上述资料中的内容，" +
				"就把它当作“想了解该主题”，主动结合资料向观众讲解，不要简单重复关键词；" +
				"只有当观众的问题确实在上述资料中找不到答案时，才如实说“这个我不太清楚”。"
		} else {
			persona += "\nThe private knowledge base for this avatar (answer strictly based on these facts; quote them directly):"
			for i, f := range ragFacts {
				persona += fmt.Sprintf("\n%d. %s", i+1, f)
			}
			persona += "\nThe viewer may send just a keyword instead of a full question: if the keyword matches the facts above, treat it as \"tell me about this topic\" and proactively explain the relevant facts — do not simply echo the keyword. Only if the question truly has no answer in the facts, say you don't know."
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
