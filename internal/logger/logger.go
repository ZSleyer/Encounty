// Package logger configures the global slog default logger for the application.
// It parses a level string into an slog.Level and installs a text handler with
// timestamps, level, and message output on stderr.
package logger

import (
	"log/slog"
	"os"
	"strings"
)

// Init sets the global slog default logger to use a text handler at the given
// level. Valid level strings are "debug", "info", "warn", and "error"
// (case-insensitive). An unrecognised string defaults to Info.
func Init(level string) {
	var lvl slog.Level
	switch strings.ToLower(level) {
	case "debug":
		lvl = slog.LevelDebug
	case "info":
		lvl = slog.LevelInfo
	case "warn":
		lvl = slog.LevelWarn
	case "error":
		lvl = slog.LevelError
	default:
		lvl = slog.LevelInfo
	}

	handler := slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
		Level: lvl,
	})
	slog.SetDefault(slog.New(handler))
}
