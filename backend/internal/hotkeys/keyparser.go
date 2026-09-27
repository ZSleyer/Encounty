// keyparser.go parses and validates human-readable key-combo strings such as
// "Ctrl+Shift+F1" or "Alt+A" into a structured KeyCombo that the platform
// managers can use to register OS-level hotkeys. The parsing itself lives in
// the keycombo leaf package so the state layer can compare combos exactly the
// way the managers register them without importing this package.
package hotkeys

import "github.com/zsleyer/encounty/backend/internal/keycombo"

// KeyCombo holds a parsed key combination.
type KeyCombo = keycombo.KeyCombo

// ParseKeyCombo parses a string like "Ctrl+Shift+F1" into a KeyCombo. See
// keycombo.Parse for the grammar, including the "+" key special case.
func ParseKeyCombo(s string) (KeyCombo, error) {
	return keycombo.Parse(s)
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
