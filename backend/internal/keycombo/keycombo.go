// Package keycombo parses human-readable key-combo strings such as
// "Ctrl+Shift+F1" and reduces them to a canonical form. It is a leaf package
// with no project imports so that both the state layer (conflict checks) and
// the platform hotkey managers (registration) agree on which strings name the
// same physical key without importing each other.
package keycombo

import (
	"fmt"
	"strings"
)

// KeyCombo holds a parsed key combination.
type KeyCombo struct {
	Ctrl  bool
	Shift bool
	Alt   bool
	Key   string // normalized lowercase key name, e.g. "f1", "a", "escape"
}

// Parse parses a string like "Ctrl+Shift+F1" into a KeyCombo.
// The last segment is the key; everything before is modifier names.
//
// "+" is a valid key name (numpad plus). Because "+" also serves as the
// separator, we special-case it: a trailing "++" means the key is "+",
// and the remainder is the modifier prefix.
//
//	"+"      → Key:"+"
//	"Ctrl++" → Ctrl:true, Key:"+"
func Parse(s string) (KeyCombo, error) {
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

// String renders the combo in canonical form: modifiers in the fixed order
// ctrl, alt, shift, followed by the lowercase key, joined by "+".
func (c KeyCombo) String() string {
	parts := make([]string, 0, 4)
	if c.Ctrl {
		parts = append(parts, "ctrl")
	}
	if c.Alt {
		parts = append(parts, "alt")
	}
	if c.Shift {
		parts = append(parts, "shift")
	}
	return strings.Join(append(parts, c.Key), "+")
}

// Canonical returns the canonical form of s, so that two strings the managers
// would register as the same physical key compare equal: modifier order and
// aliases ("Control" for "Ctrl") do not matter, nor does case. A string Parse
// rejects falls back to its trimmed lowercase form, which still catches the
// plain case-only duplicates. An empty string stays empty.
func Canonical(s string) string {
	if strings.TrimSpace(s) == "" {
		return ""
	}
	c, err := Parse(s)
	if err != nil {
		return strings.ToLower(strings.TrimSpace(s))
	}
	return c.String()
}

// Same reports whether a and b name the same physical key. An empty combo
// never matches, because it means "unbound" rather than a key.
func Same(a, b string) bool {
	ca := Canonical(a)
	return ca != "" && ca == Canonical(b)
}
