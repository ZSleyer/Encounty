package detector

import (
	"context"
	"log/slog"
	"sync"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// runningDetector tracks a running detector and its associated resources.
type runningDetector struct {
	cancel   context.CancelFunc
	detector *Detector
}

// Manager owns and supervises all running Detector goroutines.
// All methods are safe to call concurrently.
type Manager struct {
	mu        sync.Mutex
	running   map[string]*runningDetector // pokemon_id → running detector
	stateMgr  *state.Manager
	broadcast BroadcastFunc
	configDir string

	// browserDetectors holds browser-driven detectors keyed by pokemon ID.
	// These are driven by external score submissions from the frontend WebGPU
	// engine rather than a native capture pipeline.
	browserDetectors map[string]*BrowserDetector
}

// NewManager creates a Manager. broadcast is called for each WebSocket event
// emitted by detectors.
func NewManager(stateMgr *state.Manager, broadcast BroadcastFunc, configDir string) *Manager {
	return &Manager{
		running:          make(map[string]*runningDetector),
		browserDetectors: make(map[string]*BrowserDetector),
		stateMgr:         stateMgr,
		broadcast:        broadcast,
		configDir:        configDir,
	}
}

// createFrameSource builds the appropriate FrameSource for the given config.
func createFrameSource(cfg state.DetectorConfig, pokemonID string) (FrameSource, error) {
	switch cfg.SourceType {
	case "camera":
		src, err := NewCameraFrameSource(cfg)
		if err != nil {
			return nil, err
		}
		return src, nil
	default:
		// screen_region, window, or any other native capture source.
		return NewScreenFrameSource(cfg, pokemonID), nil
	}
}

// Start launches the detection goroutine for pokemonID using cfg.
// If a detector for that ID is already running it is stopped first.
// The appropriate FrameSource is created based on cfg.SourceType.
func (m *Manager) Start(pokemonID string, cfg state.DetectorConfig) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.stopLocked(pokemonID)

	source, err := createFrameSource(cfg, pokemonID)
	if err != nil {
		slog.Error("Detector frame source creation failed", "pokemon_id", pokemonID, "error", err)
		return err
	}

	d := newDetector(pokemonID, cfg, m.stateMgr, m.broadcast, m.configDir)
	ctx, cancel := context.WithCancel(context.Background())

	rd := &runningDetector{
		cancel:   cancel,
		detector: d,
	}
	m.running[pokemonID] = rd

	go func() {
		defer source.Close()
		d.Run(ctx, source)
	}()
	return nil
}

// Stop cancels the running detector goroutine for pokemonID. No-op if not running.
func (m *Manager) Stop(pokemonID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.stopLocked(pokemonID)
}

// stopLocked cancels and cleans up the detector for pokemonID. Caller must hold m.mu.
func (m *Manager) stopLocked(pokemonID string) {
	rd, ok := m.running[pokemonID]
	if !ok {
		return
	}
	rd.cancel()
	delete(m.running, pokemonID)
}

// StopAll cancels all running detectors. Called on server shutdown.
func (m *Manager) StopAll() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for id := range m.running {
		m.stopLocked(id)
	}
}

// IsRunning reports whether a detector for pokemonID is active.
func (m *Manager) IsRunning(pokemonID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.running[pokemonID]
	return ok
}

// pokemonLang returns the tesseract language code for the given pokemonID by
// looking up the Pokemon's Language field in the state manager.
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

// RunningIDs returns a snapshot of all currently running detector IDs.
func (m *Manager) RunningIDs() []string {
	m.mu.Lock()
	defer m.mu.Unlock()

	ids := make([]string, 0, len(m.running))
	for id := range m.running {
		ids = append(ids, id)
	}
	return ids
}

// GetOrCreateBrowserDetector returns the BrowserDetector for pokemonID,
// creating one with the given config if it does not already exist. The
// returned detector is ready to receive score submissions.
func (m *Manager) GetOrCreateBrowserDetector(pokemonID string, cfg state.DetectorConfig) *BrowserDetector {
	m.mu.Lock()
	defer m.mu.Unlock()

	if bd, ok := m.browserDetectors[pokemonID]; ok {
		return bd
	}

	bd := NewBrowserDetector(cfg)
	m.browserDetectors[pokemonID] = bd
	slog.Info("Browser detector created", "pokemon_id", pokemonID)
	return bd
}

// GetBrowserDetector returns the BrowserDetector for pokemonID, or nil if none
// is active.
func (m *Manager) GetBrowserDetector(pokemonID string) *BrowserDetector {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.browserDetectors[pokemonID]
}

// StopBrowserDetector removes the BrowserDetector for pokemonID. No-op if
// none is active.
func (m *Manager) StopBrowserDetector(pokemonID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, ok := m.browserDetectors[pokemonID]; ok {
		delete(m.browserDetectors, pokemonID)
		slog.Info("Browser detector stopped", "pokemon_id", pokemonID)
	}
}
