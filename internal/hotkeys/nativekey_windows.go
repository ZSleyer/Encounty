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
