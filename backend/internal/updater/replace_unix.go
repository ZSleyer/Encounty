//go:build !windows

// replace_unix.go handles atomic binary replacement and restart on Unix.
package updater

import (
	"fmt"
	"os"
	"syscall"
)

// ReplaceAndRestart atomically replaces the running binary with the downloaded
// file, then re-executes the new binary in-place (Unix only).
func ReplaceAndRestart(tmpPath, exe string) error {
	if err := os.Rename(tmpPath, exe); err != nil {
		return fmt.Errorf("rename binary: %w", err)
	}
	return syscall.Exec(exe, os.Args, syscall.Environ())
}
