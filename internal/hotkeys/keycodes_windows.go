//go:build windows

// keycodes_windows.go maps normalised key names (as recorded by the browser's
// KeyboardEvent.code / KeyboardEvent.key) to Windows Virtual-Key (VK_*) codes.
// OEM codes (0xBA-0xDF) are position-based like the browser's e.code, so the
// mapping is mostly 1:1 regardless of keyboard layout.
package hotkeys

import "fmt"

// vkCode is a Windows Virtual-Key code.
type vkCode = uint32

// RegisterHotKey modifier flags.
const (
	modAlt      uint32 = 0x0001
	modCtrl     uint32 = 0x0002
	modShift    uint32 = 0x0004
	modNoRepeat uint32 = 0x4000
)

// keyNameToVK maps normalised (lowercase) key names to Windows VK_* codes.
var keyNameToVK = map[string]vkCode{
	// Function keys
	"f1":  0x70,
	"f2":  0x71,
	"f3":  0x72,
	"f4":  0x73,
	"f5":  0x74,
	"f6":  0x75,
	"f7":  0x76,
	"f8":  0x77,
	"f9":  0x78,
	"f10": 0x79,
	"f11": 0x7A,
	"f12": 0x7B,

	// Letters (VK code == uppercase ASCII)
	"a": 0x41,
	"b": 0x42,
	"c": 0x43,
	"d": 0x44,
	"e": 0x45,
	"f": 0x46,
	"g": 0x47,
	"h": 0x48,
	"i": 0x49,
	"j": 0x4A,
	"k": 0x4B,
	"l": 0x4C,
	"m": 0x4D,
	"n": 0x4E,
	"o": 0x4F,
	"p": 0x50,
	"q": 0x51,
	"r": 0x52,
	"s": 0x53,
	"t": 0x54,
	"u": 0x55,
	"v": 0x56,
	"w": 0x57,
	"x": 0x58,
	"y": 0x59,
	"z": 0x5A,

	// Digits
	"0": 0x30,
	"1": 0x31,
	"2": 0x32,
	"3": 0x33,
	"4": 0x34,
	"5": 0x35,
	"6": 0x36,
	"7": 0x37,
	"8": 0x38,
	"9": 0x39,

	// Position-based names (from browser e.code, layout-independent).
	// Win32 OEM codes are also position-based, so the mapping is 1:1.
	"minus":        0xBD, // VK_OEM_MINUS    (US: -, DE: ß)
	"equal":        0xBB, // VK_OEM_PLUS     (US: =, DE: ´)  — VK_OEM_PLUS = "the = key"
	"bracketleft":  0xDB, // VK_OEM_4        (US: [, DE: ü)
	"bracketright": 0xDD, // VK_OEM_6        (US: ], DE: +)
	"backslash":    0xDC, // VK_OEM_5        (US: \)
	"semicolon":    0xBA, // VK_OEM_1        (US: ;, DE: ö)
	"quote":        0xDE, // VK_OEM_7        (US: ', DE: ä)
	"comma":        0xBC, // VK_OEM_COMMA
	"period":       0xBE, // VK_OEM_PERIOD
	"slash":        0xBF, // VK_OEM_2        (US: /, DE: -)
	"backquote":    0xC0, // VK_OEM_3        (US: `)
	"space":        0x20, // VK_SPACE

	// Character aliases — what the browser sends as e.key.
	// VK_OEM_PLUS is explicitly documented as "the '+' key for any
	// country/region", so it correctly maps to the German '+' key.
	"+":  0xBB, // VK_OEM_PLUS  ("the '+' key for any country/region")
	" ":  0x20, // VK_SPACE
	"'":  0xDE, // VK_OEM_7
	",":  0xBC, // VK_OEM_COMMA
	"-":  0xBD, // VK_OEM_MINUS
	".":  0xBE, // VK_OEM_PERIOD
	"/":  0xBF, // VK_OEM_2
	";":  0xBA, // VK_OEM_1
	"=":  0xBB, // VK_OEM_PLUS
	"[":  0xDB, // VK_OEM_4
	"\\": 0xDC, // VK_OEM_5
	"]":  0xDD, // VK_OEM_6
	"`":  0xC0, // VK_OEM_3

	// Navigation / editing
	"backspace": 0x08, // VK_BACK
	"tab":       0x09, // VK_TAB
	"enter":     0x0D, // VK_RETURN
	"escape":    0x1B, // VK_ESCAPE
	"delete":    0x2E, // VK_DELETE
	"insert":    0x2D, // VK_INSERT
	"home":      0x24, // VK_HOME
	"end":       0x23, // VK_END
	"pageup":    0x21, // VK_PRIOR
	"pagedown":  0x22, // VK_NEXT
	"arrowleft":  0x25, // VK_LEFT
	"arrowup":    0x26, // VK_UP
	"arrowright": 0x27, // VK_RIGHT
	"arrowdown":  0x28, // VK_DOWN

	// Numpad operators
	"numpadadd":      0x6B, // VK_ADD
	"numpadsubtract": 0x6D, // VK_SUBTRACT
	"numpadmultiply": 0x6A, // VK_MULTIPLY
	"numpaddivide":   0x6F, // VK_DIVIDE
	"numpaddecimal":  0x6E, // VK_DECIMAL
	"numpadenter":    0x0D, // VK_RETURN (Windows does not distinguish numpad Enter)

	// Numpad digits (NumLock on; e.code = "Numpad0"-"Numpad9")
	"numpad0": 0x60, // VK_NUMPAD0
	"numpad1": 0x61, // VK_NUMPAD1
	"numpad2": 0x62, // VK_NUMPAD2
	"numpad3": 0x63, // VK_NUMPAD3
	"numpad4": 0x64, // VK_NUMPAD4
	"numpad5": 0x65, // VK_NUMPAD5
	"numpad6": 0x66, // VK_NUMPAD6
	"numpad7": 0x67, // VK_NUMPAD7
	"numpad8": 0x68, // VK_NUMPAD8
	"numpad9": 0x69, // VK_NUMPAD9
}

// platformValidateKey returns an error if key is not in the VK map.
func platformValidateKey(key string) error {
	if _, ok := keyNameToVK[key]; !ok {
		return fmt.Errorf("unknown key: %q", key)
	}
	return nil
}
