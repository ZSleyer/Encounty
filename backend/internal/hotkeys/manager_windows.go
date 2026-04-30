//go:build windows

// manager_windows.go implements the hotkeys.Manager interface using the Win32
// RegisterHotKey API. All hotkey registration and message dispatch runs on a
// single OS-locked goroutine that owns a Win32 message queue. Other goroutines
// communicate with it via PostThreadMessage to avoid thread-safety issues with
// Win32 message loops.
package hotkeys

import (
	"log/slog"
	"runtime"
	"sync"
	"sync/atomic"
	"syscall"
	"unsafe"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// Win32 message constants
const (
	wmHotkey     = 0x0312
	wmQuit       = 0x0012
	wmReregister = 0x0401 // WM_USER+1: unregister all, then re-register all
	wmUnregister = 0x0402 // WM_USER+2: unregister all
)

// msg mirrors the Win32 MSG structure layout on 64-bit Windows.
// Go aligns uintptr to 8 bytes, inserting 4 bytes padding after the uint32 field.
type winMsg struct {
	hwnd    syscall.Handle
	message uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	pt      struct{ x, y int32 }
}

var (
	user32   = syscall.NewLazyDLL("user32.dll")
	kernel32 = syscall.NewLazyDLL("kernel32.dll")

	procRegisterHotKey     = user32.NewProc("RegisterHotKey")
	procUnregisterHotKey   = user32.NewProc("UnregisterHotKey")
	procGetMessageW        = user32.NewProc("GetMessageW")
	procPostThreadMessageW = user32.NewProc("PostThreadMessageW")
	procGetCurrentThreadId = kernel32.NewProc("GetCurrentThreadId")
)

type windowsManager struct {
	stateMgr    *state.Manager
	actions     chan Action
	paused      atomic.Bool
	mu          sync.RWMutex
	bindings    map[string]KeyCombo // action → combo
	msgThreadID uint32
	registered  map[int]string // hotkey ID → action name
	nextID      int
	ctx         chan struct{} // closed by Stop()
	readyCh     chan struct{} // closed once msgThreadID is set
}

// New returns a Manager backed by Win32 RegisterHotKey.
func New(stateMgr *state.Manager) Manager {
	return &windowsManager{
		stateMgr:   stateMgr,
		actions:    make(chan Action, 64),
		bindings:   make(map[string]KeyCombo),
		registered: make(map[int]string),
		ctx:        make(chan struct{}),
		readyCh:    make(chan struct{}),
	}
}

func (m *windowsManager) Actions() <-chan Action { return m.actions }

func (m *windowsManager) IsAvailable() bool { return true }

func (m *windowsManager) Start() error {
	m.loadBindings(m.stateMgr.GetState().Hotkeys)
	go m.messageLoop()
	<-m.readyCh // wait until the Win32 thread ID is known
	return nil
}

func (m *windowsManager) Stop() {
	select {
	case <-m.ctx:
	default:
		close(m.ctx)
	}
	m.postThread(wmQuit, 0, 0)
}

func (m *windowsManager) SetPaused(paused bool) {
	m.paused.Store(paused)
	if paused {
		m.postThread(wmUnregister, 0, 0)
	} else {
		m.postThread(wmReregister, 0, 0)
	}
}

func (m *windowsManager) UpdateBinding(action, keyCombo string) error {
	if keyCombo == "" {
		m.mu.Lock()
		delete(m.bindings, action)
		m.mu.Unlock()
	} else {
		combo, err := ValidateKeyCombo(keyCombo)
		if err != nil {
			return err
		}
		m.mu.Lock()
		m.bindings[action] = combo
		m.mu.Unlock()
	}
	if !m.paused.Load() {
		m.postThread(wmReregister, 0, 0)
	}
	return nil
}

func (m *windowsManager) UpdateAllBindings(hm state.HotkeyMap) error {
	m.loadBindings(hm)
	if !m.paused.Load() {
		m.postThread(wmReregister, 0, 0)
	}
	return nil
}

func (m *windowsManager) loadBindings(hm state.HotkeyMap) {
	raw := map[string]string{
		"increment":   hm.Increment,
		"decrement":   hm.Decrement,
		"reset":       hm.Reset,
		"next":        hm.NextPokemon,
		"hunt_toggle": hm.HuntToggle,
	}
	next := make(map[string]KeyCombo, len(raw))
	for action, combo := range raw {
		if combo == "" {
			continue
		}
		kc, err := ParseKeyCombo(combo)
		if err != nil {
			slog.Warn("Hotkeys: parse error", "combo", combo, "action", action, "error", err)
			continue
		}
		if platformValidateKey(kc.Key) != nil {
			slog.Warn("Hotkeys: unknown key", "key", kc.Key, "combo", combo, "action", action)
			continue
		}
		next[action] = kc
	}
	m.mu.Lock()
	m.bindings = next
	m.mu.Unlock()
}

// messageLoop runs on a locked OS thread and processes Win32 messages.
func (m *windowsManager) messageLoop() {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	tid, _, _ := procGetCurrentThreadId.Call()
	m.msgThreadID = uint32(tid)
	close(m.readyCh)

	m.doRegisterAll()

	var msg winMsg
	for {
		ret, _, _ := procGetMessageW.Call(
			uintptr(unsafe.Pointer(&msg)),
			0, 0, 0,
		)
		if ret == 0 { // WM_QUIT
			break
		}
		switch msg.message {
		case wmHotkey:
			id := int(msg.wParam)
			m.mu.RLock()
			action, ok := m.registered[id]
			m.mu.RUnlock()
			if ok && !m.paused.Load() {
				var pid string
				if active := m.stateMgr.GetActivePokemon(); active != nil {
					pid = active.ID
				}
				select {
				case m.actions <- Action{Type: action, PokemonID: pid}:
				default:
				}
			}
		case wmReregister:
			m.doUnregisterAll()
			m.doRegisterAll()
		case wmUnregister:
			m.doUnregisterAll()
		case wmQuit:
			return
		}
	}
	m.doUnregisterAll()
}

// doRegisterAll registers all current bindings via Win32 RegisterHotKey.
// Must be called from the message-loop goroutine.
func (m *windowsManager) doRegisterAll() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for action, combo := range m.bindings {
		vk, ok := keyNameToVK[combo.Key]
		if !ok {
			continue
		}
		mods := modNoRepeat
		if combo.Ctrl {
			mods |= modCtrl
		}
		if combo.Shift {
			mods |= modShift
		}
		if combo.Alt {
			mods |= modAlt
		}
		id := m.nextID
		m.nextID++
		ret, _, err := procRegisterHotKey.Call(0, uintptr(id), uintptr(mods), uintptr(vk))
		if ret == 0 {
			slog.Error("Hotkeys: RegisterHotKey failed", "action", action, "error", err)
			continue
		}
		m.registered[id] = action
	}
}

// doUnregisterAll unregisters all Win32 hotkeys.
// Must be called from the message-loop goroutine.
func (m *windowsManager) doUnregisterAll() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for id := range m.registered {
		procUnregisterHotKey.Call(0, uintptr(id)) //nolint:errcheck
	}
	m.registered = make(map[int]string)
}

// postThread sends a message to the message-loop thread.
func (m *windowsManager) postThread(msg, wParam, lParam uintptr) {
	if m.msgThreadID == 0 {
		return
	}
	procPostThreadMessageW.Call(uintptr(m.msgThreadID), msg, wParam, lParam)
}
