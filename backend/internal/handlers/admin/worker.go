package admin

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

const (
	workerCapabilityKey = "worker:capability"
	workerCapabilityTTL = 24 * time.Hour
)

type workerCapability struct {
	Device string `json:"device"`
	CPUs   int    `json:"cpus,omitempty"`
}

// ReportWorkerCapability handles POST /api/worker/capability — the native AI
// worker reports its inference device once at startup, so the admin console
// can pick a hardware-appropriate default driving template.
func ReportWorkerCapability(rc *redis.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		var rep workerCapability
		if err := c.ShouldBindJSON(&rep); err != nil || strings.TrimSpace(rep.Device) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "device is required"})
			return
		}
		rep.Device = strings.ToLower(strings.TrimSpace(rep.Device))
		data, err := json.Marshal(rep)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if err := rc.Set(c.Request.Context(), workerCapabilityKey, data, workerCapabilityTTL).Err(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "device": rep.Device})
	}
}

// AvatarDefaults handles GET /api/avatar-defaults — returns the driving
// template recommended for the last reported worker device (falls back to a
// balanced default when the worker has not reported yet).
func AvatarDefaults(rc *redis.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		device := ""
		raw, err := rc.Get(c.Request.Context(), workerCapabilityKey).Result()
		if err == nil {
			var rep workerCapability
			if json.Unmarshal([]byte(raw), &rep) == nil {
				device = rep.Device
			}
		}
		c.JSON(http.StatusOK, gin.H{
			"device":          device,
			"drivingTemplate": recommendDrivingTemplate(device),
		})
	}
}

// recommendDrivingTemplate maps worker inference hardware to a driving
// template: fast desktop GPUs get the longest natural template, Apple Silicon
// gets a balanced one, CPU keeps the render short.
func recommendDrivingTemplate(device string) string {
	switch strings.ToLower(device) {
	case "cuda", "rocm":
		return "d8.pkl"
	case "mps":
		return "d5.pkl"
	case "cpu":
		return "d1.pkl"
	default:
		return "d5.pkl"
	}
}
