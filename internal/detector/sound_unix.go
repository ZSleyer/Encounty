// sound_unix.go — plays a short system notification sound on Linux/macOS by
// invoking available command-line audio utilities. Failures are silently
// ignored so that a missing audio stack never disrupts detection.
//
//go:build !windows

package detector

import "os/exec"

// PlayMatchSound emits a one-shot system alert sound without blocking the
// caller. It tries paplay, aplay, then afplay (macOS) in order.
func PlayMatchSound() {
	cmds := [][]string{
		{"paplay", "/usr/share/sounds/freedesktop/stereo/complete.oga"},
		{"aplay", "/usr/share/sounds/generic.wav"},
		{"afplay", "/System/Library/Sounds/Glass.aiff"},
	}
	for _, args := range cmds {
		if path, err := exec.LookPath(args[0]); err == nil {
			cmd := exec.Command(path, args[1:]...)
			_ = cmd.Start()
			return
		}
	}
}
