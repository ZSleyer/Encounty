//go:build !darwin

// Package permissions provides access to macOS privacy permission checks and
// request flows. On non-macOS platforms all permissions are reported as granted
// and request functions are no-ops.
package permissions

// Status represents the current state of macOS privacy permissions.
type Status struct {
	Accessibility   bool `json:"accessibility"`
	ScreenRecording bool `json:"screen_recording"`
}

// GetStatus returns a Status with all permissions granted on non-macOS platforms.
func GetStatus() Status {
	return Status{
		Accessibility:   true,
		ScreenRecording: true,
	}
}

// RequestAccessibility is a no-op on non-macOS platforms.
func RequestAccessibility() error {
	return nil
}

// RequestScreenRecording is a no-op on non-macOS platforms.
func RequestScreenRecording() error {
	return nil
}
