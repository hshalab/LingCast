package models

import "time"

const (
	AvatarStatusInitializing = "initializing"
	AvatarStatusReady        = "ready"
	AvatarStatusFailed       = "failed"
	AvatarStatusSkipped      = "skipped"
)

const DefaultEdgeVoice = "zh-CN-XiaoxiaoNeural"

// Scene video sources / generation states.
const (
	SceneVideoSourceUpload      = "upload"
	SceneVideoSourceLivePortrait = "liveportrait"
	SceneVideoStatusGenerating = "generating"
	SceneVideoStatusReady      = "ready"
	SceneVideoStatusFailed     = "failed"
)

type LiveSettings struct {
	SubtitleEnabled  bool   `json:"subtitleEnabled"`
	SubtitleFont     string `json:"subtitleFont"`
	SubtitlePosition string `json:"subtitlePosition"`
	SubtitleBorder   int    `json:"subtitleBorder"`
	SubtitleSize     int    `json:"subtitleSize"`
	IdleSceneID uint `json:"idleSceneId,omitempty"`
	IdleSwitchMode    string `json:"idleSwitchMode,omitempty"`
	IdleSwitchSeconds int    `json:"idleSwitchSeconds,omitempty"`
}

func DefaultLiveSettings() LiveSettings {
	return LiveSettings{
		SubtitleEnabled:   true,
		SubtitlePosition:  "bottom",
		SubtitleBorder:    2,
		SubtitleSize:      46,
		IdleSwitchMode:    "interval",
		IdleSwitchSeconds: 15,
	}
}

// LivePortraitSettings mirrors the LivePortrait inference/crop/output knobs
// (plus project-specific base-video options). It is stored per-avatar as a
// JSON text column and shipped to the worker inside the avatar_init payload,
// so tuning no longer depends on worker environment variables.
type LivePortraitSettings struct {
	// Motion / inference (LivePortrait argument_config / inference_config)
	DrivingSpeed      float64 `json:"drivingSpeed"`      // temporal playback speed (project knob, 1.0 = original)
	DrivingMultiplier float64 `json:"drivingMultiplier"` // motion amplitude, 1.0 = original
	DrivingOption     string  `json:"drivingOption"`     // "expression-friendly" | "pose-friendly"
	AnimationRegion   string  `json:"animationRegion"`   // "all" | "exp" | "pose" | "lip" | "eyes"
	UseHalfPrecision  bool    `json:"useHalfPrecision"`  // flag_use_half_precision (FP16)

	FlagCropDrivingVideo          bool `json:"flagCropDrivingVideo"`
	FlagNormalizeLip              bool `json:"flagNormalizeLip"`
	FlagEyeRetargeting            bool `json:"flagEyeRetargeting"`
	FlagLipRetargeting            bool `json:"flagLipRetargeting"`
	FlagSourceVideoEyeRetargeting bool `json:"flagSourceVideoEyeRetargeting"`
	FlagStitching                 bool `json:"flagStitching"`
	FlagRelativeMotion            bool `json:"flagRelativeMotion"`
	FlagPasteback                 bool `json:"flagPasteback"`
	FlagDoCrop                    bool `json:"flagDoCrop"`
	FlagDoRot                     bool `json:"flagDoRot"`

	DrivingSmoothObservationVariance float64 `json:"drivingSmoothObservationVariance"`

	// Source crop
	DetThresh     float64 `json:"detThresh"`
	Scale         float64 `json:"scale"`
	VxRatio       float64 `json:"vxRatio"`
	VyRatio       float64 `json:"vyRatio"`
	SourceMaxDim  int     `json:"sourceMaxDim"`
	SourceDivision int    `json:"sourceDivision"`

	// Driving crop (only for driving-video inputs)
	ScaleCropDrivingVideo  float64 `json:"scaleCropDrivingVideo"`
	VxRatioCropDrivingVideo float64 `json:"vxRatioCropDrivingVideo"`
	VyRatioCropDrivingVideo float64 `json:"vyRatioCropDrivingVideo"`

	// Output
	OutputFPS    int    `json:"outputFps"`
	CRF          int    `json:"crf"`
	OutputFormat string `json:"outputFormat"` // "mp4" | "gif"

	// Project-specific base-video knobs
	BaseSeconds     float64 `json:"baseSeconds"`
	OutputWidth     int     `json:"outputWidth"`
	OutputHeight    int     `json:"outputHeight"`
	DrivingTemplate string  `json:"drivingTemplate"` // .pkl filename under LivePortrait assets/examples/driving
}

// DefaultLivePortraitSettings returns the current effective defaults (they
// match what the worker used before settings became per-avatar business data).
func DefaultLivePortraitSettings() LivePortraitSettings {
	return LivePortraitSettings{
		DrivingSpeed:      1.0,
		DrivingMultiplier: 1.0,
		DrivingOption:     "expression-friendly",
		AnimationRegion:   "all",
		UseHalfPrecision:  true,

		FlagStitching:        true,
		FlagRelativeMotion:   true,
		FlagPasteback:        true,
		FlagDoCrop:           true,
		FlagDoRot:            true,

		DrivingSmoothObservationVariance: 3e-7,

		DetThresh:     0.15,
		Scale:         2.3,
		VxRatio:       0,
		VyRatio:       -0.125,
		SourceMaxDim:  1280,
		SourceDivision: 2,

		ScaleCropDrivingVideo:  2.2,
		VxRatioCropDrivingVideo: 0,
		VyRatioCropDrivingVideo: -0.1,

		OutputFPS:    24,
		CRF:          15,
		OutputFormat: "mp4",

		BaseSeconds:     4,
		OutputWidth:     720,
		OutputHeight:    1280,
		DrivingTemplate: "d1.pkl",
	}
}

type PersonaProfile struct {
	Age                *int   `json:"age,omitempty"`
	HeightCm           *int   `json:"heightCm,omitempty"`
	WeightKg           *int   `json:"weightKg,omitempty"`
	Ethnicity          string `json:"ethnicity,omitempty"`
	RelationshipStatus string `json:"relationshipStatus,omitempty"`
	Personality        string `json:"personality,omitempty"`
}

type Avatar struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	Name         string    `gorm:"size:255;not null" json:"name"`
	ImageS3Key   string    `gorm:"size:512;not null" json:"imageS3Key"`
	Category     string    `gorm:"size:32;not null;default:其他" json:"category"`
	Persona      string    `gorm:"type:text;not null;default:'{}'" json:"-"`
	VoiceID      string    `gorm:"size:64;not null;default:zh-CN-XiaoxiaoNeural" json:"voiceId"`
	Status       string    `gorm:"size:32;not null;default:initializing;index" json:"status"`
	LiveSettings string    `gorm:"type:text;not null;default:'{}'" json:"-"`
	CreatedAt    time.Time `json:"createdAt"`
}

type Scene struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	AvatarID    uint      `gorm:"not null;index" json:"avatarId"`
	Title       string    `gorm:"size:128;not null" json:"title"`
	Description string    `gorm:"size:512" json:"description,omitempty"`
	CoverS3Key  string    `gorm:"size:512" json:"coverS3Key"`
	IsDefault   bool      `gorm:"not null;default:false" json:"isDefault"`
	SortOrder   int       `gorm:"not null;default:0" json:"sortOrder"`
	CreatedAt   time.Time `json:"createdAt"`
}

type SceneVideo struct {
	ID                  uint      `gorm:"primaryKey" json:"id"`
	SceneID             uint      `gorm:"not null;index" json:"sceneId"`
	AvatarID            uint      `gorm:"not null;index" json:"avatarId"`
	S3Key               string    `gorm:"size:512;not null" json:"s3Key"`
	Description         string    `gorm:"size:255" json:"description,omitempty"`
	IsDefault           bool      `gorm:"not null;default:false" json:"isDefault"`
	Source              string    `gorm:"size:32;not null;default:upload" json:"source"`
	SourceImageS3Key    string    `gorm:"size:512" json:"sourceImageS3Key,omitempty"`
	GenerationSettings  string    `gorm:"type:text;not null;default:'{}'" json:"-"`
	Status              string    `gorm:"size:32;not null;default:ready" json:"status"`
	ErrorMessage        string    `gorm:"size:512" json:"errorMessage,omitempty"`
	Progress            int       `gorm:"not null;default:0" json:"progress"`
	Stage               string    `gorm:"size:32;not null;default:''" json:"stage,omitempty"`
	StageDetail         string    `gorm:"size:255;not null;default:''" json:"stageDetail,omitempty"`
	CreatedAt           time.Time `json:"createdAt"`
}
