package pathsafe

import (
	"path/filepath"
	"testing"
)

func TestJoinContains(t *testing.T) {
	base := filepath.FromSlash("/data/encounty")
	got, err := Join(base, "templates", "abc", "0.png")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if want := filepath.FromSlash("/data/encounty/templates/abc/0.png"); got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestJoinRejectsTraversal(t *testing.T) {
	base := filepath.FromSlash("/data/encounty")
	cases := []string{
		"../../etc/passwd",
		"templates/../../../etc/passwd",
		"..",
		filepath.FromSlash("templates/../.."),
	}
	for _, c := range cases {
		if _, err := Join(base, c); err == nil {
			t.Errorf("Join(base, %q) = nil error, want escape error", c)
		}
	}
}
