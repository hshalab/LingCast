package handlers

import (
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
	"talkingavatar/backend/internal/storage"
)

// TaskHandler serves broadcast task creation, polling and worker callbacks.
type TaskHandler struct {
	db *gorm.DB
	q  *queue.Queue
	s3 *storage.Client
}

type createTaskRequest struct {
	AvatarID   uint   `json:"avatarId"`
	ScriptText string `json:"scriptText"`
}

type updateTaskStatusRequest struct {
	Status           string  `json:"status"`
	OutputVideoS3URL *string `json:"outputVideoS3Url"`
	Error            string  `json:"error"`
}

type taskResponse struct {
	ID               uint      `json:"id"`
	AvatarID         uint      `json:"avatarId"`
	AvatarName       string    `json:"avatarName,omitempty"`
	ScriptText       string    `json:"scriptText"`
	Status           string    `json:"status"`
	OutputVideoS3URL *string   `json:"outputVideoS3Url,omitempty"`
	ErrorMessage     *string   `json:"errorMessage,omitempty"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

func NewTaskHandler(db *gorm.DB, q *queue.Queue, s3 *storage.Client) *TaskHandler {
	return &TaskHandler{db: db, q: q, s3: s3}
}

// Create handles POST /api/tasks. It persists the task, pushes a JSON payload
// (including S3 keys) to Redis and returns the task for polling.
// Create handles POST /api/tasks.
// @Summary  Create a broadcast (offline video) task
// @Tags     tasks
// @Accept   json
// @Produce  json
// @Param    request body map[string]any true "avatarId + scriptText"
// @Success  201 {object} taskResponse
// @Failure  400 {object} map[string]any
// @Router   /tasks [post]
func (h *TaskHandler) Create(c *gin.Context) {
	var req createTaskRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tcf(c, "err.invalid_request_body", err.Error())})
		return
	}
	if req.AvatarID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.task.avatar_id_required")})
		return
	}
	if strings.TrimSpace(req.ScriptText) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.task.script_text_required")})
		return
	}

	var avatar models.Avatar
	if err := h.db.First(&avatar, req.AvatarID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": i18n.Tc(c, "err.task.avatar_not_found")})
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

	task := models.BroadcastTask{
		AvatarID:   req.AvatarID,
		ScriptText: strings.TrimSpace(req.ScriptText),
		Status:     models.TaskStatusPending,
	}
	if err := h.db.Create(&task).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": i18n.Tcf(c, "err.task.save_failed", err.Error())})
		return
	}

	payload := queue.TaskPayload{
		TaskID:     task.ID,
		AvatarID:   avatar.ID,
		ScriptText: task.ScriptText,
		ImageS3Key: avatar.ImageS3Key,
	}
	payload.BaseVideoS3Key = *avatar.BaseVideoS3Key
	payload.VoiceID = avatar.VoiceID

	if err := h.q.Push(c.Request.Context(), payload); err != nil {
		h.db.Model(&task).Update("status", models.TaskStatusFailed)
		c.JSON(http.StatusInternalServerError, gin.H{"error": i18n.Tcf(c, "err.task.enqueue_failed", err.Error())})
		return
	}

	c.JSON(http.StatusCreated, toTaskResponse(task))
}

// List handles GET /api/tasks — returns all broadcast tasks (newest first)
// with their avatar name, for the task-center UI.
// List handles GET /api/tasks.
// @Summary  List broadcast tasks (newest first)
// @Tags     tasks
// @Produce  json
// @Success  200 {object} map[string]any
// @Router   /tasks [get]
func (h *TaskHandler) List(c *gin.Context) {
	var tasks []models.BroadcastTask
	if err := h.db.Preload("Avatar").Order("created_at DESC").Find(&tasks).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	resp := make([]taskResponse, 0, len(tasks))
	for _, t := range tasks {
		item := toTaskResponse(t)
		item.AvatarName = t.Avatar.Name
		resp = append(resp, item)
	}
	c.JSON(http.StatusOK, gin.H{"data": resp})
}

// Delete handles DELETE /api/tasks/:id — removes the task record and its
// output video from S3 (best-effort).
// Delete handles DELETE /api/tasks/:id.
// @Summary  Delete a broadcast task
// @Tags     tasks
// @Produce  json
// @Param    id path int true "Task ID"
// @Success  200 {object} map[string]any
// @Router   /tasks/{id} [delete]
func (h *TaskHandler) Delete(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.task.invalid_id")})
		return
	}
	var task models.BroadcastTask
	if err := h.db.First(&task, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": i18n.Tc(c, "err.task.not_found")})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	if task.OutputVideoS3URL != nil {
		_ = h.s3.Delete(c.Request.Context(), *task.OutputVideoS3URL)
	}
	if err := h.db.Delete(&task).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": task.ID})
}

// Retry handles POST /api/tasks/:id/retry — re-queues a failed broadcast task.
// Retry handles POST /api/tasks/:id/retry.
// @Summary  Re-enqueue a failed task
// @Tags     tasks
// @Produce  json
// @Param    id path int true "Task ID"
// @Success  200 {object} taskResponse
// @Router   /tasks/{id}/retry [post]
func (h *TaskHandler) Retry(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.task.invalid_id")})
		return
	}
	var task models.BroadcastTask
	if err := h.db.First(&task, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": i18n.Tc(c, "err.task.not_found")})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	if task.Status != models.TaskStatusFailed {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.task.only_failed_retry")})
		return
	}
	var avatar models.Avatar
	if err := h.db.First(&avatar, task.AvatarID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.task.avatar_not_found")})
		return
	}
	if avatar.Status != models.AvatarStatusReady {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.task.avatar_not_ready")})
		return
	}

	task.Status = models.TaskStatusPending
	task.ErrorMessage = nil
	task.OutputVideoS3URL = nil
	if err := h.db.Save(&task).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	payload := queue.TaskPayload{
		TaskID:         task.ID,
		AvatarID:       avatar.ID,
		ScriptText:     task.ScriptText,
		ImageS3Key:     avatar.ImageS3Key,
		BaseVideoS3Key: *avatar.BaseVideoS3Key,
		VoiceID:        avatar.VoiceID,
	}
	if err := h.q.Push(c.Request.Context(), payload); err != nil {
		h.db.Model(&task).Update("status", models.TaskStatusFailed)
		c.JSON(http.StatusInternalServerError, gin.H{"error": i18n.Tcf(c, "err.task.enqueue_retry_failed", err.Error())})
		return
	}
	c.JSON(http.StatusOK, toTaskResponse(task))
}

// Get handles GET /api/tasks/:id, the endpoint the frontend polls.
// Get handles GET /api/tasks/:id.
// @Summary  Poll task status and output URL
// @Tags     tasks
// @Produce  json
// @Param    id path int true "Task ID"
// @Success  200 {object} taskResponse
// @Failure  404 {object} map[string]any
// @Router   /tasks/{id} [get]
func (h *TaskHandler) Get(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.task.invalid_id")})
		return
	}

	var task models.BroadcastTask
	if err := h.db.First(&task, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": i18n.Tc(c, "err.task.not_found")})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, toTaskResponse(task))
}

// UpdateStatus handles POST /api/tasks/:id/status, the webhook used by the
// Python AI worker to report progress/completion/failure.
// UpdateStatus handles POST /api/tasks/:id/status — the worker webhook.
// @Summary  Worker webhook: task status callback
// @Tags     worker
// @Accept   json
// @Produce  json
// @Param    id path int true "Task ID"
// @Param    request body map[string]any true "status + outputVideoS3Url + error"
// @Success  200 {object} map[string]any
// @Router   /tasks/{id}/status [post]
func (h *TaskHandler) UpdateStatus(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.task.invalid_id")})
		return
	}

	var req updateTaskStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tcf(c, "err.invalid_request_body", err.Error())})
		return
	}

	switch req.Status {
	case models.TaskStatusProcessing, models.TaskStatusCompleted, models.TaskStatusFailed:
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.task.invalid_status")})
		return
	}
	if req.Status == models.TaskStatusCompleted && (req.OutputVideoS3URL == nil || *req.OutputVideoS3URL == "") {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.Tc(c, "err.task.output_url_required")})
		return
	}

	var task models.BroadcastTask
	if err := h.db.First(&task, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": i18n.Tc(c, "err.task.not_found")})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	updates := map[string]any{"status": req.Status}
	if req.OutputVideoS3URL != nil && *req.OutputVideoS3URL != "" {
		updates["output_video_s3_url"] = *req.OutputVideoS3URL
	}
	if req.Error != "" {
		updates["error_message"] = req.Error
	}
	if err := h.db.Model(&task).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func toTaskResponse(t models.BroadcastTask) taskResponse {
	return taskResponse{
		ID:               t.ID,
		AvatarID:         t.AvatarID,
		ScriptText:       t.ScriptText,
		Status:           t.Status,
		OutputVideoS3URL: t.OutputVideoS3URL,
		ErrorMessage:     t.ErrorMessage,
		CreatedAt:        t.CreatedAt,
		UpdatedAt:        t.UpdatedAt,
	}
}
