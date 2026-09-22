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
	bindings    []resolvedBinding
	msgThreadID uint32
	// registered maps a Win32 hotkey ID to every binding index that shares the
	// registered combo. Win32 refuses a second RegisterHotKey for the same
	// combo on the same thread, so one ID has to serve all bindings that use it.
	registered map[int][]int
	nextID     int
	ctx        chan struct{} // closed by Stop()
	readyCh    chan struct{} // closed once msgThreadID is set
}

// New returns a Manager backed by Win32 RegisterHotKey.
func New(stateMgr *state.Manager) Manager {
	return &windowsManager{
		stateMgr:   stateMgr,
		actions:    make(chan Action, 64),
		registered: make(map[int][]int),
		ctx:        make(chan struct{}),
		readyCh:    make(chan struct{}),
	}
}

func (m *windowsManager) Actions() <-chan Action { return m.actions }

func (m *windowsManager) IsAvailable() bool { return true }

func (m *windowsManager) Start() error {
	m.loadBindings(m.stateMgr.HotkeyBindings())
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

// UpdateAllBindings replaces all bindings atomically and re-registers them.
func (m *windowsManager) UpdateAllBindings(bindings []state.HotkeyBinding) error {
	m.loadBindings(bindings)
	if !m.paused.Load() {
		m.postThread(wmReregister, 0, 0)
	}
	return nil
}

// loadBindings resolves the bindings and replaces the internal slice. The
// Win32 registrations are refreshed separately from the message-loop thread,
// which is the only thread allowed to call RegisterHotKey for this queue.
func (m *windowsManager) loadBindings(bindings []state.HotkeyBinding) {
	next := resolveBindings(bindings)
	m.mu.Lock()
	m.bindings = next
	m.mu.Unlock()
}

// bindingsForID returns the bindings registered under a Win32 hotkey ID.
// Indices are bounds-checked because a binding update swaps the slice before
// the message loop gets to process the re-registration that follows it.
func (m *windowsManager) bindingsForID(id int) []resolvedBinding {
	m.mu.RLock()
	defer m.mu.RUnlock()
	idxs := m.registered[id]
	out := make([]resolvedBinding, 0, len(idxs))
	for _, idx := range idxs {
		if idx >= 0 && idx < len(m.bindings) {
			out = append(out, m.bindings[idx])
		}
	}
	return out
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
			if m.paused.Load() {
				continue
			}
			for _, b := range m.bindingsForID(int(msg.wParam)) {
				select {
				case m.actions <- actionFor(m.stateMgr, b):
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
// Bindings sharing a combo are registered once and collected under that one
// hotkey ID: Win32 rejects a duplicate registration from the same thread, and
// a per-hunt key is expected to coexist with an identical global key.
// Must be called from the message-loop goroutine.
func (m *windowsManager) doRegisterAll() {
	m.mu.Lock()
	defer m.mu.Unlock()

	idByCombo := make(map[KeyCombo]int, len(m.bindings))
	for idx, b := range m.bindings {
		if id, ok := idByCombo[b.combo]; ok {
			m.registered[id] = append(m.registered[id], idx)
			continue
		}
		vk, ok := keyNameToVK[b.combo.Key]
		if !ok {
			continue
		}
		mods := modNoRepeat
		if b.combo.Ctrl {
			mods |= modCtrl
		}
		if b.combo.Shift {
			mods |= modShift
		}
		if b.combo.Alt {
			mods |= modAlt
		}
		id := m.nextID
		m.nextID++
		ret, _, err := procRegisterHotKey.Call(0, uintptr(id), uintptr(mods), uintptr(vk))
		if ret == 0 {
			slog.Error("Hotkeys: RegisterHotKey failed", "action", b.action, "combo", b.combo.Key, "error", err)
			continue
		}
		idByCombo[b.combo] = id
		m.registered[id] = []int{idx}
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
	m.registered = make(map[int][]int)
}

// postThread sends a message to the message-loop thread.
func (m *windowsManager) postThread(msg, wParam, lParam uintptr) {
	if m.msgThreadID == 0 {
		return
	}
	// A lost post means the loop never sees a rebind or stop request, so it has
	// to show up in the log instead of vanishing.
	if ret, _, err := procPostThreadMessageW.Call(uintptr(m.msgThreadID), msg, wParam, lParam); ret == 0 {
		slog.Warn("Hotkeys: PostThreadMessage failed", "msg", msg, "error", err)
	}
}
