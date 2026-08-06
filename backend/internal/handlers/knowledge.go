package handlers

import (
	"bytes"
	"encoding/json"
	"mime"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"talkingavatar/backend/internal/i18n"
	"talkingavatar/backend/internal/models"
	"talkingavatar/backend/internal/queue"
	"talkingavatar/backend/internal/storage"
)

// KnowledgeHandler serves the per-avatar private knowledge base: source
// documents (raw text or .txt/.pdf) are stored in MariaDB and the source file
// in S3, then an ingest task is pushed to Redis for the Python RAG worker
// (chunking + local embedding). Knowledge is strictly isolated by avatar_id.
type KnowledgeHandler struct {
	db         *gorm.DB
	s3         *storage.Client
	q          *queue.Queue
	ingestKey  string
	embedURL   string
}

func NewKnowledgeHandler(db *gorm.DB, s3 *storage.Client, q *queue.Queue, ingestKey, embedURL string) *KnowledgeHandler {
	return &KnowledgeHandler{db: db, s3: s3, q: q, ingestKey: ingestKey, embedURL: embedURL}
}

type knowledgeResponse struct {
	ID        uint      `json:"id"`
	AvatarID  uint      `json:"avatarId"`
	AvatarName string   `json:"avatarName,omitempty"`
	Content   string    `json:"content"`
	Status    string    `json:"status"`
	Filename  string    `json:"filename,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

func toKnowledgeResponse(k models.AvatarKnowledge) knowledgeResponse {
	return knowledgeResponse{
		ID:        k.ID,
		AvatarID:  k.AvatarID,
		Content:   k.Content,
		Status:    k.Status,
		Filename:  k.Filename,
		CreatedAt: k.CreatedAt,
	}
}

// ListAll handles GET /api/knowledge — every avatar's knowledge with optional
// filters: ?avatarId=<id> and/or ?q=<keyword> (matches filename or content).
func (h *KnowledgeHandler) ListAll(c *gin.Context) {
	type row struct {
		models.AvatarKnowledge
		AvatarName string `json:"avatarName"`
	}
	q := h.db.Model(&models.AvatarKnowledge{}).
		Select("avatar_knowledges.*, avatars.name AS avatar_name").
		Joins("LEFT JOIN avatars ON avatars.id = avatar_knowledges.avatar_id")
	if avatarID := c.Query("avatarId"); avatarID != "" {
		if id, err := strconv.ParseUint(avatarID, 10, 64); err == nil && id > 0 {
			q = q.Where("avatar_knowledges.avatar_id = ?", id)
		}
	}
	if kw := strings.TrimSpace(c.Query("q")); kw != "" {
		like := "%" + kw + "%"
		q = q.Where(
			"(avatar_knowledges.content LIKE ? OR avatar_knowledges.filename LIKE ?)",
			like, like,
		)
	}
	var rows []row
	if err := q.Order("avatar_knowledges.created_at desc").Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	items := make([]knowledgeResponse, 0, len(rows))
	for _, r := range rows {
		resp := toKnowledgeResponse(r.AvatarKnowledge)
		resp.AvatarName = r.AvatarName
		items = append(items, resp)
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// SearchTest handles POST /api/knowledge/search — a live retrieval test that
// proxies to the local RAG worker's /search (embed + per-avatar KNN).
func (h *KnowledgeHandler) SearchTest(c *gin.Context) {
	var req struct {
		AvatarID uint   `json:"avatarId"`
		Text     string `json:"text"`
		TopK     int    `json:"topK"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tcf(c, "err.invalid_request_body", err.Error())})
		return
	}
	if req.AvatarID == 0 || strings.TrimSpace(req.Text) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.knowledge.search_required")})
		return
	}
	if strings.TrimSpace(h.embedURL) == "" {
		c.JSON(http.StatusBadGateway, gin.H{"error": i18n.Tc(c, "err.knowledge.embed_unavailable")})
		return
	}
	body, err := json.Marshal(map[string]any{
		"avatarId": req.AvatarID,
		"text":     req.Text,
		"topK":     max(1, req.TopK),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	resp, err := http.Post(
		strings.TrimRight(h.embedURL, "/")+"/search",
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": i18n.Tc(c, "err.knowledge.embed_unavailable")})
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		c.JSON(http.StatusBadGateway, gin.H{"error": i18n.Tc(c, "err.knowledge.search_failed")})
		return
	}
	var out struct {
		Chunks []struct {
			Content string `json:"content"`
			Score   string `json:"score"`
		} `json:"chunks"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": i18n.Tc(c, "err.knowledge.search_failed")})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out.Chunks})
}

// Create handles POST /api/avatars/:id/knowledge — multipart/form-data with
// either a `text` field (raw knowledge text) or a `file` field (.txt/.pdf).
// Both paths persist a row, upload the source to S3 (text is written to a
// generated .txt) and push an ingest_knowledge task for the RAG worker.
func (h *KnowledgeHandler) Create(c *gin.Context) {
	avatarID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || avatarID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.avatar.invalid_id")})
		return
	}
	var avatar models.Avatar
	if err := h.db.First(&avatar, avatarID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": i18n.Tc(c, "err.avatar.not_found")})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	text := strings.TrimSpace(c.PostForm("text"))
	fileHeader, fileErr := c.FormFile("file")
	if text == "" && fileErr != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.knowledge.source_required")})
		return
	}
	if text != "" && fileErr == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.knowledge.both_provided")})
		return
	}

	var s3Key, filename string
	if fileErr == nil {
		ext := strings.ToLower(filepath.Ext(fileHeader.Filename))
		if ext != ".txt" && ext != ".pdf" {
			c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.knowledge.unsupported_type")})
			return
		}
		filename = fileHeader.Filename
		s3Key, err = h.uploadKnowledgeFile(c, fileHeader)
	} else {
		// Raw text is uploaded as a generated .txt so the worker follows one
		// uniform "download from S3 -> extract -> chunk -> embed" path.
		filename = "text-" + strconv.FormatUint(avatarID, 10) + "-" +
			strconv.FormatInt(time.Now().UnixMilli(), 10) + ".txt"
		s3Key, err = h.uploadKnowledgeText(c, filename, text)
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": i18n.Tcf(c, "err.knowledge.upload_failed", err.Error()),
		})
		return
	}

	row := models.AvatarKnowledge{
		AvatarID:  uint(avatarID),
		Content:   text, // filled immediately for text; worker webhook fills for files
		Status:    models.KnowledgeStatusPending,
		SourceKey: s3Key,
		Filename:  filename,
	}
	if err := h.db.Create(&row).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": i18n.Tcf(c, "err.knowledge.save_failed", err.Error()),
		})
		return
	}

	if err := h.q.PushTo(c.Request.Context(), h.ingestKey, queue.KnowledgeIngestPayload{
		Type:        "ingest_knowledge",
		AvatarID:    row.AvatarID,
		KnowledgeID: row.ID,
		S3Key:       s3Key,
		Filename:    filename,
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": i18n.Tcf(c, "err.knowledge.enqueue_failed", err.Error()),
		})
		return
	}

	c.JSON(http.StatusCreated, toKnowledgeResponse(row))
}

// List handles GET /api/avatars/:id/knowledge — all source documents for one
// avatar, newest first.
func (h *KnowledgeHandler) List(c *gin.Context) {
	avatarID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || avatarID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.avatar.invalid_id")})
		return
	}
	var rows []models.AvatarKnowledge
	if err := h.db.Where("avatar_id = ?", avatarID).
		Order("created_at desc").Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	items := make([]knowledgeResponse, 0, len(rows))
	for _, r := range rows {
		items = append(items, toKnowledgeResponse(r))
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// Delete handles DELETE /api/avatars/:id/knowledge/:kid — removes the DB row
// and best-effort removes the S3 source. (Redis vectors are cleaned up by the
// worker on the next re-ingest or a dedicated cleanup task.)
func (h *KnowledgeHandler) Delete(c *gin.Context) {
	avatarID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || avatarID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.avatar.invalid_id")})
		return
	}
	kid, err := strconv.ParseUint(c.Param("kid"), 10, 64)
	if err != nil || kid == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.knowledge.invalid_id")})
		return
	}
	var row models.AvatarKnowledge
	if err := h.db.Where("id = ? AND avatar_id = ?", kid, avatarID).First(&row).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": i18n.Tc(c, "err.knowledge.not_found")})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	if row.SourceKey != "" {
		_ = h.s3.Delete(c.Request.Context(), row.SourceKey)
	}
	if err := h.db.Delete(&row).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// UpdateStatus is the Python worker webhook: POST
// /api/avatars/:id/knowledge/:kid/status with {"status":"indexed|failed",
// "content":"<extracted text>"} after chunking + embedding finished.
func (h *KnowledgeHandler) UpdateStatus(c *gin.Context) {
	avatarID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || avatarID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.avatar.invalid_id")})
		return
	}
	kid, err := strconv.ParseUint(c.Param("kid"), 10, 64)
	if err != nil || kid == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.knowledge.invalid_id")})
		return
	}
	var req struct {
		Status  string `json:"status"`
		Content string `json:"content,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tcf(c, "err.invalid_request_body", err.Error())})
		return
	}
	if req.Status != models.KnowledgeStatusIndexed && req.Status != models.KnowledgeStatusFailed {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.knowledge.invalid_status")})
		return
	}
	updates := map[string]any{"status": req.Status}
	if req.Content != "" {
		updates["content"] = req.Content
	}
	if err := h.db.Model(&models.AvatarKnowledge{}).
		Where("id = ? AND avatar_id = ?", kid, avatarID).
		Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ------------------------------------------------------------------ #
// S3 helpers
// ------------------------------------------------------------------ #
func (h *KnowledgeHandler) uploadKnowledgeFile(c *gin.Context, header *multipart.FileHeader) (string, error) {
	file, err := header.Open()
	if err != nil {
		return "", err
	}
	defer file.Close()
	key := newObjectKey("knowledge", header.Filename)
	contentType := header.Header.Get("Content-Type")
	if contentType == "" {
		contentType = mime.TypeByExtension(strings.ToLower(filepath.Ext(header.Filename)))
		if contentType == "" {
			contentType = "application/octet-stream"
		}
	}
	if err := h.s3.Upload(c.Request.Context(), key, file, contentType); err != nil {
		return "", err
	}
	return key, nil
}

func (h *KnowledgeHandler) uploadKnowledgeText(c *gin.Context, filename, text string) (string, error) {
	key := "knowledge/" + filename
	if err := h.s3.Upload(c.Request.Context(), key, strings.NewReader(text), "text/plain; charset=utf-8"); err != nil {
		return "", err
	}
	return key, nil
}
