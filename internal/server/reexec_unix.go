//go:build !windows

package server

import "syscall"

// reexec replaces the current process with a fresh instance on Unix/Linux.
func reexec(exe string, args []string) error {
	return syscall.Exec(exe, append([]string{exe}, args...), syscall.Environ())
}
