// capabilities.go reports platform-specific capture capabilities so the
// frontend can hide or disable source types that will not work.
package detector

import (
	"os"
	"runtime"
)

// Capabilities describes which capture backends are available on this system.
type Capabilities struct {
	Platform                     string `json:"platform"`
	DisplayServer                string `json:"display_server"`
	SupportsWindowCapture        bool   `json:"supports_window_capture"`
	SupportsScreenCapture        bool   `json:"supports_screen_capture"`
	SupportsCamera               bool   `json:"supports_camera"`
	SidecarAvailable             bool   `json:"sidecar_available"`
	SidecarMatchSupport          bool   `json:"sidecar_match_support"`           // sidecar can do capture+match
	SidecarSupportsWindowCapture bool   `json:"sidecar_supports_window_capture"` // sidecar can enumerate windows
}

// GetCapabilities probes the runtime environment and returns a Capabilities
// snapshot that the frontend can use to filter source options.
func GetCapabilities() Capabilities {
	cap := Capabilities{
		Platform: runtime.GOOS,
	}

	switch runtime.GOOS {
	case "windows":
		cap.DisplayServer = "win32"
		cap.SupportsWindowCapture = true
		cap.SupportsScreenCapture = true
		cap.SupportsCamera = false // no Go camera impl on Windows
		cap.SidecarSupportsWindowCapture = true
	case "linux":
		cap.DisplayServer = detectLinuxDisplayServer()
		isX11 := cap.DisplayServer == "x11"
		cap.SupportsWindowCapture = false  // stub on Linux
		cap.SupportsScreenCapture = isX11  // kbinani/screenshot is X11-only
		cap.SupportsCamera = true          // V4L2
		cap.SidecarSupportsWindowCapture = true
	case "darwin":
		cap.DisplayServer = "quartz"
		cap.SupportsScreenCapture = true
		cap.SupportsWindowCapture = false
		cap.SupportsCamera = false
	}

	// Check whether the Rust capture sidecar binary is on PATH or next to us.
	cap.SidecarAvailable = sidecarExists()
	cap.SidecarMatchSupport = cap.SidecarAvailable

	return cap
}

// detectLinuxDisplayServer checks environment variables to determine whether
// the session runs on Wayland or X11.
func detectLinuxDisplayServer() string {
	if os.Getenv("WAYLAND_DISPLAY") != "" {
		return "wayland"
	}
	if st := os.Getenv("XDG_SESSION_TYPE"); st == "wayland" {
		return "wayland"
	}
	return "x11"
}

// sidecarExists returns true when the capture sidecar binary can be found.
// Delegates to findSidecarBinary so the same search paths apply everywhere.
func sidecarExists() bool {
	_, err := findSidecarBinary()
	return err == nil
}
