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
	"log"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"syscall"
	"unsafe"

	"github.com/zsleyer/encounty/internal/state"
)

// EVIOCGBIT(0, 1) — reads 1 byte of the event-type bitmap.
// Calculated as: _IOC(_IOC_READ=2, 'E'=0x45, 0x20+ev=0x20, len=1)
//   = (2 << 30) | (0x45 << 8) | 0x20 | (1 << 16)
//   = 0x80014520
const eviocgbitTypes = uintptr(0x80014520)

// evtype and value constants from input-event-codes.h
const (
	evTypKey   = 1    // EV_KEY
	evValPress = 1    // key pressed
)

// inputEvent mirrors the Linux struct input_event (24 bytes on 64-bit).
type inputEvent struct {
	Sec   int64
	Usec  int64
	Type  uint16
	Code  uint16
	Value int32
}

type linuxManager struct {
	stateMgr  *state.Manager
	actions   chan Action
	paused    atomic.Bool
	mu        sync.RWMutex
	bindings  map[string]KeyCombo // action → combo
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
		bindings: make(map[string]KeyCombo),
		ctx:      ctx,
		cancel:   cancel,
	}
}

func (m *linuxManager) Actions() <-chan Action { return m.actions }

func (m *linuxManager) IsAvailable() bool { return m.available }

func (m *linuxManager) Start() error {
	m.loadBindings(m.stateMgr.GetState().Hotkeys)

	devs, err := findKeyboardDevices()
	if err != nil {
		log.Printf("hotkeys: device enumeration error: %v", err)
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

func (m *linuxManager) UpdateBinding(action, keyCombo string) error {
	if keyCombo == "" {
		m.mu.Lock()
		delete(m.bindings, action)
		m.mu.Unlock()
		return nil
	}
	combo, err := ValidateKeyCombo(keyCombo)
	if err != nil {
		return err
	}
	m.mu.Lock()
	m.bindings[action] = combo
	m.mu.Unlock()
	return nil
}

func (m *linuxManager) UpdateAllBindings(hm state.HotkeyMap) error {
	m.loadBindings(hm)
	return nil
}

// loadBindings parses the HotkeyMap and replaces the internal bindings map.
func (m *linuxManager) loadBindings(hm state.HotkeyMap) {
	raw := map[string]string{
		"increment": hm.Increment,
		"decrement": hm.Decrement,
		"reset":     hm.Reset,
		"next":      hm.NextPokemon,
	}
	next := make(map[string]KeyCombo, len(raw))
	for action, combo := range raw {
		if combo == "" {
			continue
		}
		kc, err := ParseKeyCombo(combo)
		if err != nil {
			log.Printf("hotkeys: parse error for %q (%s): %v", combo, action, err)
			continue
		}
		if platformValidateKey(kc.Key) != nil {
			log.Printf("hotkeys: unknown key %q in combo %q (%s)", kc.Key, combo, action)
			continue
		}
		next[action] = kc
	}
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
			// Permission denied or busy — skip silently
			continue
		}
		var evBits [1]byte
		_, _, errno := syscall.Syscall(syscall.SYS_IOCTL, f.Fd(), eviocgbitTypes, uintptr(unsafe.Pointer(&evBits[0])))
		f.Close()
		if errno != 0 {
			continue
		}
		if evBits[0]&(1<<evTypKey) != 0 {
			keyboards = append(keyboards, p)
		}
	}
	return keyboards, nil
}

// readDevice reads input events from a single evdev device until the context is cancelled.
func (m *linuxManager) readDevice(path string) {
	f, err := os.OpenFile(path, os.O_RDONLY, 0)
	if err != nil {
		return
	}

	// Close the file when the context is done to unblock the blocking Read below.
	go func() {
		<-m.ctx.Done()
		f.Close()
	}()

	var (
		ctrlHeld  bool
		shiftHeld bool
		altHeld   bool
	)

	buf := make([]byte, 24)
	for {
		_, err := io.ReadFull(f, buf)
		if err != nil {
			return // file closed or error
		}

		typ := binary.LittleEndian.Uint16(buf[16:18])
		code := binary.LittleEndian.Uint16(buf[18:20])
		value := int32(binary.LittleEndian.Uint32(buf[20:24]))

		if typ != evTypKey {
			continue
		}

		// Track modifier state
		switch code {
		case evKeyLeftCtrl, evKeyRightCtrl:
			ctrlHeld = value != 0
			continue
		case evKeyLeftShift, evKeyRightShift:
			shiftHeld = value != 0
			continue
		case evKeyLeftAlt, evKeyRightAlt:
			altHeld = value != 0
			continue
		}

		// Only act on key-press events
		if value != evValPress {
			continue
		}

		if m.paused.Load() {
			continue
		}

		m.mu.RLock()
		for action, combo := range m.bindings {
			evCode, ok := keyNameToEvKey[combo.Key]
			if !ok || evCode != code {
				continue
			}
			if combo.Ctrl != ctrlHeld || combo.Shift != shiftHeld || combo.Alt != altHeld {
				continue
			}
			// Match — deliver action non-blocking
			var pid string
			if active := m.stateMgr.GetActivePokemon(); active != nil {
				pid = active.ID
			}
			select {
			case m.actions <- Action{Type: action, PokemonID: pid}:
			default:
			}
		}
		m.mu.RUnlock()
	}
}
