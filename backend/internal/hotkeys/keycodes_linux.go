//go:build linux

// keycodes_linux.go maps normalised key names (as recorded by the browser's
// KeyboardEvent.code / KeyboardEvent.key) to Linux evdev KEY_* codes from
// input-event-codes.h. These codes are layout-independent physical key
// positions, which is what the evdev reader observes.
package hotkeys

import "fmt"

// evKey is the Linux evdev key code type (input-event-codes.h).
type evKey = uint16

// Evdev key codes for modifier tracking.
const (
	evKeyLeftCtrl   evKey = 29
	evKeyRightCtrl  evKey = 97
	evKeyLeftShift  evKey = 42
	evKeyRightShift evKey = 54
	evKeyLeftAlt    evKey = 56
	evKeyRightAlt   evKey = 100
)

// keyNameToEvKey maps normalised (lowercase) key names to evdev KEY_* codes.
var keyNameToEvKey = map[string]evKey{
	// Function keys
	"f1":  59,
	"f2":  60,
	"f3":  61,
	"f4":  62,
	"f5":  63,
	"f6":  64,
	"f7":  65,
	"f8":  66,
	"f9":  67,
	"f10": 68,
	"f11": 87,
	"f12": 88,

	// Letters (KEY_Q=16 … layout order, but we use key names not positions)
	"a": 30,
	"b": 48,
	"c": 46,
	"d": 32,
	"e": 18,
	"f": 33,
	"g": 34,
	"h": 35,
	"i": 23,
	"j": 36,
	"k": 37,
	"l": 38,
	"m": 50,
	"n": 49,
	"o": 24,
	"p": 25,
	"q": 16,
	"r": 19,
	"s": 31,
	"t": 20,
	"u": 22,
	"v": 47,
	"w": 17,
	"x": 45,
	"y": 21,
	"z": 44,

	// Digits (top row)
	"0": 11,
	"1": 2,
	"2": 3,
	"3": 4,
	"4": 5,
	"5": 6,
	"6": 7,
	"7": 8,
	"8": 9,
	"9": 10,

	// Position-based names (from browser e.code, layout-independent).
	// These are the canonical names used when recording hotkeys.
	"minus":        12, // KEY_MINUS        (US: -, DE: ß)
	"equal":        13, // KEY_EQUAL        (US: =, DE: ´)
	"bracketleft":  26, // KEY_LEFTBRACE    (US: [, DE: ü)
	"bracketright": 27, // KEY_RIGHTBRACE   (US: ], DE: +)
	"backslash":    43, // KEY_BACKSLASH    (US: \)
	"semicolon":    39, // KEY_SEMICOLON    (US: ;, DE: ö)
	"quote":        40, // KEY_APOSTROPHE   (US: ', DE: ä)
	"comma":        51, // KEY_COMMA
	"period":       52, // KEY_DOT
	"slash":        53, // KEY_SLASH        (US: /, DE: -)
	"backquote":    41, // KEY_GRAVE        (US: `)
	"space":        57, // KEY_SPACE

	// Character aliases — what the browser sends as e.key.
	// "+" maps to KEY_RIGHTBRACE because on ISO-DE keyboards the dedicated
	// '+' key sits at that physical position.  US keyboards don't have a
	// standalone '+' key, so this is the best universal match.
	"+":  27, // KEY_RIGHTBRACE (ISO-DE: +, US: ])
	" ":  57, // KEY_SPACE
	"'":  40, // KEY_APOSTROPHE
	"*":  55, // KEY_KPASTERISK
	",":  51, // KEY_COMMA
	"-":  12, // KEY_MINUS
	".":  52, // KEY_DOT
	"/":  53, // KEY_SLASH
	";":  39, // KEY_SEMICOLON
	"=":  13, // KEY_EQUAL
	"[":  26, // KEY_LEFTBRACE
	"\\": 43, // KEY_BACKSLASH
	"]":  27, // KEY_RIGHTBRACE
	"`":  41, // KEY_GRAVE

	// Navigation / editing
	"backspace": 14,  // KEY_BACKSPACE
	"tab":       15,  // KEY_TAB
	"enter":     28,  // KEY_ENTER
	"escape":    1,   // KEY_ESC
	"delete":    111, // KEY_DELETE
	"insert":    110, // KEY_INSERT
	"home":      102, // KEY_HOME
	"end":       107, // KEY_END
	"pageup":    104, // KEY_PAGEUP
	"pagedown":  109, // KEY_PAGEDOWN
	"arrowleft":  105, // KEY_LEFT
	"arrowup":    103, // KEY_UP
	"arrowright": 106, // KEY_RIGHT
	"arrowdown":  108, // KEY_DOWN

	// Numpad operators
	"numpadadd":      78, // KEY_KPPLUS
	"numpadsubtract": 74, // KEY_KPMINUS
	"numpadmultiply": 55, // KEY_KPASTERISK
	"numpaddivide":   98, // KEY_KPSLASH
	"numpaddecimal":  83, // KEY_KPDOT
	"numpadenter":    96, // KEY_KPENTER

	// Numpad digits (NumLock on; e.code = "Numpad0"-"Numpad9")
	"numpad0": 82, // KEY_KP0
	"numpad1": 79, // KEY_KP1
	"numpad2": 80, // KEY_KP2
	"numpad3": 81, // KEY_KP3
	"numpad4": 75, // KEY_KP4
	"numpad5": 76, // KEY_KP5
	"numpad6": 77, // KEY_KP6
	"numpad7": 71, // KEY_KP7
	"numpad8": 72, // KEY_KP8
	"numpad9": 73, // KEY_KP9
}

// platformValidateKey returns an error if key is not in the evdev key map.
func platformValidateKey(key string) error {
	if _, ok := keyNameToEvKey[key]; !ok {
		return fmt.Errorf("unknown key: %q", key)
	}
	return nil
}
