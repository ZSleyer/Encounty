//go:build !windows

// Package reexec provides process re-execution helpers for graceful restarts.
package reexec

import "syscall"

// Reexec replaces the current process with a fresh instance on Unix/Linux/macOS.
func Reexec(exe string, args []string) error {
	return syscall.Exec(exe, append([]string{exe}, args...), syscall.Environ())
}
