package logger

import (
	"context"
	"log/slog"
	"testing"
)

// TestInitSetsDebugLevel verifies that Init("debug") configures the default
// logger with LevelDebug.
func TestInitSetsDebugLevel(t *testing.T) {
	Init("debug")
	if !slog.Default().Enabled(context.TODO(), slog.LevelDebug) {
		t.Error("expected debug level to be enabled after Init(\"debug\")")
	}
}

// TestInitSetsInfoLevel verifies that Init("info") configures LevelInfo.
func TestInitSetsInfoLevel(t *testing.T) {
	Init("info")
	if !slog.Default().Enabled(context.TODO(), slog.LevelInfo) {
		t.Error("expected info level to be enabled after Init(\"info\")")
	}
	if slog.Default().Enabled(context.TODO(), slog.LevelDebug) {
		t.Error("debug level should not be enabled when level is info")
	}
}

// TestInitSetsWarnLevel verifies that Init("warn") configures LevelWarn.
func TestInitSetsWarnLevel(t *testing.T) {
	Init("warn")
	if !slog.Default().Enabled(context.TODO(), slog.LevelWarn) {
		t.Error("expected warn level to be enabled after Init(\"warn\")")
	}
	if slog.Default().Enabled(context.TODO(), slog.LevelInfo) {
		t.Error("info level should not be enabled when level is warn")
	}
}

// TestInitSetsErrorLevel verifies that Init("error") configures LevelError.
func TestInitSetsErrorLevel(t *testing.T) {
	Init("error")
	if !slog.Default().Enabled(context.TODO(), slog.LevelError) {
		t.Error("expected error level to be enabled after Init(\"error\")")
	}
	if slog.Default().Enabled(context.TODO(), slog.LevelWarn) {
		t.Error("warn level should not be enabled when level is error")
	}
}

// TestInitDefaultsToInfoForUnknown verifies that an unrecognised level string
// falls back to LevelInfo.
func TestInitDefaultsToInfoForUnknown(t *testing.T) {
	Init("nonsense")
	if !slog.Default().Enabled(context.TODO(), slog.LevelInfo) {
		t.Error("expected info level to be enabled for unknown level string")
	}
	if slog.Default().Enabled(context.TODO(), slog.LevelDebug) {
		t.Error("debug level should not be enabled for unknown level string")
	}
}

// TestInitIsCaseInsensitive verifies that level parsing ignores case.
func TestInitIsCaseInsensitive(t *testing.T) {
	Init("DEBUG")
	if !slog.Default().Enabled(context.TODO(), slog.LevelDebug) {
		t.Error("expected debug level to be enabled for uppercase \"DEBUG\"")
	}

	Init("Warn")
	if !slog.Default().Enabled(context.TODO(), slog.LevelWarn) {
		t.Error("expected warn level to be enabled for mixed-case \"Warn\"")
	}
}
