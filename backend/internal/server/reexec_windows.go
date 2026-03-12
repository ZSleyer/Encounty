//go:build windows

package server

import (
	"os/exec"
	"syscall"
)

// reexec spawns a new detached process on Windows (no syscall.Exec equivalent)
// and then the caller will os.Exit to terminate the current instance.
func reexec(exe string, args []string) error {
	cmd := exec.Command(exe, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP}
	return cmd.Start()
}
