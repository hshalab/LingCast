package admin

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"talkingavatar/backend/internal/i18n"
	"talkingavatar/backend/internal/models"
)

type sceneVideoItem struct {
	ID          uint   `json:"id"`
	SceneID     uint   `json:"sceneId"`
	S3Key       string `json:"s3Key"`
	S3URL       string `json:"s3Url"`
	Description string `json:"description,omitempty"`
	IsDefault   bool   `json:"isDefault"`
}

type sceneItem struct {
	ID          uint             `json:"id"`
	AvatarID    uint             `json:"avatarId"`
	Title       string           `json:"title"`
	Description string           `json:"description,omitempty"`
	CoverS3Key  string           `json:"coverS3Key"`
	CoverS3URL  string           `json:"coverS3Url"`
	IsDefault   bool             `json:"isDefault"`
	Videos      []sceneVideoItem `json:"videos"`
}

func (h *AvatarHandler) toSceneItem(s models.Scene) sceneItem {
	item := sceneItem{
		ID:          s.ID,
		AvatarID:    s.AvatarID,
		Title:       s.Title,
		Description: s.Description,
		CoverS3Key:  s.CoverS3Key,
		CoverS3URL:  h.s3.PublicURL(s.CoverS3Key),
		IsDefault:   s.IsDefault,
		Videos:      []sceneVideoItem{},
	}
	var videos []models.SceneVideo
	if err := h.db.Where("scene_id = ?", s.ID).Order("is_default DESC, id ASC").
		Find(&videos).Error; err == nil {
		for _, v := range videos {
			item.Videos = append(item.Videos, sceneVideoItem{
				ID:          v.ID,
				SceneID:     v.SceneID,
				S3Key:       v.S3Key,
				S3URL:       h.s3.PublicURL(v.S3Key),
				Description: v.Description,
				IsDefault:   v.IsDefault,
			})
		}
	}
	return item
}

// ListScenes handles GET /api/avatars/:id/scenes.
// @Summary  List scenes of an avatar (filtered by avatar, with videos)
// @Tags     scenes
// @Produce  json
// @Param    id path int true "Avatar ID"
// @Success  200 {object} map[string]any
// @Router   /avatars/{id}/scenes [get]
func (h *AvatarHandler) ListScenes(c *gin.Context) {
	avatarID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || avatarID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.avatar.invalid_id")})
		return
	}
	var scenes []models.Scene
	if err := h.db.Where("avatar_id = ?", avatarID).
		Order("is_default DESC, sort_order ASC, id ASC").Find(&scenes).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	items := make([]sceneItem, 0, len(scenes))
	for _, s := range scenes {
		items = append(items, h.toSceneItem(s))
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// CreateScene handles POST /api/avatars/:id/scenes.
// @Summary  Create a scene for an avatar (cover defaults to the avatar image)
// @Tags     scenes
// @Accept   multipart/form-data
// @Produce  json
// @Param    id path int true "Avatar ID"
// @Param    title formData string true "Scene title"
// @Param    description formData string false "Scene description"
// @Param    cover formData file false "Cover image (defaults to avatar image)"
// @Success  201 {object} sceneItem
// @Router   /avatars/{id}/scenes [post]
func (h *AvatarHandler) CreateScene(c *gin.Context) {
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
	title := strings.TrimSpace(c.PostForm("title"))
	if title == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.scene.title_required")})
		return
	}
	coverKey := avatar.ImageS3Key
	if header, err := c.FormFile("cover"); err == nil {
		key, upErr := h.uploadFormFile(c, header, "scene_covers")
		if upErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": i18n.Tcf(c, "err.avatar.upload_failed", upErr.Error())})
			return
		}
		coverKey = key
	}
	scene := models.Scene{
		AvatarID:    avatar.ID,
		Title:       title,
		Description: strings.TrimSpace(c.PostForm("description")),
		CoverS3Key:  coverKey,
	}
	if err := h.db.Create(&scene).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, h.toSceneItem(scene))
}

// UpdateScene handles PUT /api/scenes/:id.
// @Summary  Edit scene title/description/cover
// @Tags     scenes
// @Accept   multipart/form-data
// @Produce  json
// @Param    id path int true "Scene ID"
// @Success  200 {object} sceneItem
// @Router   /scenes/{id} [put]
func (h *AvatarHandler) UpdateScene(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.avatar.invalid_id")})
		return
	}
	var scene models.Scene
	if err := h.db.First(&scene, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": i18n.Tc(c, "err.scene.not_found")})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	if t := strings.TrimSpace(c.PostForm("title")); t != "" {
		scene.Title = t
	}
	if d, ok := c.GetPostForm("description"); ok {
		scene.Description = strings.TrimSpace(d)
	}
	if header, err := c.FormFile("cover"); err == nil {
		key, upErr := h.uploadFormFile(c, header, "scene_covers")
		if upErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": i18n.Tcf(c, "err.avatar.upload_failed", upErr.Error())})
			return
		}
		scene.CoverS3Key = key
	}
	if err := h.db.Save(&scene).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, h.toSceneItem(scene))
}

// DeleteScene handles DELETE /api/scenes/:id (default scene is protected).
// @Summary  Delete a scene (cascades videos; default scene is protected)
// @Tags     scenes
// @Produce  json
// @Param    id path int true "Scene ID"
// @Success  200 {object} map[string]any
// @Router   /scenes/{id} [delete]
func (h *AvatarHandler) DeleteScene(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.avatar.invalid_id")})
		return
	}
	var scene models.Scene
	if err := h.db.First(&scene, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": i18n.Tc(c, "err.scene.not_found")})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	if scene.IsDefault {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.scene.default_protected")})
		return
	}
	var videos []models.SceneVideo
	if err := h.db.Where("scene_id = ?", scene.ID).Find(&videos).Error; err == nil {
		for _, v := range videos {
			_ = h.s3.Delete(c.Request.Context(), v.S3Key)
		}
	}
	_ = h.db.Where("scene_id = ?", scene.ID).Delete(&models.SceneVideo{}).Error
	if scene.CoverS3Key != "" {
		var avatar models.Avatar
		if err := h.db.First(&avatar, scene.AvatarID).Error; err != nil || scene.CoverS3Key != avatar.ImageS3Key {
			_ = h.s3.Delete(c.Request.Context(), scene.CoverS3Key)
		}
	}
	if err := h.db.Delete(&scene).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": scene.ID})
}

// UploadSceneVideo handles POST /api/scenes/:id/videos.
// @Summary  Upload a driving video into a scene
// @Tags     scenes
// @Accept   multipart/form-data
// @Produce  json
// @Param    id path int true "Scene ID"
// @Param    description formData string false "Video description (e.g. 趴着/雨伞下)"
// @Param    file formData file true "Video file"
// @Success  201 {object} sceneVideoItem
// @Router   /scenes/{id}/videos [post]
func (h *AvatarHandler) UploadSceneVideo(c *gin.Context) {
	sceneID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || sceneID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.avatar.invalid_id")})
		return
	}
	var scene models.Scene
	if err := h.db.First(&scene, sceneID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": i18n.Tc(c, "err.scene.not_found")})
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
	key, err := h.uploadFormFile(c, header, "scene_videos")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": i18n.Tcf(c, "err.avatar.upload_failed", err.Error())})
		return
	}
	desc := strings.TrimSpace(c.PostForm("description"))
	video := models.SceneVideo{
		SceneID:     scene.ID,
		AvatarID:    scene.AvatarID,
		S3Key:       key,
		Description: desc,
	}
	if err := h.db.Create(&video).Error; err != nil {
		_ = h.s3.Delete(c.Request.Context(), key)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, sceneVideoItem{
		ID:          video.ID,
		SceneID:     video.SceneID,
		S3Key:       video.S3Key,
		S3URL:       h.s3.PublicURL(video.S3Key),
		Description: video.Description,
		IsDefault:   video.IsDefault,
	})
}

// DeleteSceneVideo handles DELETE /api/scenes/:id/videos/:vid (default video
// of the default scene is protected).
// @Summary  Delete a scene video
// @Tags     scenes
// @Produce  json
// @Param    id path int true "Scene ID"
// @Param    vid path int true "Video ID"
// @Success  200 {object} map[string]any
// @Router   /scenes/{id}/videos/{vid} [delete]
func (h *AvatarHandler) DeleteSceneVideo(c *gin.Context) {
	sceneID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || sceneID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.avatar.invalid_id")})
		return
	}
	videoID, err := strconv.ParseUint(c.Param("vid"), 10, 64)
	if err != nil || videoID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.avatar.invalid_id")})
		return
	}
	var video models.SceneVideo
	if err := h.db.Where("id = ? AND scene_id = ?", videoID, sceneID).First(&video).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": i18n.Tc(c, "err.avatar.video_not_found")})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	if video.IsDefault {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.scene.default_video_protected")})
		return
	}
	if err := h.db.Delete(&video).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	_ = h.s3.Delete(c.Request.Context(), video.S3Key)
	c.JSON(http.StatusOK, gin.H{"deleted": video.ID})
}
