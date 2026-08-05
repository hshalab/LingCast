package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
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
	ID              uint      `json:"id"`
	Name            string    `json:"name"`
	ImageS3Key      string    `json:"imageS3Key"`
	ImageS3URL      string    `json:"imageS3Url"`
	VoiceAudioS3Key *string   `json:"voiceAudioS3Key,omitempty"`
	VoiceAudioS3URL *string   `json:"voiceAudioS3Url,omitempty"`
	VoiceID         string    `json:"voiceId"`
	BaseVideoS3Key  *string   `json:"baseVideoS3Key,omitempty"`
	BaseVideoS3URL  *string   `json:"baseVideoS3Url,omitempty"`
	Status          string    `json:"status"`
	CreatedAt       time.Time `json:"createdAt"`
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
		Name:       name,
		ImageS3Key: imageKey,
		VoiceID:    voiceID,
		Status:     models.AvatarStatusInitializing,
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

	resp := make([]avatarResponse, 0, len(avatars))
	for _, a := range avatars {
		resp = append(resp, toAvatarResponse(a, h.s3))
	}
	c.JSON(http.StatusOK, gin.H{"data": resp})
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
	resp := avatarResponse{
		ID:         a.ID,
		Name:       a.Name,
		ImageS3Key: a.ImageS3Key,
		ImageS3URL: s3.PublicURL(a.ImageS3Key),
		VoiceID:    a.VoiceID,
		Status:     a.Status,
		CreatedAt:  a.CreatedAt,
	}
	if a.VoiceAudioS3Key != nil {
		key := *a.VoiceAudioS3Key
		resp.VoiceAudioS3Key = &key
		if url := s3.PublicURL(key); url != "" {
			resp.VoiceAudioS3URL = &url
		}
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
