//go:build linux

package hotkeys

/*
#cgo LDFLAGS: -lX11
#include <stdint.h>
int encountyDisplayTest();
void grabAndListen(uintptr_t handle, unsigned int mod, int keysym, int cancelFd);
*/
import "C"

import (
	"runtime"
	"runtime/cgo"
	"syscall"
)

func init() {
	if C.encountyDisplayTest() != 0 {
		panic("hotkeys: cannot open X11 display — is DISPLAY set?")
	}
}

// Modifier is the X11 modifier bitmask type.
type Modifier = uint32

// Key is an X11 KeySym value.
type Key = uint16

// Modifier constants (X11 modifier masks from X.h).
const (
	ModCtrl  Modifier = 1 << 2 // ControlMask
	ModShift Modifier = 1 << 0 // ShiftMask
	Mod1     Modifier = 1 << 3 // Mod1Mask (typically Alt on X11)
)

// Key constants — X11 KeySym values (from keysymdef.h).
const (
	KeyF1  Key = 0xffbe
	KeyF2  Key = 0xffbf
	KeyF3  Key = 0xffc0
	KeyF4  Key = 0xffc1
	KeyF5  Key = 0xffc2
	KeyF6  Key = 0xffc3
	KeyF7  Key = 0xffc4
	KeyF8  Key = 0xffc5
	KeyF9  Key = 0xffc6
	KeyF10 Key = 0xffc7
	KeyF11 Key = 0xffc8
	KeyF12 Key = 0xffc9

	KeyA Key = 0x0061
	KeyB Key = 0x0062
	KeyC Key = 0x0063
	KeyD Key = 0x0064
	KeyE Key = 0x0065
	KeyF Key = 0x0066
	KeyG Key = 0x0067
	KeyH Key = 0x0068
	KeyI Key = 0x0069
	KeyJ Key = 0x006a
	KeyK Key = 0x006b
	KeyL Key = 0x006c
	KeyM Key = 0x006d
	KeyN Key = 0x006e
	KeyO Key = 0x006f
	KeyP Key = 0x0070
	KeyQ Key = 0x0071
	KeyR Key = 0x0072
	KeyS Key = 0x0073
	KeyT Key = 0x0074
	KeyU Key = 0x0075
	KeyV Key = 0x0076
	KeyW Key = 0x0077
	KeyX Key = 0x0078
	KeyY Key = 0x0079
	KeyZ Key = 0x007a

	Key0 Key = 0x0030
	Key1 Key = 0x0031
	Key2 Key = 0x0032
	Key3 Key = 0x0033
	Key4 Key = 0x0034
	Key5 Key = 0x0035
	Key6 Key = 0x0036
	Key7 Key = 0x0037
	Key8 Key = 0x0038
	Key9 Key = 0x0039
)

//export encountyKeyDown
func encountyKeyDown(h C.uintptr_t) {
	nk := cgo.Handle(uintptr(h)).Value().(*nativeKey)
	select {
	case nk.ch <- struct{}{}:
	default:
	}
}

// nativeKey holds a single X11 hotkey registration with pipe-based cancellation.
type nativeKey struct {
	cancelPipe [2]int
	done       chan struct{}
	ch         chan struct{}
}

func newNativeKey() *nativeKey {
	return &nativeKey{
		done: make(chan struct{}),
		ch:   make(chan struct{}, 64),
	}
}

// start grabs the key and begins listening. Returns immediately.
func (nk *nativeKey) start(mods []Modifier, key Key) error {
	if err := syscall.Pipe(nk.cancelPipe[:]); err != nil {
		return err
	}
	var mod Modifier
	for _, m := range mods {
		mod |= m
	}
	go nk.handle(mod, key)
	return nil
}

func (nk *nativeKey) handle(mod Modifier, key Key) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	h := cgo.NewHandle(nk)
	defer h.Delete()
	C.grabAndListen(C.uintptr_t(h), C.uint(mod), C.int(key), C.int(nk.cancelPipe[0]))
	close(nk.ch)
	close(nk.done)
}

// stop releases the X11 grab immediately (non-blocking on the caller).
func (nk *nativeKey) stop() {
	syscall.Write(nk.cancelPipe[1], []byte{0}) //nolint:errcheck
	<-nk.done
	syscall.Close(nk.cancelPipe[0]) //nolint:errcheck
	syscall.Close(nk.cancelPipe[1]) //nolint:errcheck
}

func (nk *nativeKey) keydown() <-chan struct{} { return nk.ch }
