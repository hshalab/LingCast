package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"mime"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"talkingavatar/backend/internal/models"
	"talkingavatar/backend/internal/storage"
)

// AvatarHandler serves avatar material uploads and queries.
type AvatarHandler struct {
	db *gorm.DB
	s3 *storage.Client
}

type avatarResponse struct {
	ID              uint      `json:"id"`
	Name            string    `json:"name"`
	ImageS3Key      string    `json:"imageS3Key"`
	ImageS3URL      string    `json:"imageS3Url"`
	VoiceAudioS3Key *string   `json:"voiceAudioS3Key,omitempty"`
	VoiceAudioS3URL *string   `json:"voiceAudioS3Url,omitempty"`
	CreatedAt       time.Time `json:"createdAt"`
}

func NewAvatarHandler(db *gorm.DB, s3 *storage.Client) *AvatarHandler {
	return &AvatarHandler{db: db, s3: s3}
}

// Create handles POST /api/avatars. It accepts multipart/form-data with
// `name`, `image` (required) and `voice_audio` (optional) fields, uploads the
// files directly to S3 and stores the returned keys in MySQL.
func (h *AvatarHandler) Create(c *gin.Context) {
	name := strings.TrimSpace(c.PostForm("name"))
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "field 'name' is required"})
		return
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

	var voiceAudioKey *string
	if audioHeader, err := c.FormFile("voice_audio"); err == nil {
		key, err := h.uploadFormFile(c, audioHeader, "avatars")
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "upload voice audio failed: " + err.Error()})
			return
		}
		voiceAudioKey = &key
	}

	avatar := models.Avatar{
		Name:            name,
		ImageS3Key:      imageKey,
		VoiceAudioS3Key: voiceAudioKey,
	}
	if err := h.db.Create(&avatar).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "save avatar failed: " + err.Error()})
		return
	}

	c.JSON(http.StatusCreated, toAvatarResponse(avatar, h.s3))
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
		CreatedAt:  a.CreatedAt,
	}
	if a.VoiceAudioS3Key != nil {
		key := *a.VoiceAudioS3Key
		resp.VoiceAudioS3Key = &key
		if url := s3.PublicURL(key); url != "" {
			resp.VoiceAudioS3URL = &url
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
