// sound_windows.go — plays the Windows "Asterisk" system sound via PowerShell.
// Failures are silently ignored.
//
//go:build windows

package detector

import "os/exec"

// PlayMatchSound emits the Windows Asterisk system alert sound without
// blocking the caller.
func PlayMatchSound() {
	cmd := exec.Command("powershell", "-NoProfile", "-Command",
		`[System.Media.SystemSounds]::Asterisk.Play()`)
	_ = cmd.Start()
}
