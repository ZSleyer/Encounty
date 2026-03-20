//go:build !windows

// reexec_unix.go provides process re-execution on Unix/Linux.
package updater

import "syscall"

// Reexec replaces the current process with a fresh instance on Unix/Linux.
func Reexec(exe string, args []string) error {
	return syscall.Exec(exe, append([]string{exe}, args...), syscall.Environ())
}
