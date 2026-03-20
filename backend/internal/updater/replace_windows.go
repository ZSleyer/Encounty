//go:build windows

// replace_windows.go handles binary replacement and restart on Windows.
package updater

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
)

// ReplaceAndRestart writes a helper .bat that waits for the current process to
// exit, swaps the binaries, then launches the new binary. The current process
// then exits so the bat can proceed.
func ReplaceAndRestart(tmpPath, exe string) error {
	batPath := filepath.Join(filepath.Dir(exe), ".encounty-update.bat")
	bat := fmt.Sprintf("@echo off\r\nping -n 3 127.0.0.1 >nul\r\nmove /Y \"%s\" \"%s\"\r\nstart \"\" \"%s\"\r\ndel \"%%~f0\"\r\n",
		tmpPath, exe, exe)
	if err := os.WriteFile(batPath, []byte(bat), 0644); err != nil {
		return fmt.Errorf("write update bat: %w", err)
	}
	cmd := exec.Command("cmd", "/C", batPath)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP,
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start update bat: %w", err)
	}
	time.Sleep(100 * time.Millisecond)
	os.Exit(0)
	return nil
}
