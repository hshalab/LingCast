package handlers

import (
	"errors"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"talkingavatar/backend/internal/i18n"
	"talkingavatar/backend/internal/models"
)

// avatarVideoItem is one selectable driving video for an avatar.
type avatarVideoItem struct {
	ID        uint   `json:"id"`
	AvatarID  uint   `json:"avatarId"`
	Name      string `json:"name"`
	S3Key     string `json:"s3Key"`
	S3URL     string `json:"s3Url"`
	Source    string `json:"source"` // system | upload
	IsDefault bool   `json:"isDefault"`
}

var allowedVideoExts = map[string]bool{
	".mp4": true, ".mov": true, ".webm": true, ".mkv": true, ".avi": true,
}

// ListVideos handles GET /api/avatars/:id/videos.
// @Summary  List an avatar's driving videos (system default + uploads)
// @Tags     avatars
// @Produce  json
// @Param    id path int true "Avatar ID"
// @Success  200 {object} map[string]any
// @Router   /avatars/{id}/videos [get]
func (h *AvatarHandler) ListVideos(c *gin.Context) {
	avatarID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || avatarID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.avatar.invalid_id")})
		return
	}
	var avatar models.Avatar
	if err := h.db.First(&avatar, avatarID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": i18n.Tc(c, "err.avatar.not_found")})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	items := []avatarVideoItem{}
	if avatar.BaseVideoS3Key != nil && strings.TrimSpace(*avatar.BaseVideoS3Key) != "" {
		items = append(items, avatarVideoItem{
			AvatarID:  avatar.ID,
			Name:      "",
			S3Key:     *avatar.BaseVideoS3Key,
			S3URL:     h.s3.PublicURL(*avatar.BaseVideoS3Key),
			Source:    "system",
			IsDefault: true,
		})
	}
	var rows []models.AvatarVideo
	if err := h.db.Where("avatar_id = ?", avatar.ID).Order("id desc").Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	for _, v := range rows {
		items = append(items, avatarVideoItem{
			ID:       v.ID,
			AvatarID: v.AvatarID,
			Name:     v.Name,
			S3Key:    v.S3Key,
			S3URL:    h.s3.PublicURL(v.S3Key),
			Source:   v.Source,
		})
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// CreateVideo handles POST /api/avatars/:id/videos.
// @Summary  Upload a driving video for an avatar (other-AI style clips)
// @Tags     avatars
// @Accept   multipart/form-data
// @Produce  json
// @Param    id path int true "Avatar ID"
// @Param    name formData string false "Display name"
// @Param    file formData file true "Video file (mp4/mov/webm/mkv/avi)"
// @Success  201 {object} avatarVideoItem
// @Failure  400 {object} map[string]any
// @Router   /avatars/{id}/videos [post]
func (h *AvatarHandler) CreateVideo(c *gin.Context) {
	avatarID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || avatarID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.avatar.invalid_id")})
		return
	}
	var avatar models.Avatar
	if err := h.db.First(&avatar, avatarID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": i18n.Tc(c, "err.avatar.not_found")})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	_, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.avatar.video_required")})
		return
	}
	ext := strings.ToLower(filepath.Ext(header.Filename))
	if !allowedVideoExts[ext] {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.avatar.video_type")})
		return
	}
	key, err := h.uploadFormFile(c, header, "avatar_videos")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": i18n.Tcf(c, "err.avatar.upload_failed", err.Error())})
		return
	}
	name := strings.TrimSpace(c.PostForm("name"))
	if name == "" {
		name = header.Filename
	}
	row := models.AvatarVideo{AvatarID: avatar.ID, Name: name, S3Key: key, Source: "upload"}
	if err := h.db.Create(&row).Error; err != nil {
		_ = h.s3.Delete(c.Request.Context(), key)
		c.JSON(http.StatusInternalServerError, gin.H{"error": i18n.Tcf(c, "err.avatar.video_save_failed", err.Error())})
		return
	}
	c.JSON(http.StatusCreated, avatarVideoItem{
		ID: row.ID, AvatarID: row.AvatarID, Name: row.Name,
		S3Key: row.S3Key, S3URL: h.s3.PublicURL(row.S3Key), Source: row.Source,
	})
}

// DeleteVideo handles DELETE /api/videos/:id.
// @Summary  Delete an uploaded driving video (system default is protected)
// @Tags     avatars
// @Produce  json
// @Param    id path int true "Video ID"
// @Success  200 {object} map[string]any
// @Router   /videos/{id} [delete]
func (h *AvatarHandler) DeleteVideo(c *gin.Context) {
	videoID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || videoID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.avatar.invalid_id")})
		return
	}
	var row models.AvatarVideo
	if err := h.db.First(&row, videoID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": i18n.Tc(c, "err.avatar.video_not_found")})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	var avatar models.Avatar
	if err := h.db.First(&avatar, row.AvatarID).Error; err == nil &&
		avatar.BaseVideoS3Key != nil && *avatar.BaseVideoS3Key == row.S3Key {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.avatar.video_default")})
		return
	}
	if err := h.db.Delete(&row).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	_ = h.s3.Delete(c.Request.Context(), row.S3Key)
	c.JSON(http.StatusOK, gin.H{"deleted": row.ID})
}
