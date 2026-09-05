package pathsafe

import (
	"os"
	"path/filepath"
	"testing"
)

// realTempDir returns a temporary directory with its own symlinks resolved, so
// expectations do not have to know that /tmp or /var may be a symlink.
func realTempDir(t *testing.T) string {
	t.Helper()
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatalf("resolve temp dir: %v", err)
	}
	return dir
}

// symlink creates a symlink and skips the test when the platform refuses,
// which is what Windows does without developer mode.
func symlink(t *testing.T, target, link string) {
	t.Helper()
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("cannot create a symlink here: %v", err)
	}
}

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
	tmp := realTempDir(t)
	base := filepath.Join(tmp, "home")
	if err := os.MkdirAll(filepath.Join(base, "a", "b", "c"), 0o755); err != nil {
		t.Fatalf("prepare tree: %v", err)
	}
	// A sibling that shares the base name as a plain string prefix.
	if err := os.MkdirAll(filepath.Join(tmp, "home2"), 0o755); err != nil {
		t.Fatalf("prepare sibling: %v", err)
	}

	cases := []struct {
		name string
		dir  string
		want string
		ok   bool
	}{
		{"descendant", filepath.Join(base, "a"), filepath.Join(base, "a"), true},
		{"deep descendant", filepath.Join(base, "a", "b", "c"), filepath.Join(base, "a", "b", "c"), true},
		{"base itself", base, base, true},
		{"base with a trailing separator", base + string(filepath.Separator), base, true},
		// The directory an ensureWritableDir call is about to create.
		{"descendant that does not exist yet", filepath.Join(base, "a", "new"), filepath.Join(base, "a", "new"), true},
		{"traversal out of base", filepath.Join(base, "..", "elsewhere"), "", false},
		{"sibling sharing the name prefix", filepath.Join(tmp, "home2"), "", false},
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

// TestUnderRejectsSymlinkOutOfBase covers the case a lexical check cannot see:
// the path stays under base as a string while the filesystem follows it out.
func TestUnderRejectsSymlinkOutOfBase(t *testing.T) {
	tmp := realTempDir(t)
	base := filepath.Join(tmp, "home")
	outside := filepath.Join(tmp, "outside")
	if err := os.MkdirAll(base, 0o755); err != nil {
		t.Fatalf("prepare base: %v", err)
	}
	if err := os.MkdirAll(outside, 0o755); err != nil {
		t.Fatalf("prepare outside: %v", err)
	}
	link := filepath.Join(base, "link")
	symlink(t, outside, link)

	if got, ok := Under(base, link); ok {
		t.Errorf("a symlink pointing out of base was accepted as %q", got)
	}
	// The escape through a symlinked middle component, with a leaf that does
	// not exist: this is the path an ensureWritableDir call would create.
	if got, ok := Under(base, filepath.Join(link, "sub")); ok {
		t.Errorf("a path through a symlink out of base was accepted as %q", got)
	}
}

// TestUnderRejectsDanglingSymlink covers the variant that looks like a path
// which simply does not exist yet: the link is there, only its target is
// missing, so it can be made to point anywhere the moment the target appears.
func TestUnderRejectsDanglingSymlink(t *testing.T) {
	tmp := realTempDir(t)
	base := filepath.Join(tmp, "home")
	if err := os.MkdirAll(base, 0o755); err != nil {
		t.Fatalf("prepare base: %v", err)
	}
	link := filepath.Join(base, "link")
	symlink(t, filepath.Join(tmp, "not-created-yet"), link)

	if got, ok := Under(base, link); ok {
		t.Errorf("a dangling symlink was accepted as %q", got)
	}
	if got, ok := Under(base, filepath.Join(link, "sub")); ok {
		t.Errorf("a path through a dangling symlink was accepted as %q", got)
	}
}

// TestUnderResolvesSymlinkInsideBase verifies that resolving does not reject
// the legitimate case, and that the resolved path is what comes back.
func TestUnderResolvesSymlinkInsideBase(t *testing.T) {
	tmp := realTempDir(t)
	base := filepath.Join(tmp, "home")
	target := filepath.Join(base, "target")
	if err := os.MkdirAll(target, 0o755); err != nil {
		t.Fatalf("prepare target: %v", err)
	}
	link := filepath.Join(base, "link")
	symlink(t, target, link)

	got, ok := Under(base, link)
	if !ok {
		t.Fatal("a symlink pointing inside base was rejected")
	}
	if got != target {
		t.Errorf("got %q, want the resolved target %q", got, target)
	}
}

// TestUnderResolvesTheBaseToo covers a base that is itself reached through a
// symlink, which is the shape of /var on macOS and of a home directory on a
// mounted volume. Resolving only the directory would reject everything there.
func TestUnderResolvesTheBaseToo(t *testing.T) {
	tmp := realTempDir(t)
	target := filepath.Join(tmp, "real")
	if err := os.MkdirAll(filepath.Join(target, "sub"), 0o755); err != nil {
		t.Fatalf("prepare tree: %v", err)
	}
	base := filepath.Join(tmp, "link")
	symlink(t, target, base)

	got, ok := Under(base, filepath.Join(base, "sub"))
	if !ok {
		t.Fatal("a directory under a symlinked base was rejected")
	}
	if want := filepath.Join(target, "sub"); got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestUnderAny(t *testing.T) {
	tmp := realTempDir(t)
	home := filepath.Join(tmp, "home")
	config := filepath.Join(tmp, "config")
	db := filepath.Join(config, "db")
	if err := os.MkdirAll(db, 0o755); err != nil {
		t.Fatalf("prepare tree: %v", err)
	}
	if err := os.MkdirAll(home, 0o755); err != nil {
		t.Fatalf("prepare home: %v", err)
	}
	outside := filepath.Join(tmp, "other")
	if err := os.MkdirAll(outside, 0o755); err != nil {
		t.Fatalf("prepare outside: %v", err)
	}

	if got, ok := UnderAny(db, home, config); !ok || got != db {
		t.Errorf("second root did not match: got %q, ok %v", got, ok)
	}
	if _, ok := UnderAny(outside, home, config); ok {
		t.Error("a path outside every root was accepted")
	}
	// An empty root would otherwise turn into the relative current directory
	// and match far too much.
	if _, ok := UnderAny(outside, ""); ok {
		t.Error("an empty root was treated as a match")
	}
	if _, ok := UnderAny(outside); ok {
		t.Error("no roots at all was treated as a match")
	}
}
