// manager_test.go tests the Manager constructor and accessor methods.
package detector

import (
	"testing"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// TestNewManager verifies that NewManager returns a non-nil Manager.
func TestNewManager(t *testing.T) {
	mgr := NewManager(nil, "/tmp/test")
	if mgr == nil {
		t.Fatal("NewManager returned nil")
	}
}

// TestStateManager verifies that StateManager returns the same *state.Manager
// that was passed to NewManager.
func TestStateManager(t *testing.T) {
	sm := &state.Manager{}
	mgr := NewManager(sm, "/some/dir")

	got := mgr.StateManager()
	if got != sm {
		t.Errorf("StateManager() returned %p, want %p", got, sm)
	}
}

// TestConfigDir verifies that ConfigDir returns the same string that was
// passed to NewManager.
func TestConfigDir(t *testing.T) {
	dir := "/home/test/.config/encounty"
	mgr := NewManager(nil, dir)

	got := mgr.ConfigDir()
	if got != dir {
		t.Errorf("ConfigDir() = %q, want %q", got, dir)
	}
}
