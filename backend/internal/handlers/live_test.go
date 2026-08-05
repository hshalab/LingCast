package handlers

import (
	"strings"
	"testing"

	"talkingavatar/backend/internal/models"
)

func TestChatSystemPromptIncludesProfile(t *testing.T) {
	age, height, weight := 25, 165, 50
	a := models.Avatar{
		Name:               "翠花",
		Age:                &age,
		HeightCm:           &height,
		WeightKg:           &weight,
		Ethnicity:          "汉族",
		RelationshipStatus: "单身",
		Personality:        "活泼开朗",
	}
	prompt := chatSystemPrompt(a, "zh")
	for _, want := range []string{
		"翠花",
		"年龄 25 岁",
		"身高 165 厘米",
		"体重 50 公斤",
		"族裔 汉族",
		"感情状态 单身",
		"性格 活泼开朗",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt missing %q:\n%s", want, prompt)
		}
	}
}

func TestChatSystemPromptEmptyProfile(t *testing.T) {
	prompt := chatSystemPrompt(models.Avatar{Name: "小美"}, "zh")
	if strings.Contains(prompt, "人物设定") {
		t.Fatalf("empty profile should not include a persona block:\n%s", prompt)
	}
}

func TestChatSystemPromptEnglish(t *testing.T) {
	age := 25
	a := models.Avatar{
		Name: "Xiaomei",
		Age:  &age,
	}
	prompt := chatSystemPrompt(a, "en")
	for _, want := range []string{
		"digital human streamer named \"Xiaomei\"",
		"Age 25",
		"conversational English",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("en prompt missing %q:\n%s", want, prompt)
		}
	}
}
