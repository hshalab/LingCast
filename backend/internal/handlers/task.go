package handlers

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"talkingavatar/backend/internal/models"
	"talkingavatar/backend/internal/queue"
)

// TaskHandler serves broadcast task creation, polling and worker callbacks.
type TaskHandler struct {
	db *gorm.DB
	q  *queue.Queue
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
	ScriptText       string    `json:"scriptText"`
	Status           string    `json:"status"`
	OutputVideoS3URL *string   `json:"outputVideoS3Url,omitempty"`
	ErrorMessage     *string   `json:"errorMessage,omitempty"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

func NewTaskHandler(db *gorm.DB, q *queue.Queue) *TaskHandler {
	return &TaskHandler{db: db, q: q}
}

// Create handles POST /api/tasks. It persists the task, pushes a JSON payload
// (including S3 keys) to Redis and returns the task for polling.
func (h *TaskHandler) Create(c *gin.Context) {
	var req createTaskRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body: " + err.Error()})
		return
	}
	if req.AvatarID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "field 'avatarId' is required"})
		return
	}
	if strings.TrimSpace(req.ScriptText) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "field 'scriptText' is required"})
		return
	}

	var avatar models.Avatar
	if err := h.db.First(&avatar, req.AvatarID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "avatar not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	task := models.BroadcastTask{
		AvatarID:   req.AvatarID,
		ScriptText: strings.TrimSpace(req.ScriptText),
		Status:     models.TaskStatusPending,
	}
	if err := h.db.Create(&task).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "save task failed: " + err.Error()})
		return
	}

	payload := queue.TaskPayload{
		TaskID:     task.ID,
		AvatarID:   avatar.ID,
		ScriptText: task.ScriptText,
		ImageS3Key: avatar.ImageS3Key,
	}
	if avatar.VoiceAudioS3Key != nil {
		payload.VoiceAudioS3Key = *avatar.VoiceAudioS3Key
	}

	if err := h.q.Push(c.Request.Context(), payload); err != nil {
		h.db.Model(&task).Update("status", models.TaskStatusFailed)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "enqueue task failed: " + err.Error()})
		return
	}

	c.JSON(http.StatusCreated, toTaskResponse(task))
}

// Get handles GET /api/tasks/:id, the endpoint the frontend polls.
func (h *TaskHandler) Get(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid task id"})
		return
	}

	var task models.BroadcastTask
	if err := h.db.First(&task, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, toTaskResponse(task))
}

// UpdateStatus handles POST /api/tasks/:id/status, the webhook used by the
// Python AI worker to report progress/completion/failure.
func (h *TaskHandler) UpdateStatus(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid task id"})
		return
	}

	var req updateTaskStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body: " + err.Error()})
		return
	}

	switch req.Status {
	case models.TaskStatusProcessing, models.TaskStatusCompleted, models.TaskStatusFailed:
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid status"})
		return
	}
	if req.Status == models.TaskStatusCompleted && (req.OutputVideoS3URL == nil || *req.OutputVideoS3URL == "") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "outputVideoS3Url is required when status is completed"})
		return
	}

	var task models.BroadcastTask
	if err := h.db.First(&task, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
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
