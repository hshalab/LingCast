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
	prompt := chatSystemPrompt(a, "zh", nil, nil)
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
	prompt := chatSystemPrompt(models.Avatar{Name: "小美"}, "zh", nil, nil)
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
	prompt := chatSystemPrompt(a, "en", nil, nil)
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

func TestChatSystemPromptRAGAndMemory(t *testing.T) {
	a := models.Avatar{Name: "翠花"}
	memory := []models.ChatMessage{
		{Role: "user", Content: "你喜欢什么颜色？"},
		{Role: "bot", Content: "我喜欢紫色。"},
	}
	facts := []string{"本店商品满99元包邮，七天无理由退货。"}

	zh := chatSystemPrompt(a, "zh", memory, facts)
	for _, want := range []string{"私有知识库", "本店商品满99元包邮", "最近", "user: 你喜欢什么颜色？", "assistant: 我喜欢紫色。"} {
		if !strings.Contains(zh, want) {
			t.Fatalf("zh prompt missing %q:\n%s", want, zh)
		}
	}

	en := chatSystemPrompt(a, "en", memory, facts)
	for _, want := range []string{"private knowledge base", "本店商品满99元包邮", "Recent conversation", "assistant: 我喜欢紫色。"} {
		if !strings.Contains(en, want) {
			t.Fatalf("en prompt missing %q:\n%s", want, en)
		}
	}
}
