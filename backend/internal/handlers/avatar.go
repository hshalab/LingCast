package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"talkingavatar/backend/internal/models"
	"talkingavatar/backend/internal/queue"
	"talkingavatar/backend/internal/storage"
)

// AvatarHandler serves avatar material uploads and queries.
type AvatarHandler struct {
	db                 *gorm.DB
	s3                 *storage.Client
	q                  *queue.Queue
	avatarInitQueueKey string
}

type avatarResponse struct {
	ID                 uint                `json:"id"`
	Name               string              `json:"name"`
	ImageS3Key         string              `json:"imageS3Key"`
	ImageS3URL         string              `json:"imageS3Url"`
	Category           string              `json:"category"`
	Age                *int                `json:"age,omitempty"`
	HeightCm           *int                `json:"heightCm,omitempty"`
	WeightKg           *int                `json:"weightKg,omitempty"`
	Ethnicity          string              `json:"ethnicity,omitempty"`
	RelationshipStatus string              `json:"relationshipStatus,omitempty"`
	Personality        string              `json:"personality,omitempty"`
	VoiceID            string              `json:"voiceId"`
	BaseVideoS3Key     *string             `json:"baseVideoS3Key,omitempty"`
	BaseVideoS3URL     *string             `json:"baseVideoS3Url,omitempty"`
	Status             string              `json:"status"`
	InitQueuePos       *int                `json:"initQueuePos,omitempty"`
	LiveSettings       models.LiveSettings `json:"liveSettings"`
	CreatedAt          time.Time           `json:"createdAt"`
}

func NewAvatarHandler(db *gorm.DB, s3 *storage.Client, q *queue.Queue, avatarInitQueueKey string) *AvatarHandler {
	return &AvatarHandler{db: db, s3: s3, q: q, avatarInitQueueKey: avatarInitQueueKey}
}

// Create handles POST /api/avatars. It accepts multipart/form-data with
// `name`, `image` (required) and `voice_id` (optional) fields, uploads the
// image to S3, stores the record as `initializing` and enqueues the
// LivePortrait base-video pre-processing job.
func (h *AvatarHandler) Create(c *gin.Context) {
	name := strings.TrimSpace(c.PostForm("name"))
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "field 'name' is required"})
		return
	}
	voiceID := strings.TrimSpace(c.PostForm("voice_id"))
	if voiceID == "" {
		voiceID = models.DefaultEdgeVoice
	}
	category := normalizeCategory(c.PostForm("category"))
	age := optionalInt(c.PostForm("age"))
	heightCm := optionalInt(c.PostForm("height_cm"))
	weightKg := optionalInt(c.PostForm("weight_kg"))
	ethnicity := strings.TrimSpace(c.PostForm("ethnicity"))
	relationshipStatus := strings.TrimSpace(c.PostForm("relationship_status"))
	personality := strings.TrimSpace(c.PostForm("personality"))

	imageHeader, err := c.FormFile("image")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "field 'image' (file) is required"})
		return
	}

	imageKey, err := h.uploadFormFile(c, imageHeader, "avatars")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "upload image failed: " + err.Error()})
		return
	}

	avatar := models.Avatar{
		Name:               name,
		ImageS3Key:         imageKey,
		Category:           category,
		Age:                age,
		HeightCm:           heightCm,
		WeightKg:           weightKg,
		Ethnicity:          ethnicity,
		RelationshipStatus: relationshipStatus,
		Personality:        personality,
		VoiceID:            voiceID,
		Status:             models.AvatarStatusInitializing,
	}
	if err := h.db.Create(&avatar).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "save avatar failed: " + err.Error()})
		return
	}

	// Notify the worker to pre-process the image into a silent base driving
	// video (LivePortrait) and write the S3 key back via the webhook below.
	init := queue.AvatarInitPayload{
		AvatarID:   avatar.ID,
		ImageS3Key: imageKey,
	}
	if err := h.q.PushTo(c.Request.Context(), h.avatarInitQueueKey, init); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "enqueue avatar init failed: " + err.Error()})
		return
	}

	c.JSON(http.StatusCreated, toAvatarResponse(avatar, h.s3))
}

// Get handles GET /api/avatars/:id so the frontend can poll the avatar's
// initialization status until it becomes "ready".
func (h *AvatarHandler) Get(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid avatar id"})
		return
	}
	var avatar models.Avatar
	if err := h.db.First(&avatar, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "avatar not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, toAvatarResponse(avatar, h.s3))
}

// UpdateBaseVideo handles POST /api/avatars/:id/base-video — an internal
// webhook used by the worker to persist the pre-processed base video S3 key.
func (h *AvatarHandler) UpdateBaseVideo(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid avatar id"})
		return
	}
	var req struct {
		BaseVideoS3Key string `json:"baseVideoS3Key"`
		Status         string `json:"status"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.BaseVideoS3Key) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "field 'baseVideoS3Key' is required"})
		return
	}
	status := strings.TrimSpace(req.Status)
	if status == "" {
		status = models.AvatarStatusReady
	}
	if status != models.AvatarStatusReady && status != models.AvatarStatusFailed {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid status"})
		return
	}

	var avatar models.Avatar
	if err := h.db.First(&avatar, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "avatar not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	key := strings.TrimSpace(req.BaseVideoS3Key)
	avatar.BaseVideoS3Key = &key
	avatar.Status = status
	if err := h.db.Save(&avatar).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, toAvatarResponse(avatar, h.s3))
}

// List handles GET /api/avatars and returns all avatars (newest first) so the
// frontend can pick an existing material set.
func (h *AvatarHandler) List(c *gin.Context) {
	var avatars []models.Avatar
	if err := h.db.Order("created_at DESC").Find(&avatars).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	queuePos := h.initQueuePositions(c)
	resp := make([]avatarResponse, 0, len(avatars))
	for _, a := range avatars {
		r := toAvatarResponse(a, h.s3)
		if pos, ok := queuePos[a.ID]; ok {
			r.InitQueuePos = &pos
		}
		resp = append(resp, r)
	}
	c.JSON(http.StatusOK, gin.H{"data": resp})
}

// initQueuePositions returns avatarId -> 0-based queue position for payloads
// still waiting in the avatar_init queue.
func (h *AvatarHandler) initQueuePositions(c *gin.Context) map[uint]int {
	positions := map[uint]int{}
	items, err := h.q.ListRange(c.Request.Context(), h.avatarInitQueueKey, 0, -1)
	if err != nil {
		return positions
	}
	for i, raw := range items {
		var p queue.AvatarInitPayload
		if json.Unmarshal([]byte(raw), &p) == nil && p.AvatarID > 0 {
			if _, seen := positions[p.AvatarID]; !seen {
				positions[p.AvatarID] = i
			}
		}
	}
	return positions
}

// Delete handles DELETE /api/avatars/:id — removes the avatar record, its S3
// objects and any pending queue entries (avatar init / live queue).
func (h *AvatarHandler) Delete(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid avatar id"})
		return
	}
	var avatar models.Avatar
	if err := h.db.First(&avatar, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "avatar not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	ctx := c.Request.Context()
	// Best-effort cleanup: S3 objects, pending init payload, live queue.
	_ = h.s3.Delete(ctx, avatar.ImageS3Key)
	if avatar.BaseVideoS3Key != nil {
		_ = h.s3.Delete(ctx, *avatar.BaseVideoS3Key)
	}
	if raw, err := json.Marshal(queue.AvatarInitPayload{
		AvatarID:   avatar.ID,
		ImageS3Key: avatar.ImageS3Key,
	}); err == nil {
		_ = h.q.Remove(ctx, h.avatarInitQueueKey, string(raw))
	}
	_ = h.q.DeleteKey(ctx, fmt.Sprintf("live_queue:%d", avatar.ID))

	// broadcast_tasks.avatar_id has a foreign key constraint, so delete the
	// avatar's tasks (and their output videos) before removing the avatar.
	var tasks []models.BroadcastTask
	if err := h.db.Where("avatar_id = ?", avatar.ID).Find(&tasks).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	for _, t := range tasks {
		if t.OutputVideoS3URL != nil {
			_ = h.s3.Delete(ctx, *t.OutputVideoS3URL)
		}
	}
	if err := h.db.Where("avatar_id = ?", avatar.ID).Delete(&models.BroadcastTask{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "delete tasks failed: " + err.Error()})
		return
	}
	if err := h.db.Where("avatar_id = ?", avatar.ID).Delete(&models.LiveSession{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "delete live session failed: " + err.Error()})
		return
	}

	if err := h.db.Delete(&avatar).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": avatar.ID})
}

// Retry handles POST /api/avatars/:id/retry — re-queues the LivePortrait
// base-video pre-processing for failed/skipped avatars.
func (h *AvatarHandler) Retry(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid avatar id"})
		return
	}
	var avatar models.Avatar
	if err := h.db.First(&avatar, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "avatar not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	if avatar.Status == models.AvatarStatusInitializing {
		c.JSON(http.StatusBadRequest, gin.H{"error": "avatar is already initializing"})
		return
	}
	avatar.Status = models.AvatarStatusInitializing
	if err := h.db.Save(&avatar).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := h.q.PushTo(c.Request.Context(), h.avatarInitQueueKey, queue.AvatarInitPayload{
		AvatarID:   avatar.ID,
		ImageS3Key: avatar.ImageS3Key,
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "enqueue retry failed: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, toAvatarResponse(avatar, h.s3))
}

// Skip handles POST /api/avatars/:id/skip — marks an initializing avatar as
// skipped (abandons base-video generation for it).
func (h *AvatarHandler) Skip(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid avatar id"})
		return
	}
	var avatar models.Avatar
	if err := h.db.First(&avatar, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "avatar not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	if avatar.Status != models.AvatarStatusInitializing {
		c.JSON(http.StatusBadRequest, gin.H{"error": "only initializing avatars can be skipped"})
		return
	}
	avatar.Status = models.AvatarStatusSkipped
	if err := h.db.Save(&avatar).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// Remove any pending queue payload so the worker won't pick it up.
	if raw, err := json.Marshal(queue.AvatarInitPayload{
		AvatarID:   avatar.ID,
		ImageS3Key: avatar.ImageS3Key,
	}); err == nil {
		_ = h.q.Remove(c.Request.Context(), h.avatarInitQueueKey, string(raw))
	}
	c.JSON(http.StatusOK, toAvatarResponse(avatar, h.s3))
}

// UpdateLiveSettings handles PUT /api/avatars/:id/live-settings — persists
// the avatar's live-streaming configuration (subtitle on/off, font, position,
// border, size) as a JSON string on the avatar row.
func (h *AvatarHandler) UpdateLiveSettings(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid avatar id"})
		return
	}
	var avatar models.Avatar
	if err := h.db.First(&avatar, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "avatar not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	var settings models.LiveSettings
	if err := c.ShouldBindJSON(&settings); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid live settings: " + err.Error()})
		return
	}
	settings.SubtitleFont = strings.TrimSpace(settings.SubtitleFont)
	if settings.SubtitlePosition != "top" {
		settings.SubtitlePosition = "bottom"
	}
	if settings.SubtitleSize < 24 || settings.SubtitleSize > 96 {
		settings.SubtitleSize = models.DefaultLiveSettings().SubtitleSize
	}
	if settings.SubtitleBorder < 0 || settings.SubtitleBorder > 10 {
		settings.SubtitleBorder = 0
	}

	data, err := json.Marshal(settings)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	avatar.LiveSettings = string(data)
	if err := h.db.Save(&avatar).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, toAvatarResponse(avatar, h.s3))
}

func (h *AvatarHandler) uploadFormFile(c *gin.Context, header *multipart.FileHeader, prefix string) (string, error) {
	file, err := header.Open()
	if err != nil {
		return "", err
	}
	defer file.Close()

	key := newObjectKey(prefix, header.Filename)
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

func toAvatarResponse(a models.Avatar, s3 *storage.Client) avatarResponse {
	liveSettings := parseLiveSettings(a.LiveSettings)
	resp := avatarResponse{
		ID:                 a.ID,
		Name:               a.Name,
		ImageS3Key:         a.ImageS3Key,
		ImageS3URL:         s3.PublicURL(a.ImageS3Key),
		Category:           normalizeCategory(a.Category),
		Age:                a.Age,
		HeightCm:           a.HeightCm,
		WeightKg:           a.WeightKg,
		Ethnicity:          a.Ethnicity,
		RelationshipStatus: a.RelationshipStatus,
		Personality:        a.Personality,
		VoiceID:            a.VoiceID,
		Status:             a.Status,
		LiveSettings:       liveSettings,
		CreatedAt:          a.CreatedAt,
	}
	if a.BaseVideoS3Key != nil {
		key := *a.BaseVideoS3Key
		resp.BaseVideoS3Key = &key
		if url := s3.PublicURL(key); url != "" {
			resp.BaseVideoS3URL = &url
		}
	}
	return resp
}

func normalizeCategory(c string) string {
	if c = strings.TrimSpace(c); c == "" {
		return "其他"
	}
	return c
}

// optionalInt parses a form value into *int, returning nil for empty/invalid
// or non-positive input (the profile numeric fields are all optional).
func optionalInt(raw string) *int {
	n, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || n <= 0 {
		return nil
	}
	return &n
}

// parseLiveSettings decodes the avatar's JSON live settings, falling back to
// defaults for missing/invalid content and filling zero fields with defaults.
func parseLiveSettings(raw string) models.LiveSettings {
	settings := models.DefaultLiveSettings()
	if strings.TrimSpace(raw) != "" {
		if err := json.Unmarshal([]byte(raw), &settings); err != nil {
			return settings
		}
	}
	// Normalize: empty position -> bottom; zero size/border -> defaults.
	if settings.SubtitlePosition != "top" {
		settings.SubtitlePosition = "bottom"
	}
	if settings.SubtitleSize <= 0 {
		settings.SubtitleSize = models.DefaultLiveSettings().SubtitleSize
	}
	if settings.SubtitleBorder < 0 {
		settings.SubtitleBorder = 0
	}
	return settings
}

func newObjectKey(prefix, filename string) string {
	randBytes := make([]byte, 8)
	_, _ = rand.Read(randBytes)
	return prefix + "/" + time.Now().Format("20060102") + "_" + hex.EncodeToString(randBytes) + "_" + sanitizeFilename(filename)
}

func sanitizeFilename(name string) string {
	name = filepath.Base(name)
	var b strings.Builder
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '.', r == '-', r == '_':
			b.WriteRune(r)
		default:
			b.WriteByte('_')
		}
	}
	s := b.String()
	if s == "" {
		return "file"
	}
	if len(s) > 100 {
		s = s[len(s)-100:]
	}
	return s
}
