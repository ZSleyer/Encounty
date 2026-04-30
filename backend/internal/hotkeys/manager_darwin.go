//go:build darwin

// manager_darwin.go implements the hotkeys.Manager interface using macOS
// CGEventTap from the Core Graphics framework. It creates a passive event
// tap that observes key-down events system-wide, requiring the Accessibility
// permission (Privacy & Security → Accessibility) to be granted. If the
// permission is not granted the manager degrades gracefully — the app works
// without global hotkeys.
package hotkeys

/*
#cgo LDFLAGS: -framework CoreGraphics -framework CoreFoundation

#include <CoreGraphics/CoreGraphics.h>
#include <CoreFoundation/CoreFoundation.h>

// Forward declaration of the Go callback trampoline.
extern CGEventRef goEventCallback(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void *userInfo);

// createEventTap creates a CGEventTap for key-down and flags-changed events.
// Returns NULL on failure. Uses NULL as userInfo since the Go callback
// routes events through the globalDarwinMgr singleton.
static CFMachPortRef createTap(void) {
    CGEventMask mask = (1 << kCGEventKeyDown) | (1 << kCGEventFlagsChanged);
    CFMachPortRef tap = CGEventTapCreate(
        kCGSessionEventTap,
        kCGHeadInsertEventTap,
        kCGEventTapOptionListenOnly,
        mask,
        (CGEventTapCallBack)goEventCallback,
        NULL
    );
    return tap;
}

// runLoopAddAndRun adds the tap to the current thread's run loop and starts it.
// This function blocks until CFRunLoopStop is called.
static void runLoopAddAndRun(CFMachPortRef tap) {
    CFRunLoopSourceRef src = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0);
    CFRunLoopAddSource(CFRunLoopGetCurrent(), src, kCFRunLoopCommonModes);
    CGEventTapEnable(tap, true);
    CFRunLoopRun();
    CFRelease(src);
}
*/
import "C"

import (
	"context"
	"log/slog"
	"os"
	"runtime"
	"sync"
	"sync/atomic"
	"unsafe"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// darwinManager implements Manager using macOS CGEventTap.
type darwinManager struct {
	stateMgr  *state.Manager
	actions   chan Action
	paused    atomic.Bool
	mu        sync.RWMutex
	bindings  map[string]KeyCombo
	ctx       context.Context
	cancel    context.CancelFunc
	available bool
	tap       C.CFMachPortRef
	runLoop   C.CFRunLoopRef
	mods      darwinModifierState
}

// darwinModifierState tracks which modifier keys are currently held.
type darwinModifierState struct {
	ctrl  bool
	shift bool
	alt   bool
	cmd   bool
}

// globalDarwinMgr is the singleton reference used by the C callback trampoline
// to route events back into Go. Only one event tap is active per process.
var globalDarwinMgr *darwinManager

// keyChan is a buffered channel used by the C callback to send key events
// into Go-managed goroutines without blocking the CFRunLoop thread.
var keyChan = make(chan darwinKeyEvent, 128)

// darwinKeyEvent carries a key code and the CGEventFlags at the time of the event.
type darwinKeyEvent struct {
	keyCode uint16
	flags   C.CGEventFlags
	isKey   bool // true for kCGEventKeyDown, false for kCGEventFlagsChanged
}

// New returns a Manager backed by macOS CGEventTap.
func New(stateMgr *state.Manager) Manager {
	ctx, cancel := context.WithCancel(context.Background())
	m := &darwinManager{
		stateMgr: stateMgr,
		actions:  make(chan Action, 64),
		bindings: make(map[string]KeyCombo),
		ctx:      ctx,
		cancel:   cancel,
	}
	globalDarwinMgr = m
	return m
}

func (m *darwinManager) Actions() <-chan Action { return m.actions }

func (m *darwinManager) IsAvailable() bool { return m.available }

// Start creates the CGEventTap and begins listening for key events.
// Returns nil even if the Accessibility permission is not granted — the
// manager simply reports itself as unavailable in that case.
func (m *darwinManager) Start() error {
	m.loadBindings(m.stateMgr.GetState().Hotkeys)

	// In Electron mode, the Electron main process handles hotkey registration
	// via globalShortcut and relays actions to the backend over HTTP. The Go
	// child process cannot create a CGEventTap because macOS grants Accessibility
	// permission to the parent Electron app, not the embedded binary.
	if os.Getenv("ENCOUNTY_ELECTRON") == "1" {
		m.available = false
		slog.Info("Hotkeys: Electron mode — native hotkeys disabled, Electron handles registration")
		return nil
	}

	// Attempt to create the event tap directly. On macOS, CGEventTapCreate
	// checks the "responsible process" (parent app bundle) for Accessibility
	// permission, which works correctly when running inside an Electron .app
	// bundle — unlike AXIsProcessTrusted() which only checks the calling binary.
	tap := C.createTap()
	if tap == 0 {
		m.available = false
		slog.Warn("Hotkeys: failed to create CGEventTap (Accessibility permission not granted?) — global hotkeys disabled")
		return nil
	}
	m.tap = tap
	m.available = true

	// Start the CFRunLoop on a dedicated OS thread (required by Core Graphics).
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		// Store a reference to this thread's run loop so Stop() can interrupt it.
		m.runLoop = C.CFRunLoopGetCurrent()
		C.runLoopAddAndRun(m.tap)
	}()

	// Start event processing goroutine.
	go m.processKeyEvents()

	return nil
}

// Stop invalidates the event tap and stops the run loop.
func (m *darwinManager) Stop() {
	m.cancel()
	if m.tap != 0 {
		C.CGEventTapEnable(m.tap, C.bool(false))
	}
	if m.runLoop != 0 {
		C.CFRunLoopStop(m.runLoop)
	}
}

// SetPaused pauses or resumes hotkey dispatch. When paused, the event tap
// remains active but events are discarded.
func (m *darwinManager) SetPaused(paused bool) {
	m.paused.Store(paused)
	if m.tap != 0 {
		C.CGEventTapEnable(m.tap, C.bool(!paused))
	}
}

// UpdateBinding replaces a single action's key binding at runtime.
func (m *darwinManager) UpdateBinding(action, keyCombo string) error {
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

// UpdateAllBindings replaces all bindings atomically.
func (m *darwinManager) UpdateAllBindings(hm state.HotkeyMap) error {
	m.loadBindings(hm)
	return nil
}

// loadBindings parses the HotkeyMap and replaces the internal bindings map.
func (m *darwinManager) loadBindings(hm state.HotkeyMap) {
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

// updateModifiersFromFlags extracts the current modifier state from CGEventFlags.
func (m *darwinManager) updateModifiersFromFlags(flags C.CGEventFlags) {
	m.mods.ctrl = (flags & C.kCGEventFlagMaskControl) != 0
	m.mods.shift = (flags & C.kCGEventFlagMaskShift) != 0
	m.mods.alt = (flags & C.kCGEventFlagMaskAlternate) != 0
	m.mods.cmd = (flags & C.kCGEventFlagMaskCommand) != 0
}

// matchAndDispatch checks the pressed key code against all bindings and
// dispatches a non-blocking action for the first matching combo.
func (m *darwinManager) matchAndDispatch(code uint16) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for action, combo := range m.bindings {
		cgCode, ok := keyNameToCGKeyCode[combo.Key]
		if !ok || cgCode != code {
			continue
		}
		if combo.Ctrl != m.mods.ctrl || combo.Shift != m.mods.shift || combo.Alt != m.mods.alt {
			continue
		}
		var pid string
		if active := m.stateMgr.GetActivePokemon(); active != nil {
			pid = active.ID
		}
		select {
		case m.actions <- Action{Type: action, PokemonID: pid}:
		default:
		}
	}
}

// processKeyEvents reads from the keyChan and processes events.
func (m *darwinManager) processKeyEvents() {
	for {
		select {
		case <-m.ctx.Done():
			return
		case ev := <-keyChan:
			m.updateModifiersFromFlags(ev.flags)
			if ev.isKey && !m.paused.Load() {
				m.matchAndDispatch(ev.keyCode)
			}
		}
	}
}

// goEventCallback is the CGEventTap callback trampoline invoked from C.
// It extracts the key code and flags and sends them to the Go processing
// goroutine via a channel to avoid blocking the CFRunLoop.
//
//export goEventCallback
func goEventCallback(proxy C.CGEventTapProxy, etype C.CGEventType, event C.CGEventRef, userInfo unsafe.Pointer) C.CGEventRef {
	switch etype {
	case C.kCGEventKeyDown:
		keyCode := uint16(C.CGEventGetIntegerValueField(event, C.kCGKeyboardEventKeycode))
		flags := C.CGEventGetFlags(event)
		select {
		case keyChan <- darwinKeyEvent{keyCode: keyCode, flags: flags, isKey: true}:
		default:
		}
	case C.kCGEventFlagsChanged:
		flags := C.CGEventGetFlags(event)
		select {
		case keyChan <- darwinKeyEvent{flags: flags, isKey: false}:
		default:
		}
	case C.kCGEventTapDisabledByTimeout, C.kCGEventTapDisabledByUserInput:
		// Re-enable the tap if the system disabled it.
		if globalDarwinMgr != nil && globalDarwinMgr.tap != 0 {
			C.CGEventTapEnable(globalDarwinMgr.tap, C.bool(true))
		}
	}
	return event
}
