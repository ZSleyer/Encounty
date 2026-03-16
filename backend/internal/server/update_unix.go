//go:build !windows

package server

import (
	"fmt"
	"os"
	"syscall"
)

// replaceAndRestart atomically replaces the running binary with the downloaded
// file, then re-executes the new binary in-place (Unix only).
func replaceAndRestart(tmpPath, exe string) error {
	if err := os.Rename(tmpPath, exe); err != nil {
		return fmt.Errorf("rename binary: %w", err)
	}
	return syscall.Exec(exe, os.Args, syscall.Environ())
}
