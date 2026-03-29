//go:build darwin

// Package permissions provides access to macOS privacy permission checks and
// request flows. On macOS, global hotkeys require the Accessibility permission
// and screen capture requires the Screen Recording permission.
package permissions

/*
#cgo LDFLAGS: -framework CoreGraphics -framework ApplicationServices

#include <CoreGraphics/CoreGraphics.h>
#include <ApplicationServices/ApplicationServices.h>

// checkScreenCaptureAccess wraps CGPreflightScreenCaptureAccess (macOS 10.15+).
static bool checkScreenCaptureAccess(void) {
    return CGPreflightScreenCaptureAccess();
}

// requestScreenCaptureAccess wraps CGRequestScreenCaptureAccess (macOS 10.15+).
// This triggers the native system dialog on first call.
static bool requestScreenCaptureAccess(void) {
    return CGRequestScreenCaptureAccess();
}
*/
import "C"

import "os/exec"

// Status represents the current state of macOS privacy permissions.
type Status struct {
	Accessibility   bool `json:"accessibility"`
	ScreenRecording bool `json:"screen_recording"`
}

// GetStatus returns the current state of Accessibility and Screen Recording
// permissions on macOS.
func GetStatus() Status {
	return Status{
		Accessibility:   C.AXIsProcessTrusted() != 0,
		ScreenRecording: bool(C.checkScreenCaptureAccess()),
	}
}

// RequestAccessibility opens the System Settings pane for Accessibility,
// allowing the user to grant the permission manually.
func RequestAccessibility() error {
	return exec.Command("open", "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility").Run()
}

// RequestScreenRecording triggers the native Screen Recording permission
// dialog via CGRequestScreenCaptureAccess. Returns nil always — the dialog
// is asynchronous and the result is not immediately available.
func RequestScreenRecording() error {
	C.requestScreenCaptureAccess()
	return nil
}
