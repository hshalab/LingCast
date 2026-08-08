package admin

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"talkingavatar/backend/internal/i18n"
	"talkingavatar/backend/internal/models"
	"talkingavatar/backend/internal/queue"
)

// GenerateSceneVideo handles POST /api/scenes/:id/videos/generate — creates a
// scene video row in `generating` state and dispatches the job to the
// video-gen microservice (provider: liveportrait now, comfyui etc. later).
func (h *AvatarHandler) GenerateSceneVideo(c *gin.Context) {
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

	desc := strings.TrimSpace(c.PostForm("description"))
	if desc == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.scene.description_required")})
		return
	}
	provider := strings.TrimSpace(c.PostForm("provider"))
	if provider == "" {
		provider = models.SceneVideoSourceLivePortrait
	}
	if provider != models.SceneVideoSourceLivePortrait {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tcf(c, "err.video_gen.unsupported_provider", provider)})
		return
	}

	imageHeader, err := c.FormFile("image")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.video_gen.image_required")})
		return
	}
	sourceKey, err := h.uploadFormFile(c, imageHeader, "scene_sources")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": i18n.Tcf(c, "err.avatar.upload_failed", err.Error())})
		return
	}

	settingsRaw := strings.TrimSpace(c.PostForm("settings"))
	settingsData, err := marshalLivePortraitSettings(ParseLivePortraitSettings(settingsRaw))
	if err != nil {
		_ = h.s3.Delete(c.Request.Context(), sourceKey)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 场景还没有默认视频时，第一条自动成为默认视频。
	var defaultCount int64
	if err := h.db.Model(&models.SceneVideo{}).
		Where("scene_id = ? AND is_default = ?", scene.ID, true).
		Count(&defaultCount).Error; err != nil {
		_ = h.s3.Delete(c.Request.Context(), sourceKey)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	video := models.SceneVideo{
		SceneID:            scene.ID,
		AvatarID:           scene.AvatarID,
		Description:        desc,
		Source:             provider,
		SourceImageS3Key:   sourceKey,
		GenerationSettings: settingsData,
		Status:             models.SceneVideoStatusGenerating,
		IsDefault:          defaultCount == 0,
	}
	if err := h.db.Create(&video).Error; err != nil {
		_ = h.s3.Delete(c.Request.Context(), sourceKey)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if err := h.dispatchVideoGen(c, video, settingsData); err != nil {
		_ = h.db.Model(&models.SceneVideo{}).Where("id = ?", video.ID).Updates(map[string]any{
			"status":        models.SceneVideoStatusFailed,
			"error_message": err.Error(),
		}).Error
		c.JSON(http.StatusBadGateway, gin.H{"error": i18n.Tcf(c, "err.video_gen.dispatch_failed", err.Error())})
		return
	}
	c.JSON(http.StatusCreated, h.toSceneVideoItem(video))
}

// dispatchVideoGen pushes the generation job to the video-gen microservice,
// which owns the queue / provider registry.
func (h *AvatarHandler) dispatchVideoGen(c *gin.Context, video models.SceneVideo, settingsRaw string) error {
	payload := queue.VideoGenPayload{
		SceneVideoID:     video.ID,
		AvatarID:         video.AvatarID,
		SceneID:          video.SceneID,
		SourceImageS3Key: video.SourceImageS3Key,
		Provider:         video.Source,
		Settings:         json.RawMessage(settingsRaw),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	url := strings.TrimRight(h.videoGenServiceURL, "/") + "/v1/video-gen/jobs"
	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return errors.New("video-gen service returned HTTP " + strconv.Itoa(resp.StatusCode))
	}
	return nil
}

// CompleteSceneVideo handles POST /api/scene-videos/:id/complete — the worker
// webhook that persists the generated video (or failure) and refreshes the
// avatar's ready status.
func (h *AvatarHandler) CompleteSceneVideo(c *gin.Context) {
	videoID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || videoID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.avatar.invalid_id")})
		return
	}
	var video models.SceneVideo
	if err := h.db.First(&video, videoID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": i18n.Tc(c, "err.avatar.video_not_found")})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	var req struct {
		Status       string `json:"status"`
		S3Key        string `json:"s3Key"`
		ErrorMessage string `json:"errorMessage"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.invalid_request")})
		return
	}
	req.Status = strings.TrimSpace(req.Status)
	if req.Status != models.SceneVideoStatusReady && req.Status != models.SceneVideoStatusFailed {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.task.invalid_status")})
		return
	}
	video.Status = req.Status
	video.S3Key = strings.TrimSpace(req.S3Key)
	video.ErrorMessage = strings.TrimSpace(req.ErrorMessage)
	if req.Status == models.SceneVideoStatusReady {
		video.Progress = 100
		video.Stage = ""
		video.StageDetail = ""
	} else {
		video.Progress = 0
	}
	if err := h.db.Save(&video).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.recomputeAvatarStatus(video.AvatarID)
	c.JSON(http.StatusOK, h.toSceneVideoItem(video))
}

// UpdateSceneVideoProgress handles POST /api/scene-videos/:id/progress — the
// worker's fine-grained generation progress (stage + percent + detail) so the
// admin console can render a timeline while a video is generating.
func (h *AvatarHandler) UpdateSceneVideoProgress(c *gin.Context) {
	videoID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || videoID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.avatar.invalid_id")})
		return
	}
	var req struct {
		Stage    string `json:"stage"`
		Progress int    `json:"progress"`
		Detail   string `json:"detail"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.invalid_request")})
		return
	}
	if req.Progress < 0 || req.Progress > 100 {
		req.Progress = 0
	}
	if len(req.Stage) > 32 {
		req.Stage = req.Stage[:32]
	}
	if len(req.Detail) > 255 {
		req.Detail = req.Detail[:255]
	}
	if err := h.db.Model(&models.SceneVideo{}).Where("id = ?", videoID).Updates(map[string]any{
		"progress":     req.Progress,
		"stage":        strings.TrimSpace(req.Stage),
		"stage_detail": strings.TrimSpace(req.Detail),
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// recomputeAvatarStatus flips the avatar to ready iff it has at least one
// scene video in ready state (upload or generated), otherwise initializing.
func (h *AvatarHandler) recomputeAvatarStatus(avatarID uint) {
	var count int64
	if err := h.db.Model(&models.SceneVideo{}).
		Where("avatar_id = ? AND status = ?", avatarID, models.SceneVideoStatusReady).
		Count(&count).Error; err != nil {
		return
	}
	status := models.AvatarStatusInitializing
	if count > 0 {
		status = models.AvatarStatusReady
	}
	_ = h.db.Model(&models.Avatar{}).Where("id = ?", avatarID).Update("status", status)
}
