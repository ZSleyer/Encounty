package hotkeys

import "testing"

const (
	fmtUnexpectedErr = "unexpected error: %v"
	fmtKeyWant       = "Key = %q, want %q"
)

func TestParseKeyComboSimpleKeys(t *testing.T) {
	tests := []struct {
		input   string
		wantKey string
	}{
		{"F1", "f1"},
		{"a", "a"},
		{"Escape", "escape"},
		{"f12", "f12"},
		{"Space", "space"},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			combo, err := ParseKeyCombo(tt.input)
			if err != nil {
				t.Fatalf(fmtUnexpectedErr, err)
			}
			if combo.Key != tt.wantKey {
				t.Errorf(fmtKeyWant, combo.Key, tt.wantKey)
			}
			if combo.Ctrl || combo.Shift || combo.Alt {
				t.Error("no modifiers expected")
			}
		})
	}
}

func TestParseKeyComboModifiers(t *testing.T) {
	tests := []struct {
		input     string
		wantKey   string
		wantCtrl  bool
		wantShift bool
		wantAlt   bool
	}{
		{"Ctrl+A", "a", true, false, false},
		{"Ctrl+Shift+F1", "f1", true, true, false},
		{"Alt+F4", "f4", false, false, true},
		{"Control+B", "b", true, false, false},
		{"Ctrl+Shift+Alt+X", "x", true, true, true},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			combo, err := ParseKeyCombo(tt.input)
			if err != nil {
				t.Fatalf(fmtUnexpectedErr, err)
			}
			if combo.Key != tt.wantKey {
				t.Errorf(fmtKeyWant, combo.Key, tt.wantKey)
			}
			if combo.Ctrl != tt.wantCtrl {
				t.Errorf("Ctrl = %v, want %v", combo.Ctrl, tt.wantCtrl)
			}
			if combo.Shift != tt.wantShift {
				t.Errorf("Shift = %v, want %v", combo.Shift, tt.wantShift)
			}
			if combo.Alt != tt.wantAlt {
				t.Errorf("Alt = %v, want %v", combo.Alt, tt.wantAlt)
			}
		})
	}
}

func TestParseKeyComboPlus(t *testing.T) {
	// "+" alone should parse as key="+"
	combo, err := ParseKeyCombo("+")
	if err != nil {
		t.Fatalf(fmtUnexpectedErr, err)
	}
	if combo.Key != "+" {
		t.Errorf(fmtKeyWant, combo.Key, "+")
	}
	if combo.Ctrl || combo.Shift || combo.Alt {
		t.Error("no modifiers expected for bare +")
	}
}

func TestParseKeyComboCtrlPlus(t *testing.T) {
	// "Ctrl++" should parse as Ctrl=true, key="+"
	combo, err := ParseKeyCombo("Ctrl++")
	if err != nil {
		t.Fatalf(fmtUnexpectedErr, err)
	}
	if combo.Key != "+" {
		t.Errorf(fmtKeyWant, combo.Key, "+")
	}
	if !combo.Ctrl {
		t.Error("Ctrl should be true")
	}
}

func TestParseKeyComboEmpty(t *testing.T) {
	_, err := ParseKeyCombo("")
	if err == nil {
		t.Error("expected error for empty string")
	}
}

func TestParseKeyComboCase(t *testing.T) {
	// Should be case insensitive for modifiers and keys
	tests := []struct {
		input     string
		wantKey   string
		wantCtrl  bool
		wantShift bool
	}{
		{"CTRL+A", "a", true, false},
		{"ctrl+shift+f1", "f1", true, true},
		{"SHIFT+Escape", "escape", false, true},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			combo, err := ParseKeyCombo(tt.input)
			if err != nil {
				t.Fatalf(fmtUnexpectedErr, err)
			}
			if combo.Key != tt.wantKey {
				t.Errorf(fmtKeyWant, combo.Key, tt.wantKey)
			}
			if combo.Ctrl != tt.wantCtrl {
				t.Errorf("Ctrl = %v, want %v", combo.Ctrl, tt.wantCtrl)
			}
			if combo.Shift != tt.wantShift {
				t.Errorf("Shift = %v, want %v", combo.Shift, tt.wantShift)
			}
		})
	}
}

func TestValidateKeyComboKnownKey(t *testing.T) {
	combo, err := ValidateKeyCombo("F1")
	if err != nil {
		t.Fatalf(fmtUnexpectedErr, err)
	}
	if combo.Key != "f1" {
		t.Errorf(fmtKeyWant, combo.Key, "f1")
	}
}

func TestValidateKeyComboUnknownKey(t *testing.T) {
	_, err := ValidateKeyCombo("NoSuchKey")
	if err == nil {
		t.Error("expected error for unknown key")
	}
}
