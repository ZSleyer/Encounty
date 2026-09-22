//go:build linux

// manager_linux.go implements the hotkeys.Manager interface using Linux evdev.
// It opens every /dev/input/event* device that reports EV_KEY events and reads
// raw input_event structs directly, avoiding the need for any display server.
// Note: the user must have read permission on /dev/input/event* (typically via
// the "input" group) for hotkeys to work.
package hotkeys

import (
	"context"
	"encoding/binary"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"syscall"
	"unsafe"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// EVIOCGBIT(0, 1), reads 1 byte of the event-type bitmap.
// Calculated as: _IOC(_IOC_READ=2, 'E'=0x45, 0x20+ev=0x20, len=1)
//
//	= (2 << 30) | (0x45 << 8) | 0x20 | (1 << 16)
//	= 0x80014520
const eviocgbitTypes = uintptr(0x80014520)

// evtype and value constants from input-event-codes.h
const (
	evTypKey   = 1 // EV_KEY
	evValPress = 1 // key pressed
)

type linuxManager struct {
	stateMgr  *state.Manager
	actions   chan Action
	paused    atomic.Bool
	mu        sync.RWMutex
	bindings  []resolvedBinding
	ctx       context.Context
	cancel    context.CancelFunc
	available bool
}

// New returns a Manager backed by Linux evdev.
func New(stateMgr *state.Manager) Manager {
	ctx, cancel := context.WithCancel(context.Background())
	return &linuxManager{
		stateMgr: stateMgr,
		actions:  make(chan Action, 64),
		ctx:      ctx,
		cancel:   cancel,
	}
}

func (m *linuxManager) Actions() <-chan Action { return m.actions }

func (m *linuxManager) IsAvailable() bool { return m.available }

func (m *linuxManager) Start() error {
	m.loadBindings(m.stateMgr.HotkeyBindings())

	devs, err := findKeyboardDevices()
	if err != nil {
		slog.Warn("Hotkeys: device enumeration error", "error", err)
	}
	if len(devs) == 0 {
		m.available = false
		return nil // non-fatal: app works without global hotkeys
	}

	m.available = true
	for _, dev := range devs {
		go m.readDevice(dev)
	}
	return nil
}

func (m *linuxManager) Stop() {
	m.cancel()
}

func (m *linuxManager) SetPaused(paused bool) {
	m.paused.Store(paused)
}

func (m *linuxManager) UpdateAllBindings(bindings []state.HotkeyBinding) error {
	m.loadBindings(bindings)
	return nil
}

// loadBindings resolves the bindings and replaces the internal slice.
func (m *linuxManager) loadBindings(bindings []state.HotkeyBinding) {
	next := resolveBindings(bindings)
	m.mu.Lock()
	m.bindings = next
	m.mu.Unlock()
}

// findKeyboardDevices returns paths to /dev/input/event* devices that support EV_KEY.
func findKeyboardDevices() ([]string, error) {
	paths, err := filepath.Glob("/dev/input/event*")
	if err != nil {
		return nil, err
	}
	var keyboards []string
	for _, p := range paths {
		f, err := os.OpenFile(p, os.O_RDONLY, 0)
		if err != nil {
			// Permission denied or busy, skip silently
			continue
		}
		var evBits [1]byte
		_, _, errno := syscall.Syscall(syscall.SYS_IOCTL, f.Fd(), eviocgbitTypes, uintptr(unsafe.Pointer(&evBits[0])))
		_ = f.Close()
		if errno != 0 {
			continue
		}
		if evBits[0]&(1<<evTypKey) != 0 {
			keyboards = append(keyboards, p)
		}
	}
	return keyboards, nil
}

// modifierState tracks which modifier keys are currently held down on an evdev device.
type modifierState struct {
	ctrl  bool
	shift bool
	alt   bool
}

// updateModifier updates the modifier state for the given key code and returns
// true if the code was a modifier key (meaning the event should not be
// processed further as a hotkey trigger).
func (ms *modifierState) updateModifier(code uint16, value int32) bool {
	switch code {
	case evKeyLeftCtrl, evKeyRightCtrl:
		ms.ctrl = value != 0
		return true
	case evKeyLeftShift, evKeyRightShift:
		ms.shift = value != 0
		return true
	case evKeyLeftAlt, evKeyRightAlt:
		ms.alt = value != 0
		return true
	}
	return false
}

// matchAndDispatch checks the pressed key code against all bindings and
// dispatches a non-blocking action for every matching combo. All matches fire,
// not just the first: the same combo may be bound globally and pinned to a
// hunt at the same time, and both bindings are meant to run.
func (m *linuxManager) matchAndDispatch(code uint16, mods modifierState) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, b := range m.bindings {
		evCode, ok := keyNameToEvKey[b.combo.Key]
		if !ok || evCode != code {
			continue
		}
		if b.combo.Ctrl != mods.ctrl || b.combo.Shift != mods.shift || b.combo.Alt != mods.alt {
			continue
		}
		select {
		case m.actions <- actionFor(m.stateMgr, b):
		default:
		}
	}
}

// readDevice reads input events from a single evdev device until the context is canceled.
func (m *linuxManager) readDevice(path string) {
	f, err := os.OpenFile(path, os.O_RDONLY, 0)
	if err != nil {
		return
	}

	// Close the file when the context is done to unblock the blocking Read below.
	go func() {
		<-m.ctx.Done()
		_ = f.Close()
	}()

	var mods modifierState
	buf := make([]byte, 24)
	for {
		_, err := io.ReadFull(f, buf)
		if err != nil {
			return
		}

		typ := binary.LittleEndian.Uint16(buf[16:18])
		code := binary.LittleEndian.Uint16(buf[18:20])
		value := int32(binary.LittleEndian.Uint32(buf[20:24]))

		if typ != evTypKey {
			continue
		}
		if mods.updateModifier(code, value) {
			continue
		}
		if value != evValPress || m.paused.Load() {
			continue
		}

		m.matchAndDispatch(code, mods)
	}
}
