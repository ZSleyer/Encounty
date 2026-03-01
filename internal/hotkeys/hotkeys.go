//go:build linux || windows

package hotkeys

import (
	"fmt"
	"log"
	"strings"
	"sync"
	"sync/atomic"

	"golang.design/x/hotkey"

	"github.com/zsleyer/encounty/internal/state"
)

type Manager struct {
	mu         sync.Mutex
	registered map[string]*hotkey.Hotkey
	actions    chan Action
	stateMgr   *state.Manager
	paused     atomic.Bool
}

func New(stateMgr *state.Manager) *Manager {
	return &Manager{
		registered: make(map[string]*hotkey.Hotkey),
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
	// If paused, the keys are already unregistered. Don't re-register now;
	// Resume() will pick up the new state when the user leaves the settings tab.
	if m.paused.Load() {
		return
	}
	m.unregisterAll()
	m.register(hkMap)
}

func (m *Manager) Stop() {
	m.unregisterAll()
}

// Pause unregisters all hotkeys so the OS delivers key events to the focused
// application (browser). Called when entering the hotkeys or overlay settings tab.
// Idempotent: only acts if currently running.
func (m *Manager) Pause() {
	if !m.paused.Swap(true) {
		m.unregisterAll()
		log.Println("Hotkeys paused")
	}
}

// Resume re-registers all hotkeys from the current state.
// Idempotent: only acts if currently paused.
func (m *Manager) Resume() {
	if m.paused.Swap(false) {
		hkMap := m.stateMgr.GetState().Hotkeys
		m.register(hkMap)
		log.Println("Hotkeys resumed")
	}
}

func (m *Manager) register(hkMap state.HotkeyMap) {
	m.mu.Lock()
	defer m.mu.Unlock()

	bindings := map[string]string{
		"increment": hkMap.Increment,
		"decrement": hkMap.Decrement,
		"reset":     hkMap.Reset,
		"next":      hkMap.NextPokemon,
	}

	for actionType, keyStr := range bindings {
		if keyStr == "" {
			continue
		}
		mods, key, err := parseKey(keyStr)
		if err != nil {
			log.Printf("hotkey parse error for %q: %v", keyStr, err)
			continue
		}
		hk := hotkey.New(mods, key)
		if err := hk.Register(); err != nil {
			log.Printf("hotkey register error for %q (%s): %v", keyStr, actionType, err)
			continue
		}
		m.registered[actionType] = hk
		go m.listen(hk, actionType)
	}
}

func (m *Manager) listen(hk *hotkey.Hotkey, actionType string) {
	for range hk.Keydown() {
		if m.paused.Load() {
			continue // muted while overlay editor is open
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
	defer m.mu.Unlock()
	for _, hk := range m.registered {
		hk.Unregister()
	}
	m.registered = make(map[string]*hotkey.Hotkey)
}

// parseKey converts a string like "F1", "Ctrl+Shift+A" into hotkey modifiers and key.
func parseKey(s string) ([]hotkey.Modifier, hotkey.Key, error) {
	parts := strings.Split(strings.ToLower(s), "+")
	keyStr := parts[len(parts)-1]
	modStrs := parts[:len(parts)-1]

	var mods []hotkey.Modifier
	for _, mod := range modStrs {
		switch strings.TrimSpace(mod) {
		case "ctrl", "control":
			mods = append(mods, hotkey.ModCtrl)
		case "shift":
			mods = append(mods, hotkey.ModShift)
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

var keyMap = map[string]hotkey.Key{
	"f1":  hotkey.KeyF1,
	"f2":  hotkey.KeyF2,
	"f3":  hotkey.KeyF3,
	"f4":  hotkey.KeyF4,
	"f5":  hotkey.KeyF5,
	"f6":  hotkey.KeyF6,
	"f7":  hotkey.KeyF7,
	"f8":  hotkey.KeyF8,
	"f9":  hotkey.KeyF9,
	"f10": hotkey.KeyF10,
	"f11": hotkey.KeyF11,
	"f12": hotkey.KeyF12,
	"a":   hotkey.KeyA,
	"b":   hotkey.KeyB,
	"c":   hotkey.KeyC,
	"d":   hotkey.KeyD,
	"e":   hotkey.KeyE,
	"f":   hotkey.KeyF,
	"g":   hotkey.KeyG,
	"h":   hotkey.KeyH,
	"i":   hotkey.KeyI,
	"j":   hotkey.KeyJ,
	"k":   hotkey.KeyK,
	"l":   hotkey.KeyL,
	"m":   hotkey.KeyM,
	"n":   hotkey.KeyN,
	"o":   hotkey.KeyO,
	"p":   hotkey.KeyP,
	"q":   hotkey.KeyQ,
	"r":   hotkey.KeyR,
	"s":   hotkey.KeyS,
	"t":   hotkey.KeyT,
	"u":   hotkey.KeyU,
	"v":   hotkey.KeyV,
	"w":   hotkey.KeyW,
	"x":   hotkey.KeyX,
	"y":   hotkey.KeyY,
	"z":   hotkey.KeyZ,
	"0":   hotkey.Key0,
	"1":   hotkey.Key1,
	"2":   hotkey.Key2,
	"3":   hotkey.Key3,
	"4":   hotkey.Key4,
	"5":   hotkey.Key5,
	"6":   hotkey.Key6,
	"7":   hotkey.Key7,
	"8":   hotkey.Key8,
	"9":   hotkey.Key9,
}
