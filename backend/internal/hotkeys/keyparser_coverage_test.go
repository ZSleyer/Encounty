package hotkeys

import "testing"

// TestValidateKeyCombo_EmptyString exercises the error return from
// ParseKeyCombo that ValidateKeyCombo propagates.
func TestValidateKeyCombo_EmptyString(t *testing.T) {
	_, err := ValidateKeyCombo("")
	if err == nil {
		t.Error("expected error for empty string")
	}
}

// TestParseKeyCombo_TrailingPlusModifiers exercises "Ctrl+Shift++" parsing.
func TestParseKeyCombo_ShiftPlus(t *testing.T) {
	combo, err := ParseKeyCombo("Ctrl+Shift++")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if combo.Key != "+" {
		t.Errorf("Key = %q, want %q", combo.Key, "+")
	}
	if !combo.Ctrl {
		t.Error("Ctrl should be true")
	}
	if !combo.Shift {
		t.Error("Shift should be true")
	}
}

// TestParseKeyCombo_NoKeyAfterSeparator exercises the error path where
// the key part is empty after modifiers.
func TestParseKeyCombo_EmptyKeyAfterModifiers(t *testing.T) {
	_, err := ParseKeyCombo("Ctrl+ ")
	// After trimming, key becomes "" which should error
	if err == nil {
		t.Error("expected error for empty key after modifiers")
	}
}
