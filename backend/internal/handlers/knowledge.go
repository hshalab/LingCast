package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"mime"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	pdf "github.com/ledongthuc/pdf"
	"gorm.io/gorm"

	"talkingavatar/backend/internal/i18n"
	"talkingavatar/backend/internal/models"
	"talkingavatar/backend/internal/storage"
)

// KnowledgeHandler serves the two-level knowledge base:
//   avatar -> KnowledgeCollection (知识库) -> KnowledgeDocument (文档)
// Source documents (.txt/.pdf/raw text) are stored in MariaDB + S3, then the
// extracted text is ingested synchronously into the service-rag (zvec FTS +
// Jieba, see services/rag/main.py). Chunks are strictly scoped by
// collection_id / source_id in the vector store.
type KnowledgeHandler struct {
	db     *gorm.DB
	s3     *storage.Client
	ragURL string
}

func NewKnowledgeHandler(db *gorm.DB, s3 *storage.Client, ragURL string) *KnowledgeHandler {
	return &KnowledgeHandler{db: db, s3: s3, ragURL: ragURL}
}

type collectionResponse struct {
	ID            uint      `json:"id"`
	Name          string    `json:"name"`
	DocumentCount int64     `json:"documentCount"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

type documentResponse struct {
	ID           uint      `json:"id"`
	CollectionID uint      `json:"collectionId"`
	Content      string    `json:"content"`
	Status       string    `json:"status"`
	Filename     string    `json:"filename,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
}

func toDocumentResponse(d models.KnowledgeDocument) documentResponse {
	return documentResponse{
		ID:           d.ID,
		CollectionID: d.CollectionID,
		Content:      d.Content,
		Status:       d.Status,
		Filename:     d.Filename,
		CreatedAt:    d.CreatedAt,
	}
}

// ------------------------------------------------------------------ #
// Collections
// ------------------------------------------------------------------ #
// ListCollections handles GET /api/knowledge-collections — all GLOBAL
// knowledge bases with an optional ?q=<name keyword> filter and document count.
// @Summary  List global knowledge collections (optional ?q keyword)
// @Tags     knowledge
// @Produce  json
// @Param    q query string false "Keyword in collection name"
// @Success  200 {object} map[string]any
// @Router   /knowledge-collections [get]
func (h *KnowledgeHandler) ListCollections(c *gin.Context) {
	type row struct {
		models.KnowledgeCollection
		DocumentCount int64  `json:"documentCount"`
	}
	q := h.db.Model(&models.KnowledgeCollection{}).
		Select("knowledge_collections.*, " +
			"(SELECT COUNT(*) FROM knowledge_documents WHERE knowledge_documents.collection_id = knowledge_collections.id) AS document_count").
		Where("1 = 1")
	if kw := strings.TrimSpace(c.Query("q")); kw != "" {
		q = q.Where("knowledge_collections.name LIKE ?", "%"+kw+"%")
	}
	var rows []row
	if err := q.Order("knowledge_collections.updated_at desc").Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	items := make([]collectionResponse, 0, len(rows))
	for _, r := range rows {
		items = append(items, collectionResponse{
			ID:            r.ID,
			Name:          r.Name,
			DocumentCount: r.DocumentCount,
			CreatedAt:     r.CreatedAt,
			UpdatedAt:     r.UpdatedAt,
		})
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// GetKnowledgeSelection handles GET /api/avatars/:id/knowledge-selection.
// @Summary  List global collections with this avatar's bind/enabled state
// @Tags     knowledge
// @Produce  json
// @Param    id path int true "Avatar ID"
// @Success  200 {object} map[string]any
// @Router   /avatars/{id}/knowledge-selection [get]
func (h *KnowledgeHandler) GetKnowledgeSelection(c *gin.Context) {
	avatarID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || avatarID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.avatar.invalid_id")})
		return
	}
	type item struct {
		ID      uint   `json:"id"`
		Name    string `json:"name"`
		Enabled bool   `json:"enabled"`
	}
	var cols []models.KnowledgeCollection
	if err := h.db.Order("updated_at desc").Find(&cols).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	items := make([]item, 0, len(cols))
	for _, col := range cols {
		items = append(items, item{ID: col.ID, Name: col.Name})
	}
	var binds []models.AvatarKnowledge
	if err := h.db.Where("avatar_id = ?", avatarID).Find(&binds).Error; err == nil {
		byID := map[uint]bool{}
		for _, b := range binds {
			byID[b.CollectionID] = b.Enabled
		}
		for i := range items {
			items[i].Enabled = byID[items[i].ID]
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// SetKnowledgeSelection handles POST /api/avatars/:id/knowledge-selection.
// @Summary  Set which global collections are bound/enabled for an avatar
// @Tags     knowledge
// @Accept   json
// @Produce  json
// @Param    id path int true "Avatar ID"
// @Param    request body map[string]any true "collectionIds: []uint"
// @Success  200 {object} map[string]any
// @Router   /avatars/{id}/knowledge-selection [post]
func (h *KnowledgeHandler) SetKnowledgeSelection(c *gin.Context) {
	avatarID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || avatarID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.avatar.invalid_id")})
		return
	}
	var req struct {
		CollectionIds []uint `json:"collectionIds"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tcf(c, "err.invalid_request_body", err.Error())})
		return
	}
	selected := map[uint]bool{}
	for _, id := range req.CollectionIds {
		selected[id] = true
	}
	var binds []models.AvatarKnowledge
	if err := h.db.Where("avatar_id = ?", avatarID).Find(&binds).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	seen := map[uint]bool{}
	for _, b := range binds {
		seen[b.CollectionID] = true
		want := selected[b.CollectionID]
		if b.Enabled != want {
			if err := h.db.Model(&models.AvatarKnowledge{}).
				Where("avatar_id = ? AND collection_id = ?", avatarID, b.CollectionID).
				Update("enabled", want).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
	}
	for _, id := range req.CollectionIds {
		if !seen[id] {
			if err := h.db.Create(&models.AvatarKnowledge{
				AvatarID:     uint(avatarID),
				CollectionID: id,
				Enabled:      true,
			}).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// CreateCollection handles POST /api/knowledge-collections with {"name": ...}
// — creates a GLOBAL knowledge base that avatars can bind to.
// @Summary  Create a global knowledge collection
// @Tags     knowledge
// @Accept   json
// @Produce  json
// @Param    request body map[string]any true "name"
// @Success  201 {object} map[string]any
// @Router   /knowledge-collections [post]
func (h *KnowledgeHandler) CreateCollection(c *gin.Context) {
	var req struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tcf(c, "err.invalid_request_body", err.Error())})
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.knowledge.name_required")})
		return
	}

	row := models.KnowledgeCollection{Name: req.Name}
	if err := h.db.Create(&row).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": i18n.Tcf(c, "err.knowledge.save_failed", err.Error())})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": collectionResponse{
		ID: row.ID, Name: row.Name, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}})
}

// RenameCollection handles PUT /api/knowledge-collections/:id with {"name": ...}.
// RenameCollection handles PUT /api/knowledge-collections/:id.
// @Summary  Rename a knowledge collection
// @Tags     knowledge
// @Accept   json
// @Produce  json
// @Param    id path int true "Collection ID"
// @Param    request body map[string]any true "name"
// @Success  200 {object} map[string]any
// @Router   /knowledge-collections/{id} [put]
func (h *KnowledgeHandler) RenameCollection(c *gin.Context) {
	cid, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || cid == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.knowledge.collection_invalid_id")})
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tcf(c, "err.invalid_request_body", err.Error())})
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.knowledge.name_required")})
		return
	}
	var row models.KnowledgeCollection
	if err := h.db.First(&row, cid).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": i18n.Tc(c, "err.knowledge.collection_not_found")})
		return
	}
	row.Name = req.Name
	if err := h.db.Save(&row).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": collectionResponse{
		ID: row.ID, Name: row.Name,
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}})
}

// DeleteCollection handles DELETE /api/knowledge-collections/:id — removes the
// collection, its documents (rows + S3 sources) and the service-rag chunks.
// DeleteCollection handles DELETE /api/knowledge-collections/:id.
// @Summary  Delete a collection (cascades documents + indexes)
// @Tags     knowledge
// @Produce  json
// @Param    id path int true "Collection ID"
// @Success  200 {object} map[string]any
// @Router   /knowledge-collections/{id} [delete]
func (h *KnowledgeHandler) DeleteCollection(c *gin.Context) {
	cid, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || cid == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.knowledge.collection_invalid_id")})
		return
	}
	var row models.KnowledgeCollection
	if err := h.db.First(&row, cid).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": i18n.Tc(c, "err.knowledge.collection_not_found")})
		return
	}

	var docs []models.KnowledgeDocument
	h.db.Where("collection_id = ?", row.ID).Find(&docs)
	for _, d := range docs {
		if d.SourceKey != "" {
			_ = h.s3.Delete(c.Request.Context(), d.SourceKey)
		}
	}
	if err := h.db.Where("collection_id = ?", row.ID).Delete(&models.KnowledgeDocument{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	_ = h.db.Where("collection_id = ?", row.ID).Delete(&models.AvatarKnowledge{}).Error
	if err := h.db.Delete(&row).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := h.ragDelete(map[string]any{"collection_id": row.ID}); err != nil {
		log.Printf("[rag] service-rag delete for collection %d failed: %v", row.ID, err)
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ------------------------------------------------------------------ #
// Documents
// ------------------------------------------------------------------ #
// ListDocuments handles GET /api/knowledge-collections/:id/documents.
// ListDocuments handles GET /api/knowledge-collections/:id/documents.
// @Summary  List documents of a collection
// @Tags     knowledge
// @Produce  json
// @Param    id path int true "Collection ID"
// @Success  200 {object} map[string]any
// @Router   /knowledge-collections/{id}/documents [get]
func (h *KnowledgeHandler) ListDocuments(c *gin.Context) {
	cid, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || cid == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.knowledge.collection_invalid_id")})
		return
	}
	var rows []models.KnowledgeDocument
	if err := h.db.Where("collection_id = ?", cid).
		Order("created_at desc").Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	items := make([]documentResponse, 0, len(rows))
	for _, r := range rows {
		items = append(items, toDocumentResponse(r))
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// CreateDocument handles POST /api/knowledge-collections/:id/documents —
// multipart/form-data with either a `text` field (raw knowledge text) or a
// `file` field (.txt/.pdf). The row is persisted, the source is uploaded to
// S3, plain text is extracted and ingested synchronously into service-rag.
// CreateDocument handles POST /api/knowledge-collections/:id/documents.
// @Summary  Add a document (text or .txt/.pdf upload)
// @Tags     knowledge
// @Accept   multipart/form-data
// @Produce  json
// @Param    id path int true "Collection ID"
// @Param    text formData string false "Plain text content"
// @Param    file formData file false ".txt/.pdf source file"
// @Success  201 {object} map[string]any
// @Router   /knowledge-collections/{id}/documents [post]
func (h *KnowledgeHandler) CreateDocument(c *gin.Context) {
	cid, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || cid == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.knowledge.collection_invalid_id")})
		return
	}
	var collection models.KnowledgeCollection
	if err := h.db.First(&collection, cid).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": i18n.Tc(c, "err.knowledge.collection_not_found")})
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
		filename = "text-" + strconv.FormatUint(cid, 10) + "-" +
			strconv.FormatInt(time.Now().UnixMilli(), 10) + ".txt"
		s3Key, err = h.uploadKnowledgeText(c, filename, text)
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": i18n.Tcf(c, "err.knowledge.upload_failed", err.Error()),
		})
		return
	}

	row := models.KnowledgeDocument{
		CollectionID: uint(cid),
		Content:      text, // filled immediately for text; files get extracted text below
		Status:       models.KnowledgeStatusPending,
		SourceKey:    s3Key,
		Filename:     filename,
	}
	if err := h.db.Create(&row).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": i18n.Tcf(c, "err.knowledge.save_failed", err.Error()),
		})
		return
	}

	// Extract plain text (raw text field is used directly; files are pulled
	// from S3) and push it into the service-rag knowledge store.
	content := text
	if fileErr == nil {
		data, err := h.s3.Download(c.Request.Context(), s3Key)
		if err != nil {
			content = ""
		} else {
			content, err = extractKnowledgeText(filename, data)
			if err != nil {
				log.Printf("[rag] knowledge text extraction failed: %v", err)
				content = ""
			}
		}
	}

	status := models.KnowledgeStatusIndexed
	if content == "" || h.ragURL == "" {
		status = models.KnowledgeStatusFailed
	} else if err := h.ragIngest(0, row.CollectionID, row.ID, content); err != nil {
		log.Printf("[rag] service-rag ingest failed for document %d: %v", row.ID, err)
		status = models.KnowledgeStatusFailed
	}

	updates := map[string]any{"status": status}
	if content != "" {
		updates["content"] = content
	}
	if err := h.db.Model(&models.KnowledgeDocument{}).
		Where("id = ? AND collection_id = ?", row.ID, row.CollectionID).
		Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	row.Status = status
	if content != "" {
		row.Content = content
	}
	c.JSON(http.StatusCreated, gin.H{"data": toDocumentResponse(row)})
}

// DeleteDocument handles DELETE /api/knowledge-collections/:id/documents/:did —
// removes the DB row, the S3 source and the service-rag chunks of that source.
// DeleteDocument handles DELETE /api/knowledge-collections/:id/documents/:did.
// @Summary  Delete a document (including its indexes)
// @Tags     knowledge
// @Produce  json
// @Param    id path int true "Collection ID"
// @Param    did path int true "Document ID"
// @Success  200 {object} map[string]any
// @Router   /knowledge-collections/{id}/documents/{did} [delete]
func (h *KnowledgeHandler) DeleteDocument(c *gin.Context) {
	cid, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || cid == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.knowledge.collection_invalid_id")})
		return
	}
	did, err := strconv.ParseUint(c.Param("did"), 10, 64)
	if err != nil || did == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.knowledge.document_invalid_id")})
		return
	}
	var row models.KnowledgeDocument
	if err := h.db.Where("id = ? AND collection_id = ?", did, cid).First(&row).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": i18n.Tc(c, "err.knowledge.document_not_found")})
		return
	}
	if row.SourceKey != "" {
		_ = h.s3.Delete(c.Request.Context(), row.SourceKey)
	}
	if err := h.db.Delete(&row).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := h.ragDelete(map[string]any{"source_id": row.ID}); err != nil {
		log.Printf("[rag] service-rag delete for document %d failed: %v", row.ID, err)
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ListDocumentChunks handles POST
// /api/knowledge-collections/:id/documents/:did/chunks — returns the actual
// indexed chunks of one document (from service-rag) in original order, so the
// management UI can show how the document was split.
// ListDocumentChunks handles POST /api/knowledge-collections/:id/documents/:did/chunks.
// @Summary  Inspect the indexed chunks of a document
// @Tags     knowledge
// @Produce  json
// @Param    id path int true "Collection ID"
// @Param    did path int true "Document ID"
// @Success  200 {object} map[string]any
// @Router   /knowledge-collections/{id}/documents/{did}/chunks [post]
func (h *KnowledgeHandler) ListDocumentChunks(c *gin.Context) {
	cid, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || cid == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.knowledge.collection_invalid_id")})
		return
	}
	did, err := strconv.ParseUint(c.Param("did"), 10, 64)
	if err != nil || did == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.knowledge.document_invalid_id")})
		return
	}
	var row models.KnowledgeDocument
	if err := h.db.Where("id = ? AND collection_id = ?", did, cid).First(&row).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": i18n.Tc(c, "err.knowledge.document_not_found")})
		return
	}
	if strings.TrimSpace(h.ragURL) == "" {
		c.JSON(http.StatusBadGateway, gin.H{"error": i18n.Tc(c, "err.knowledge.embed_unavailable")})
		return
	}
	body, err := json.Marshal(map[string]any{
		"source_id":     row.ID,
		"collection_id": row.CollectionID,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	resp, err := http.Post(
		strings.TrimRight(h.ragURL, "/")+"/v1/knowledge/chunks",
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
			Index int    `json:"index"`
			Text  string `json:"text"`
		} `json:"chunks"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": i18n.Tc(c, "err.knowledge.search_failed")})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out.Chunks})
}

// SearchTest handles POST /api/knowledge/search — a live retrieval test that
// proxies to the service-rag /v1/knowledge/search. Scope is either an avatar
// (all of its collections) or one collection (management UI).
// SearchTest handles POST /api/knowledge/search.
// @Summary  Retrieval test (avatarId or collectionId, Top-3)
// @Tags     knowledge
// @Accept   json
// @Produce  json
// @Param    request body map[string]any true "query + avatarId/collectionId"
// @Success  200 {object} map[string]any
// @Router   /knowledge/search [post]
func (h *KnowledgeHandler) SearchTest(c *gin.Context) {
	var req struct {
		AvatarID     uint `json:"avatarId"`
		CollectionID uint `json:"collectionId"`
		Text         string `json:"text"`
		TopK         int  `json:"topK"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tcf(c, "err.invalid_request_body", err.Error())})
		return
	}
	if req.AvatarID == 0 && req.CollectionID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.knowledge.search_required")})
		return
	}
	if strings.TrimSpace(req.Text) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.knowledge.search_required")})
		return
	}
	scope := map[string]any{}
	if req.AvatarID != 0 {
		scope["avatar_id"] = req.AvatarID
	}
	if req.CollectionID != 0 {
		scope["collection_id"] = req.CollectionID
	}
	chunks, scores, err := h.ragSearch(scope, req.Text, max(1, req.TopK))
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": i18n.Tc(c, "err.knowledge.embed_unavailable")})
		return
	}
	items := make([]map[string]string, 0, len(chunks))
	for i, content := range chunks {
		score := ""
		if i < len(scores) {
			score = strconv.FormatFloat(scores[i], 'f', 4, 64)
		}
		items = append(items, map[string]string{"content": content, "score": score})
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// ------------------------------------------------------------------ #
// service-rag client helpers
// ------------------------------------------------------------------ #
// ragIngest pushes raw knowledge text into the service-rag for chunking +
// Jieba FTS indexing, scoped to one document (source_id) of one collection.
func (h *KnowledgeHandler) ragIngest(avatarID, collectionID, sourceID uint, text string) error {
	body, err := json.Marshal(map[string]any{
		"avatar_id":    avatarID,
		"collection_id": collectionID,
		"source_id":    sourceID,
		"text_content": text,
		"replace":      false,
	})
	if err != nil {
		return err
	}
	resp, err := http.Post(
		strings.TrimRight(h.ragURL, "/")+"/v1/knowledge/ingest",
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("service-rag ingest returned %d", resp.StatusCode)
	}
	return nil
}

// ragSearch runs a Top-K Jieba full-text search restricted to the given scope
// (avatar_id and/or collection_id).
func (h *KnowledgeHandler) ragSearch(scope map[string]any, query string, topK int) ([]string, []float64, error) {
	payload := map[string]any{"query": query}
	for k, v := range scope {
		payload[k] = v
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, nil, err
	}
	resp, err := http.Post(
		strings.TrimRight(h.ragURL, "/")+"/v1/knowledge/search",
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, nil, fmt.Errorf("service-rag search returned %d", resp.StatusCode)
	}
	var out struct {
		Contexts []string  `json:"contexts"`
		Scores   []float64 `json:"scores"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, nil, err
	}
	if topK > 0 && len(out.Contexts) > topK {
		out.Contexts = out.Contexts[:topK]
		out.Scores = out.Scores[:topK]
	}
	return out.Contexts, out.Scores, nil
}

// ragDelete removes chunks from the service-rag for the given scope fields
// (source_id / collection_id / avatar_id).
func (h *KnowledgeHandler) ragDelete(scope map[string]any) error {
	body, err := json.Marshal(scope)
	if err != nil {
		return err
	}
	resp, err := http.Post(
		strings.TrimRight(h.ragURL, "/")+"/v1/knowledge/delete",
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("service-rag delete returned %d", resp.StatusCode)
	}
	return nil
}

// ------------------------------------------------------------------ #
// S3 + extraction helpers
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

// extractKnowledgeText returns plain text from a .txt or .pdf byte payload.
func extractKnowledgeText(filename string, data []byte) (string, error) {
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".txt":
		text := strings.TrimPrefix(string(data), "\ufeff")
		if strings.TrimSpace(text) == "" {
			return "", fmt.Errorf("empty txt content")
		}
		return text, nil
	case ".pdf":
		return extractPDFText(data)
	default:
		return "", fmt.Errorf("unsupported extension: %s", filename)
	}
}

func extractPDFText(data []byte) (string, error) {
	r, err := pdf.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", err
	}
	var sb strings.Builder
	for i := 1; i <= r.NumPage(); i++ {
		p := r.Page(i)
		if p.V.IsNull() {
			continue
		}
		if t, err := p.GetPlainText(nil); err == nil {
			sb.WriteString(t)
			sb.WriteString("\n")
		}
	}
	text := strings.TrimSpace(sb.String())
	if text == "" {
		return "", fmt.Errorf("pdf contains no extractable text")
	}
	return text, nil
}
