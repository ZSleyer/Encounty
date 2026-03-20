//go:build windows

// reexec_windows.go provides process re-execution on Windows.
package updater

import (
	"os/exec"
	"syscall"
)

// Reexec spawns a new detached process on Windows (no syscall.Exec equivalent)
// and then the caller will os.Exit to terminate the current instance.
func Reexec(exe string, args []string) error {
	cmd := exec.Command(exe, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP}
	return cmd.Start()
}
