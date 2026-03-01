//go:build linux || windows

package hotkeys

import (
	"fmt"
	"log"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/zsleyer/encounty/internal/state"
)

type Manager struct {
	mu         sync.Mutex
	registered map[string]*nativeKey
	actions    chan Action
	stateMgr   *state.Manager
	paused     atomic.Bool
}

func New(stateMgr *state.Manager) *Manager {
	return &Manager{
		registered: make(map[string]*nativeKey),
		actions:    make(chan Action, 32),
		stateMgr:   stateMgr,
	}
}

func (m *Manager) Actions() <-chan Action {
	return m.actions
}

func (m *Manager) Start() {
	hkMap := m.stateMgr.GetState().Hotkeys
	m.register(hkMap)
}

func (m *Manager) Reload(hkMap state.HotkeyMap, stateMgr *state.Manager) {
	m.mu.Lock()
	m.stateMgr = stateMgr
	m.mu.Unlock()
	// If paused, skip re-registration now; Resume() will apply the new state.
	if m.paused.Load() {
		return
	}
	m.unregisterAll()
	m.register(hkMap)
}

func (m *Manager) Stop() {
	m.unregisterAll()
}

// Pause unregisters all hotkeys immediately (non-blocking) so the OS delivers
// key events to the focused application (browser). Idempotent.
func (m *Manager) Pause() {
	if !m.paused.Swap(true) {
		m.unregisterAll()
		log.Println("Hotkeys paused")
	}
}

// Resume re-registers all hotkeys from the current state. Idempotent.
func (m *Manager) Resume() {
	if m.paused.Swap(false) {
		hkMap := m.stateMgr.GetState().Hotkeys
		m.register(hkMap)
		log.Println("Hotkeys resumed")
	}
}

func (m *Manager) register(hkMap state.HotkeyMap) {
	bindings := map[string]string{
		"increment": hkMap.Increment,
		"decrement": hkMap.Decrement,
		"reset":     hkMap.Reset,
		"next":      hkMap.NextPokemon,
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	for actionType, keyStr := range bindings {
		if keyStr == "" {
			continue
		}
		mods, key, err := parseKey(keyStr)
		if err != nil {
			log.Printf("hotkey parse error for %q: %v", keyStr, err)
			continue
		}
		nk := newNativeKey()
		if err := nk.start(mods, key); err != nil {
			log.Printf("hotkey register error for %q (%s): %v", keyStr, actionType, err)
			continue
		}
		m.registered[actionType] = nk
		go m.listen(nk, actionType)
	}
}

func (m *Manager) listen(nk *nativeKey, actionType string) {
	for range nk.keydown() {
		if m.paused.Load() {
			continue
		}
		var pid string
		if active := m.stateMgr.GetActivePokemon(); active != nil {
			pid = active.ID
		}
		m.actions <- Action{Type: actionType, PokemonID: pid}
	}
}

func (m *Manager) unregisterAll() {
	m.mu.Lock()
	old := m.registered
	m.registered = make(map[string]*nativeKey)
	m.mu.Unlock()

	// Stop outside the lock so we don't block while holding it.
	for _, nk := range old {
		nk.stop()
	}
}

// parseKey converts a string like "F1", "Ctrl+Shift+A" into hotkey modifiers and key.
func parseKey(s string) ([]Modifier, Key, error) {
	parts := strings.Split(strings.ToLower(s), "+")
	keyStr := parts[len(parts)-1]
	modStrs := parts[:len(parts)-1]

	var mods []Modifier
	for _, mod := range modStrs {
		switch strings.TrimSpace(mod) {
		case "ctrl", "control":
			mods = append(mods, ModCtrl)
		case "shift":
			mods = append(mods, ModShift)
		case "alt":
			mods = append(mods, modAlt())
		}
	}

	key, ok := keyMap[strings.TrimSpace(keyStr)]
	if !ok {
		return nil, 0, fmt.Errorf("unknown key: %q", keyStr)
	}
	return mods, key, nil
}

var keyMap = map[string]Key{
	"f1":  KeyF1,
	"f2":  KeyF2,
	"f3":  KeyF3,
	"f4":  KeyF4,
	"f5":  KeyF5,
	"f6":  KeyF6,
	"f7":  KeyF7,
	"f8":  KeyF8,
	"f9":  KeyF9,
	"f10": KeyF10,
	"f11": KeyF11,
	"f12": KeyF12,
	"a":   KeyA,
	"b":   KeyB,
	"c":   KeyC,
	"d":   KeyD,
	"e":   KeyE,
	"f":   KeyF,
	"g":   KeyG,
	"h":   KeyH,
	"i":   KeyI,
	"j":   KeyJ,
	"k":   KeyK,
	"l":   KeyL,
	"m":   KeyM,
	"n":   KeyN,
	"o":   KeyO,
	"p":   KeyP,
	"q":   KeyQ,
	"r":   KeyR,
	"s":   KeyS,
	"t":   KeyT,
	"u":   KeyU,
	"v":   KeyV,
	"w":   KeyW,
	"x":   KeyX,
	"y":   KeyY,
	"z":   KeyZ,
	"0":   Key0,
	"1":   Key1,
	"2":   Key2,
	"3":   Key3,
	"4":   Key4,
	"5":   Key5,
	"6":   Key6,
	"7":   Key7,
	"8":   Key8,
	"9":   Key9,
}
