package i18n

import "testing"

func TestDetect(t *testing.T) {
	cases := []struct {
		header string
		want   string
	}{
		{"", "zh"},
		{"zh-CN,zh;q=0.9", "zh"},
		{"en-US,en;q=0.9,zh;q=0.8", "en"},
		{"en", "en"},
		{"ja-JP", "zh"},
	}
	for _, c := range cases {
		if got := Detect(c.header); got != c.want {
			t.Fatalf("Detect(%q) = %q, want %q", c.header, got, c.want)
		}
	}
}

func TestT(t *testing.T) {
	if got := T("zh", "err.task.not_found"); got == "err.task.not_found" {
		t.Fatalf("zh catalog missing err.task.not_found")
	}
	if got := T("en", "err.task.not_found"); got != "task not found" {
		t.Fatalf("T(en, err.task.not_found) = %q", got)
	}
	// Unknown keys fall back to English, then the key itself.
	if got := T("zh", "err.unknown.key"); got != "err.unknown.key" {
		t.Fatalf("T(zh, unknown) = %q, want key passthrough", got)
	}
}
