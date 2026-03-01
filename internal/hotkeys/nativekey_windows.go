//go:build windows

package hotkeys

import "golang.design/x/hotkey"

// Type aliases so hotkeys.go can use Modifier and Key without importing the library.
type Modifier = hotkey.Modifier
type Key = hotkey.Key

// Modifier constants (Win32 RegisterHotKey flags).
const (
	ModCtrl  = hotkey.ModCtrl
	ModShift = hotkey.ModShift
	ModAlt   = hotkey.ModAlt
)

// Key constants (Win32 Virtual Keys).
const (
	KeyF1  = hotkey.KeyF1
	KeyF2  = hotkey.KeyF2
	KeyF3  = hotkey.KeyF3
	KeyF4  = hotkey.KeyF4
	KeyF5  = hotkey.KeyF5
	KeyF6  = hotkey.KeyF6
	KeyF7  = hotkey.KeyF7
	KeyF8  = hotkey.KeyF8
	KeyF9  = hotkey.KeyF9
	KeyF10 = hotkey.KeyF10
	KeyF11 = hotkey.KeyF11
	KeyF12 = hotkey.KeyF12

	KeyA = hotkey.KeyA
	KeyB = hotkey.KeyB
	KeyC = hotkey.KeyC
	KeyD = hotkey.KeyD
	KeyE = hotkey.KeyE
	KeyF = hotkey.KeyF
	KeyG = hotkey.KeyG
	KeyH = hotkey.KeyH
	KeyI = hotkey.KeyI
	KeyJ = hotkey.KeyJ
	KeyK = hotkey.KeyK
	KeyL = hotkey.KeyL
	KeyM = hotkey.KeyM
	KeyN = hotkey.KeyN
	KeyO = hotkey.KeyO
	KeyP = hotkey.KeyP
	KeyQ = hotkey.KeyQ
	KeyR = hotkey.KeyR
	KeyS = hotkey.KeyS
	KeyT = hotkey.KeyT
	KeyU = hotkey.KeyU
	KeyV = hotkey.KeyV
	KeyW = hotkey.KeyW
	KeyX = hotkey.KeyX
	KeyY = hotkey.KeyY
	KeyZ = hotkey.KeyZ

	Key0 = hotkey.Key0
	Key1 = hotkey.Key1
	Key2 = hotkey.Key2
	Key3 = hotkey.Key3
	Key4 = hotkey.Key4
	Key5 = hotkey.Key5
	Key6 = hotkey.Key6
	Key7 = hotkey.Key7
	Key8 = hotkey.Key8
	Key9 = hotkey.Key9

	// Special characters (Win32 Virtual Key codes).
	KeySpace        Key = 0x20  // VK_SPACE
	KeyApostrophe   Key = 0xDE  // VK_OEM_7
	KeyAsterisk     Key = 0x6A  // VK_MULTIPLY (numpad; no dedicated VK for main-kbd *)
	KeyPlus         Key = 0xBB  // VK_OEM_PLUS
	KeyComma        Key = 0xBC  // VK_OEM_COMMA
	KeyMinus        Key = 0xBD  // VK_OEM_MINUS
	KeyPeriod       Key = 0xBE  // VK_OEM_PERIOD
	KeySlash        Key = 0xBF  // VK_OEM_2
	KeySemicolon    Key = 0xBA  // VK_OEM_1
	KeyEqual        Key = 0xBB  // VK_OEM_PLUS (same physical key as + on US layout)
	KeyBracketLeft  Key = 0xDB  // VK_OEM_4
	KeyBackslash    Key = 0xDC  // VK_OEM_5
	KeyBracketRight Key = 0xDD  // VK_OEM_6
	KeyGrave        Key = 0xC0  // VK_OEM_3

	// Navigation / editing.
	KeyBackspace Key = 0x08 // VK_BACK
	KeyTab       Key = 0x09 // VK_TAB
	KeyReturn    Key = 0x0D // VK_RETURN
	KeyEscape    Key = 0x1B // VK_ESCAPE
	KeyDelete    Key = 0x2E // VK_DELETE
	KeyInsert    Key = 0x2D // VK_INSERT
	KeyHome      Key = 0x24 // VK_HOME
	KeyEnd       Key = 0x23 // VK_END
	KeyPageUp    Key = 0x21 // VK_PRIOR
	KeyPageDown  Key = 0x22 // VK_NEXT
	KeyLeft      Key = 0x25 // VK_LEFT
	KeyUp        Key = 0x26 // VK_UP
	KeyRight     Key = 0x27 // VK_RIGHT
	KeyDown      Key = 0x28 // VK_DOWN

	// Numpad.
	KeyNumpadAdd      Key = 0x6B // VK_ADD
	KeyNumpadSubtract Key = 0x6D // VK_SUBTRACT
	KeyNumpadMultiply Key = 0x6A // VK_MULTIPLY
	KeyNumpadDivide   Key = 0x6F // VK_DIVIDE
	KeyNumpadDecimal  Key = 0x6E // VK_DECIMAL
)

// nativeKey wraps the library's Hotkey for Windows.
type nativeKey struct {
	hk *hotkey.Hotkey
	ch chan struct{}
}

func newNativeKey() *nativeKey {
	return &nativeKey{ch: make(chan struct{}, 64)}
}

func (nk *nativeKey) start(mods []Modifier, key Key) error {
	nk.hk = hotkey.New(mods, key)
	if err := nk.hk.Register(); err != nil {
		return err
	}
	go func() {
		for range nk.hk.Keydown() {
			select {
			case nk.ch <- struct{}{}:
			default:
			}
		}
		close(nk.ch)
	}()
	return nil
}

// stop unregisters the hotkey (non-blocking, completes within ~10ms on Windows).
func (nk *nativeKey) stop() {
	nk.hk.Unregister() //nolint:errcheck
}

func (nk *nativeKey) keydown() <-chan struct{} { return nk.ch }
