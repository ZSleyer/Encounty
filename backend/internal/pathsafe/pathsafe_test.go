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
		// Sibling directory sharing the base name as a string prefix.
		filepath.FromSlash("../encounty-evil/state.json"),
	}
	for _, c := range cases {
		if _, err := Join(base, c); err == nil {
			t.Errorf("Join(base, %q) = nil error, want escape error", c)
		}
	}
}

func TestJoinRejectsBaseItself(t *testing.T) {
	base := filepath.FromSlash("/data/encounty")
	for _, elems := range [][]string{nil, {""}, {"."}, {"templates", ".."}} {
		if got, err := Join(base, elems...); err == nil {
			t.Errorf("Join(base, %q) = %q, want error: base itself is not a valid target", elems, got)
		}
	}
}

func TestUnder(t *testing.T) {
	base := filepath.FromSlash("/home/user")
	cases := []struct {
		name string
		dir  string
		want string
		ok   bool
	}{
		{"descendant", filepath.FromSlash("/home/user/encounty"), filepath.FromSlash("/home/user/encounty"), true},
		{"deep descendant", filepath.FromSlash("/home/user/a/b/c"), filepath.FromSlash("/home/user/a/b/c"), true},
		{"base itself", filepath.FromSlash("/home/user"), base, true},
		{"base with a trailing separator", filepath.FromSlash("/home/user/"), base, true},
		{"traversal out of base", filepath.FromSlash("/home/user/../root"), "", false},
		{"sibling sharing the name prefix", filepath.FromSlash("/home/user2"), "", false},
		{"unrelated absolute path", filepath.FromSlash("/etc"), "", false},
		{"relative path", "encounty", "", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := Under(base, c.dir)
			if ok != c.ok {
				t.Fatalf("ok = %v, want %v", ok, c.ok)
			}
			if got != c.want {
				t.Errorf("got %q, want %q", got, c.want)
			}
		})
	}
}

func TestUnderAny(t *testing.T) {
	home := filepath.FromSlash("/home/user")
	config := filepath.FromSlash("/etc/xdg/encounty")

	if got, ok := UnderAny(filepath.FromSlash("/etc/xdg/encounty/db"), home, config); !ok || got != filepath.FromSlash("/etc/xdg/encounty/db") {
		t.Errorf("second root did not match: got %q, ok %v", got, ok)
	}
	if _, ok := UnderAny(filepath.FromSlash("/var/lib/other"), home, config); ok {
		t.Error("a path outside every root was accepted")
	}
	// An empty root would otherwise turn into the relative current directory
	// and match far too much.
	if _, ok := UnderAny(filepath.FromSlash("/var/lib/other"), ""); ok {
		t.Error("an empty root was treated as a match")
	}
	if _, ok := UnderAny(filepath.FromSlash("/var/lib/other")); ok {
		t.Error("no roots at all was treated as a match")
	}
}
