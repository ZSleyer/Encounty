package detector

import (
	"context"
	"sync"

	"github.com/zsleyer/encounty/internal/state"
)

// Manager owns and supervises all running Detector goroutines and
// per-hunt BrowserDetector instances for browser-sourced frames.
// All methods are safe to call concurrently.
type Manager struct {
	mu               sync.Mutex
	running          map[string]context.CancelFunc // pokemon_id → cancel func
	browserDetectors map[string]*BrowserDetector   // pokemon_id → BrowserDetector
	stateMgr         *state.Manager
	broadcast        BroadcastFunc
	configDir        string
}

// NewManager creates a Manager. broadcast is called for each WebSocket event emitted by detectors.
func NewManager(stateMgr *state.Manager, broadcast BroadcastFunc, configDir string) *Manager {
	return &Manager{
		running:          make(map[string]context.CancelFunc),
		browserDetectors: make(map[string]*BrowserDetector),
		stateMgr:         stateMgr,
		broadcast:        broadcast,
		configDir:        configDir,
	}
}

// Start launches the screen/window detection goroutine for pokemonID using cfg.
// If a detector for that ID is already running it is stopped first.
func (m *Manager) Start(pokemonID string, cfg state.DetectorConfig) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if cancel, ok := m.running[pokemonID]; ok {
		cancel()
		delete(m.running, pokemonID)
	}

	d := newDetector(pokemonID, cfg, m.stateMgr, m.broadcast, m.configDir)
	ctx, cancel := context.WithCancel(context.Background())
	m.running[pokemonID] = cancel
	go d.Run(ctx)
	return nil
}

// Stop cancels the running detector goroutine and removes any BrowserDetector
// for pokemonID. No-op if not running.
func (m *Manager) Stop(pokemonID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if cancel, ok := m.running[pokemonID]; ok {
		cancel()
		delete(m.running, pokemonID)
	}
	delete(m.browserDetectors, pokemonID)
}

// StopAll cancels all running detectors and removes all BrowserDetectors.
// Called on server shutdown.
func (m *Manager) StopAll() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for id, cancel := range m.running {
		cancel()
		delete(m.running, id)
	}
	for id := range m.browserDetectors {
		delete(m.browserDetectors, id)
	}
}

// IsRunning reports whether a goroutine-based detector for pokemonID is active.
func (m *Manager) IsRunning(pokemonID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.running[pokemonID]
	return ok
}

// IsBrowserRunning reports whether a BrowserDetector for pokemonID is active.
func (m *Manager) IsBrowserRunning(pokemonID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.browserDetectors[pokemonID]
	return ok
}

// GetOrCreateBrowserDetector returns the existing BrowserDetector for pokemonID,
// or creates a new one from cfg. The Pokémon's language is resolved from the
// state manager to derive the correct tesseract language code.
func (m *Manager) GetOrCreateBrowserDetector(pokemonID string, cfg state.DetectorConfig) *BrowserDetector {
	m.mu.Lock()
	defer m.mu.Unlock()
	if bd, ok := m.browserDetectors[pokemonID]; ok {
		return bd
	}
	lang := m.pokemonLang(pokemonID)
	bd := newBrowserDetector(cfg, m.configDir, pokemonID, lang)
	m.browserDetectors[pokemonID] = bd
	return bd
}

// ResetBrowserDetector replaces the BrowserDetector for pokemonID (e.g. after config change).
func (m *Manager) ResetBrowserDetector(pokemonID string, cfg state.DetectorConfig) *BrowserDetector {
	m.mu.Lock()
	defer m.mu.Unlock()
	lang := m.pokemonLang(pokemonID)
	bd := newBrowserDetector(cfg, m.configDir, pokemonID, lang)
	m.browserDetectors[pokemonID] = bd
	return bd
}

// pokemonLang returns the tesseract language code for the given pokemonID by
// looking up the Pokémon's Language field in the state manager.
// Caller must NOT hold m.mu (state access is independent).
func (m *Manager) pokemonLang(pokemonID string) string {
	for _, p := range m.stateMgr.GetState().Pokemon {
		if p.ID == pokemonID {
			return LangToTesseract(p.Language)
		}
	}
	return "eng"
}

// SetBroadcast replaces the broadcast function. Safe to call before any detectors are started.
func (m *Manager) SetBroadcast(fn BroadcastFunc) {
	m.mu.Lock()
	m.broadcast = fn
	m.mu.Unlock()
}

// RunningIDs returns a snapshot of all currently running goroutine-detector IDs.
func (m *Manager) RunningIDs() []string {
	m.mu.Lock()
	defer m.mu.Unlock()

	ids := make([]string, 0, len(m.running))
	for id := range m.running {
		ids = append(ids, id)
	}
	return ids
}
