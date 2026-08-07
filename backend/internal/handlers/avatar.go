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

	"talkingavatar/backend/internal/i18n"
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
	ID                uint                  `json:"id"`
	Name              string                `json:"name"`
	ImageS3Key        string                `json:"imageS3Key"`
	ImageS3URL        string                `json:"imageS3Url"`
	Category          string                `json:"category"`
	Persona           models.PersonaProfile `json:"persona"`
	VoiceID           string                `json:"voiceId"`
	Status            string                `json:"status"`
	InitQueuePos      *int                  `json:"initQueuePos,omitempty"`
	LiveSettings      models.LiveSettings   `json:"liveSettings"`
	DefaultVideoS3URL *string               `json:"defaultVideoS3Url,omitempty"`
	CreatedAt         time.Time             `json:"createdAt"`
}

func NewAvatarHandler(db *gorm.DB, s3 *storage.Client, q *queue.Queue, avatarInitQueueKey string) *AvatarHandler {
	return &AvatarHandler{db: db, s3: s3, q: q, avatarInitQueueKey: avatarInitQueueKey}
}

// personaFromForm reads the persona profile from multipart form fields and
// returns the JSON string stored on the avatar row.
func personaFromForm(c *gin.Context) (string, error) {
	p := models.PersonaProfile{
		Age:                optionalInt(c.PostForm("age")),
		HeightCm:           optionalInt(c.PostForm("height_cm")),
		WeightKg:           optionalInt(c.PostForm("weight_kg")),
		Ethnicity:          strings.TrimSpace(c.PostForm("ethnicity")),
		RelationshipStatus: strings.TrimSpace(c.PostForm("relationship_status")),
		Personality:        strings.TrimSpace(c.PostForm("personality")),
	}
	b, err := json.Marshal(p)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func parsePersona(raw string) models.PersonaProfile {
	var p models.PersonaProfile
	if raw == "" {
		return p
	}
	_ = json.Unmarshal([]byte(raw), &p)
	return p
}

// defaultSceneVideo returns the avatar's default scene + its default video
// (the live/broadcast fallback), or nil when not ready yet.
func (h *AvatarHandler) defaultSceneVideo(avatarID uint) (*models.SceneVideo, error) {
	var scene models.Scene
	if err := h.db.Where("avatar_id = ? AND is_default = ?", avatarID, true).
		First(&scene).Error; err != nil {
		return nil, err
	}
	var video models.SceneVideo
	if err := h.db.Where("scene_id = ? AND is_default = ?", scene.ID, true).
		First(&video).Error; err != nil {
		return nil, err
	}
	return &video, nil
}

// Create handles POST /api/avatars. It accepts multipart/form-data with
// `name`, `image` (required) and `voice_id` (optional) fields, uploads the
// image to S3, stores the record as `initializing` and enqueues the
// LivePortrait base-video pre-processing job.
// Create handles POST /api/avatars.
// @Summary  Create an avatar (multipart: name + image + optional persona fields)
// @Tags     avatars
// @Accept   multipart/form-data
// @Produce  json
// @Param    name formData string true "Avatar name"
// @Param    image formData file true "Appearance image"
// @Param    voice_id formData string false "Edge-TTS voice id"
// @Param    category formData string false "Category (闲聊/知识/娱乐/游戏/带货/其他)"
// @Param    age formData int false "Age"
// @Param    height_cm formData int false "Height in cm"
// @Param    weight_kg formData int false "Weight in kg"
// @Param    ethnicity formData string false "Ethnicity"
// @Param    relationship_status formData string false "Relationship status"
// @Param    personality formData string false "Personality"
// @Success  201 {object} avatarResponse
// @Failure  400 {object} map[string]any
// @Router   /avatars [post]
func (h *AvatarHandler) Create(c *gin.Context) {
	name := strings.TrimSpace(c.PostForm("name"))
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.avatar.name_required")})
		return
	}
	voiceID := strings.TrimSpace(c.PostForm("voice_id"))
	if voiceID == "" {
		voiceID = models.DefaultEdgeVoice
	}
	category := normalizeCategory(c.PostForm("category"))
	persona, err := personaFromForm(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	imageHeader, err := c.FormFile("image")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.avatar.image_required")})
		return
	}

	imageKey, err := h.uploadFormFile(c, imageHeader, "avatars")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": i18n.Tcf(c, "err.avatar.upload_failed", err.Error())})
		return
	}

	avatar := models.Avatar{
		Name:       name,
		ImageS3Key: imageKey,
		Category:   category,
		Persona:    persona,
		VoiceID:    voiceID,
		Status:     models.AvatarStatusInitializing,
	}
	if err := h.db.Create(&avatar).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": i18n.Tcf(c, "err.avatar.save_failed", err.Error())})
		return
	}

	// Notify the worker to pre-process the image into a silent base driving
	// video (LivePortrait) and write the S3 key back via the webhook below.
	init := queue.AvatarInitPayload{
		AvatarID:   avatar.ID,
		ImageS3Key: imageKey,
	}
	if err := h.q.PushTo(c.Request.Context(), h.avatarInitQueueKey, init); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": i18n.Tcf(c, "err.avatar.init_enqueue_failed", err.Error())})
		return
	}

	c.JSON(http.StatusCreated, toAvatarResponse(h.db, avatar, h.s3))
}

// Get handles GET /api/avatars/:id so the frontend can poll the avatar's
// initialization status until it becomes "ready".
// Get handles GET /api/avatars/:id.
// @Summary  Get a single avatar (includes liveSettings)
// @Tags     avatars
// @Produce  json
// @Param    id path int true "Avatar ID"
// @Success  200 {object} avatarResponse
// @Failure  404 {object} map[string]any
// @Router   /avatars/{id} [get]
func (h *AvatarHandler) Get(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.avatar.invalid_id")})
		return
	}
	var avatar models.Avatar
	if err := h.db.First(&avatar, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": i18n.Tc(c, "err.avatar.not_found")})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, toAvatarResponse(h.db, avatar, h.s3))
}

type updateAvatarRequest struct {
	Name     string                `json:"name"`
	Category string                `json:"category"`
	VoiceID  string                `json:"voiceId"`
	Persona  models.PersonaProfile `json:"persona"`
}

// Update handles PUT /api/avatars/:id — edits an existing avatar's metadata
// (name / category / voice / persona profile). The image and base video stay
// untouched; regenerate them separately via the retry endpoint.
// Update handles PUT /api/avatars/:id.
// @Summary  Edit an avatar (name/category/voice/persona profile)
// @Tags     avatars
// @Accept   multipart/form-data
// @Produce  json
// @Param    id path int true "Avatar ID"
// @Success  200 {object} avatarResponse
// @Router   /avatars/{id} [put]
func (h *AvatarHandler) Update(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.avatar.invalid_id")})
		return
	}
	var avatar models.Avatar
	if err := h.db.First(&avatar, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": i18n.Tc(c, "err.avatar.not_found")})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	var req updateAvatarRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tcf(c, "err.invalid_request_detail", err.Error())})
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.avatar.name_required")})
		return
	}
	voiceID := strings.TrimSpace(req.VoiceID)
	if voiceID == "" {
		voiceID = models.DefaultEdgeVoice
	}

	avatar.Name = name
	avatar.Category = normalizeCategory(req.Category)
	avatar.VoiceID = voiceID
	if b, err := json.Marshal(req.Persona); err == nil {
		avatar.Persona = string(b)
	}
	if err := h.db.Save(&avatar).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, toAvatarResponse(h.db, avatar, h.s3))
}

// UpdateBaseVideo handles POST /api/avatars/:id/base-video — an internal
// webhook used by the worker to persist the pre-processed base video S3 key.
// @Summary  Worker webhook: persist base video + status
// @Tags     worker
// @Accept   json
// @Produce  json
// @Param    id path int true "Avatar ID"
// @Param    request body map[string]any true "videoS3Key + status"
// @Success  200 {object} avatarResponse
// @Router   /avatars/{id}/default-video [post]
func (h *AvatarHandler) UpdateDefaultVideo(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.avatar.invalid_id")})
		return
	}
	var req struct {
		VideoS3Key string `json:"videoS3Key"`
		Status     string `json:"status"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.VideoS3Key) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.avatar.base_video_key_required")})
		return
	}
	status := strings.TrimSpace(req.Status)
	if status == "" {
		status = models.AvatarStatusReady
	}
	if status != models.AvatarStatusReady && status != models.AvatarStatusFailed {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.task.invalid_status")})
		return
	}

	var avatar models.Avatar
	if err := h.db.First(&avatar, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": i18n.Tc(c, "err.avatar.not_found")})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	key := strings.TrimSpace(req.VideoS3Key)

	// Upsert the default scene and its default video.
	var scene models.Scene
	if err := h.db.Where("avatar_id = ? AND is_default = ?", avatar.ID, true).
		First(&scene).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			scene = models.Scene{
				AvatarID:   avatar.ID,
				Title:      "默认场景",
				CoverS3Key: avatar.ImageS3Key,
				IsDefault:  true,
			}
			if err := h.db.Create(&scene).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}
	var video models.SceneVideo
	if err := h.db.Where("scene_id = ? AND is_default = ?", scene.ID, true).
		First(&video).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			video = models.SceneVideo{
				SceneID:     scene.ID,
				AvatarID:    avatar.ID,
				S3Key:       key,
				Description: "默认",
				IsDefault:   true,
			}
			if err := h.db.Create(&video).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	} else {
		video.S3Key = key
		if err := h.db.Save(&video).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	avatar.Status = status
	if err := h.db.Save(&avatar).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, toAvatarResponse(h.db, avatar, h.s3))
}

// List handles GET /api/avatars and returns all avatars (newest first) so the
// frontend can pick an existing material set.
// List handles GET /api/avatars.
// @Summary  List all avatars
// @Tags     avatars
// @Produce  json
// @Success  200 {object} map[string]any
// @Router   /avatars [get]
func (h *AvatarHandler) List(c *gin.Context) {
	var avatars []models.Avatar
	if err := h.db.Order("created_at DESC").Find(&avatars).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	queuePos := h.initQueuePositions(c)
	resp := make([]avatarResponse, 0, len(avatars))
	for _, a := range avatars {
		r := toAvatarResponse(h.db, a, h.s3)
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
// Delete handles DELETE /api/avatars/:id.
// @Summary  Delete an avatar (cascades tasks/sessions/files)
// @Tags     avatars
// @Produce  json
// @Param    id path int true "Avatar ID"
// @Success  200 {object} map[string]any
// @Router   /avatars/{id} [delete]
func (h *AvatarHandler) Delete(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.avatar.invalid_id")})
		return
	}
	var avatar models.Avatar
	if err := h.db.First(&avatar, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": i18n.Tc(c, "err.avatar.not_found")})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	ctx := c.Request.Context()
	// Best-effort cleanup: S3 objects, pending init payload, live queue.
	_ = h.s3.Delete(ctx, avatar.ImageS3Key)
	var scenes []models.Scene
	if err := h.db.Where("avatar_id = ?", avatar.ID).Find(&scenes).Error; err == nil {
		for _, s := range scenes {
			var vids []models.SceneVideo
			if err := h.db.Where("scene_id = ?", s.ID).Find(&vids).Error; err == nil {
				for _, v := range vids {
					_ = h.s3.Delete(ctx, v.S3Key)
				}
			}
			_ = h.db.Where("scene_id = ?", s.ID).Delete(&models.SceneVideo{}).Error
			if s.CoverS3Key != "" && s.CoverS3Key != avatar.ImageS3Key {
				_ = h.s3.Delete(ctx, s.CoverS3Key)
			}
		}
	}
	_ = h.db.Where("avatar_id = ?", avatar.ID).Delete(&models.Scene{}).Error
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
		c.JSON(http.StatusInternalServerError, gin.H{"error": i18n.Tcf(c, "err.avatar.delete_tasks_failed", err.Error())})
		return
	}
	if err := h.db.Where("avatar_id = ?", avatar.ID).Delete(&models.LiveSession{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": i18n.Tcf(c, "err.avatar.delete_session_failed", err.Error())})
		return
	}
	// Clean N:N knowledge bindings (avatar_knowledge) left behind by the avatar.
	_ = h.db.Where("avatar_id = ?", avatar.ID).Delete(&models.AvatarKnowledge{}).Error

	if err := h.db.Delete(&avatar).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": avatar.ID})
}

// Retry handles POST /api/avatars/:id/retry — re-queues the LivePortrait
// base-video pre-processing for failed/skipped avatars.
// Retry handles POST /api/avatars/:id/retry.
// @Summary  Regenerate the base driving video
// @Tags     avatars
// @Produce  json
// @Param    id path int true "Avatar ID"
// @Success  200 {object} map[string]any
// @Router   /avatars/{id}/retry [post]
func (h *AvatarHandler) Retry(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.avatar.invalid_id")})
		return
	}
	var avatar models.Avatar
	if err := h.db.First(&avatar, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": i18n.Tc(c, "err.avatar.not_found")})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	if avatar.Status == models.AvatarStatusInitializing {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.avatar.already_initializing")})
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
		c.JSON(http.StatusInternalServerError, gin.H{"error": i18n.Tcf(c, "err.task.enqueue_retry_failed", err.Error())})
		return
	}
	c.JSON(http.StatusOK, toAvatarResponse(h.db, avatar, h.s3))
}

// Skip handles POST /api/avatars/:id/skip — marks an initializing avatar as
// skipped (abandons base-video generation for it).
// Skip handles POST /api/avatars/:id/skip.
// @Summary  Skip base-video generation for an avatar
// @Tags     avatars
// @Produce  json
// @Param    id path int true "Avatar ID"
// @Success  200 {object} map[string]any
// @Router   /avatars/{id}/skip [post]
func (h *AvatarHandler) Skip(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.avatar.invalid_id")})
		return
	}
	var avatar models.Avatar
	if err := h.db.First(&avatar, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": i18n.Tc(c, "err.avatar.not_found")})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	if avatar.Status != models.AvatarStatusInitializing {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.avatar.only_initializing_skip")})
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
	c.JSON(http.StatusOK, toAvatarResponse(h.db, avatar, h.s3))
}

// UpdateLiveSettings handles PUT /api/avatars/:id/live-settings — persists
// the avatar's live-streaming configuration (subtitle on/off, font, position,
// border, size) as a JSON string on the avatar row.
// UpdateLiveSettings handles PUT /api/avatars/:id/live-settings.
// @Summary  Save live settings (subtitles etc., JSON)
// @Tags     avatars
// @Accept   json
// @Produce  json
// @Param    id path int true "Avatar ID"
// @Param    request body models.LiveSettings true "live settings"
// @Success  200 {object} avatarResponse
// @Router   /avatars/{id}/live-settings [put]
func (h *AvatarHandler) UpdateLiveSettings(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.avatar.invalid_id")})
		return
	}
	var avatar models.Avatar
	if err := h.db.First(&avatar, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": i18n.Tc(c, "err.avatar.not_found")})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	var settings models.LiveSettings
	if err := c.ShouldBindJSON(&settings); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tcf(c, "err.avatar.invalid_live_settings", err.Error())})
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
	c.JSON(http.StatusOK, toAvatarResponse(h.db, avatar, h.s3))
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

func toAvatarResponse(db *gorm.DB, a models.Avatar, s3 *storage.Client) avatarResponse {
	liveSettings := parseLiveSettings(a.LiveSettings)
	resp := avatarResponse{
		ID:           a.ID,
		Name:         a.Name,
		ImageS3Key:   a.ImageS3Key,
		ImageS3URL:   s3.PublicURL(a.ImageS3Key),
		Category:     normalizeCategory(a.Category),
		Persona:      parsePersona(a.Persona),
		VoiceID:      a.VoiceID,
		Status:       a.Status,
		LiveSettings: liveSettings,
		CreatedAt:    a.CreatedAt,
	}
	var scene models.Scene
	if err := db.Where("avatar_id = ? AND is_default = ?", a.ID, true).
		First(&scene).Error; err == nil {
		var video models.SceneVideo
		if err := db.Where("scene_id = ? AND is_default = ?", scene.ID, true).
			First(&video).Error; err == nil {
			if url := s3.PublicURL(video.S3Key); url != "" {
				resp.DefaultVideoS3URL = &url
			}
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
