//go:build darwin

// keycodes_darwin.go maps normalised key names (as recorded by the browser's
// KeyboardEvent.code / KeyboardEvent.key) to macOS CGKeyCode values. These
// are virtual key codes used by the Core Graphics event tap API and correspond
// to physical key positions on the keyboard.
package hotkeys

import "fmt"

// cgKeyCode is the macOS virtual key code type (CGKeyCode).
type cgKeyCode = uint16

// keyNameToCGKeyCode maps normalised (lowercase) key names to macOS CGKeyCode values.
var keyNameToCGKeyCode = map[string]cgKeyCode{
	// Letters (macOS virtual key codes are layout-independent physical positions)
	"a": 0x00,
	"s": 0x01,
	"d": 0x02,
	"f": 0x03,
	"h": 0x04,
	"g": 0x05,
	"z": 0x06,
	"x": 0x07,
	"c": 0x08,
	"v": 0x09,
	"b": 0x0B,
	"q": 0x0C,
	"w": 0x0D,
	"e": 0x0E,
	"r": 0x0F,
	"y": 0x10,
	"t": 0x11,
	"o": 0x1F,
	"u": 0x20,
	"i": 0x22,
	"p": 0x23,
	"l": 0x25,
	"j": 0x26,
	"k": 0x28,
	"n": 0x2D,
	"m": 0x2E,

	// Digits (top row)
	"1": 0x12,
	"2": 0x13,
	"3": 0x14,
	"4": 0x15,
	"5": 0x17,
	"6": 0x16,
	"7": 0x1A,
	"8": 0x1C,
	"9": 0x19,
	"0": 0x1D,

	// Position-based names (from browser e.code, layout-independent)
	"equal":        0x18, // US: =
	"minus":        0x1B, // US: -
	"bracketleft":  0x21, // US: [
	"bracketright": 0x1E, // US: ]
	"backslash":    0x2A, // US: backslash
	"semicolon":    0x29, // US: ;
	"quote":        0x27, // US: '
	"comma":        0x2B, // US: ,
	"period":       0x2F, // US: .
	"slash":        0x2C, // US: /
	"backquote":    0x32, // US: `
	"space":        0x31, // Space bar

	// Character aliases — what the browser sends as e.key
	"+":  0x1E, // bracketright position
	" ":  0x31, // Space
	"'":  0x27, // Quote
	",":  0x2B, // Comma
	"-":  0x1B, // Minus
	".":  0x2F, // Period
	"/":  0x2C, // Slash
	";":  0x29, // Semicolon
	"=":  0x18, // Equal
	"[":  0x21, // Left bracket
	"\\": 0x2A, // Backslash
	"]":  0x1E, // Right bracket
	"`":  0x32, // Grave

	// Navigation / editing
	"backspace":  0x33, // Delete (backspace)
	"tab":        0x30, // Tab
	"enter":      0x24, // Return
	"escape":     0x35, // Escape
	"delete":     0x75, // Forward delete
	"home":       0x73, // Home
	"end":        0x77, // End
	"pageup":     0x74, // Page Up
	"pagedown":   0x79, // Page Down
	"arrowleft":  0x7B, // Left arrow
	"arrowup":    0x7E, // Up arrow
	"arrowright": 0x7C, // Right arrow
	"arrowdown":  0x7D, // Down arrow

	// Function keys
	"f1":  0x7A,
	"f2":  0x78,
	"f3":  0x63,
	"f4":  0x76,
	"f5":  0x60,
	"f6":  0x61,
	"f7":  0x62,
	"f8":  0x64,
	"f9":  0x65,
	"f10": 0x6D,
	"f11": 0x67,
	"f12": 0x6F,

	// Numpad operators
	"numpadadd":      0x45, // Numpad +
	"numpadsubtract": 0x4E, // Numpad -
	"numpadmultiply": 0x43, // Numpad *
	"numpaddivide":   0x4B, // Numpad /
	"numpaddecimal":  0x41, // Numpad .
	"numpadenter":    0x4C, // Numpad Enter

	// Numpad digits
	"numpad0": 0x52,
	"numpad1": 0x53,
	"numpad2": 0x54,
	"numpad3": 0x55,
	"numpad4": 0x56,
	"numpad5": 0x57,
	"numpad6": 0x58,
	"numpad7": 0x59,
	"numpad8": 0x5B,
	"numpad9": 0x5C,
}

// platformValidateKey returns an error if key is not in the CGKeyCode map.
func platformValidateKey(key string) error {
	if _, ok := keyNameToCGKeyCode[key]; !ok {
		return fmt.Errorf("unknown key: %q", key)
	}
	return nil
}
