// keyparser.go parses and validates human-readable key-combo strings such as
// "Ctrl+Shift+F1" or "Alt+A" into a structured KeyCombo that the platform
// managers can use to register OS-level hotkeys.
package hotkeys

import (
	"fmt"
	"strings"
)

// KeyCombo holds a parsed key combination.
type KeyCombo struct {
	Ctrl  bool
	Shift bool
	Alt   bool
	Key   string // normalised lowercase key name, e.g. "f1", "a", "escape"
}

// ParseKeyCombo parses a string like "Ctrl+Shift+F1" into a KeyCombo.
// The last segment is the key; everything before is modifier names.
//
// "+" is a valid key name (numpad plus). Because "+" also serves as the
// separator, we special-case it: a trailing "++" means the key is "+",
// and the remainder is the modifier prefix.
//
//	"+"      → Key:"+"
//	"Ctrl++" → Ctrl:true, Key:"+"
func ParseKeyCombo(s string) (KeyCombo, error) {
	if s == "" {
		return KeyCombo{}, fmt.Errorf("empty key combo")
	}

	var modPart, keyPart string

	switch {
	case s == "+":
		keyPart = "+"
		modPart = ""
	case strings.HasSuffix(s, "++"):
		// e.g. "Ctrl+Shift++" → modPart="Ctrl+Shift", keyPart="+"
		keyPart = "+"
		modPart = s[:len(s)-2]
	default:
		idx := strings.LastIndex(s, "+")
		if idx < 0 {
			keyPart = s
			modPart = ""
		} else {
			modPart = s[:idx]
			keyPart = s[idx+1:]
		}
	}

	var combo KeyCombo
	combo.Key = strings.ToLower(strings.TrimSpace(keyPart))

	for mod := range strings.SplitSeq(modPart, "+") {
		switch strings.ToLower(strings.TrimSpace(mod)) {
		case "ctrl", "control":
			combo.Ctrl = true
		case "shift":
			combo.Shift = true
		case "alt":
			combo.Alt = true
		}
	}

	if combo.Key == "" {
		return KeyCombo{}, fmt.Errorf("no key specified in combo %q", s)
	}
	return combo, nil
}

// ValidateKeyCombo parses and validates a key combo against the current platform's
// known key set. Returns an error if the key is unknown.
func ValidateKeyCombo(s string) (KeyCombo, error) {
	combo, err := ParseKeyCombo(s)
	if err != nil {
		return combo, err
	}
	if err := platformValidateKey(combo.Key); err != nil {
		return combo, err
	}
	return combo, nil
}
