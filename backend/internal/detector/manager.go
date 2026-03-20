package detector

import (
	"context"
	"image"
	"log/slog"
	"sync"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// runningDetector tracks a running detector and its associated resources.
type runningDetector struct {
	cancel        context.CancelFunc
	detector      *Detector
	browserSource *BrowserFrameSource // non-nil only for browser sources
}

// Manager owns and supervises all running Detector goroutines.
// All methods are safe to call concurrently.
type Manager struct {
	mu        sync.Mutex
	running   map[string]*runningDetector // pokemon_id → running detector
	stateMgr  *state.Manager
	broadcast BroadcastFunc
	configDir string
}

// NewManager creates a Manager. broadcast is called for each WebSocket event emitted by detectors.
func NewManager(stateMgr *state.Manager, broadcast BroadcastFunc, configDir string) *Manager {
	return &Manager{
		running:   make(map[string]*runningDetector),
		stateMgr:  stateMgr,
		broadcast: broadcast,
		configDir: configDir,
	}
}

// createFrameSource builds the appropriate FrameSource for the given config and
// returns it alongside any BrowserFrameSource reference (nil for non-browser sources).
func createFrameSource(cfg state.DetectorConfig, pokemonID string) (FrameSource, *BrowserFrameSource, error) {
	switch cfg.SourceType {
	case "browser_camera", "browser_display":
		bfs := NewBrowserFrameSource(3)
		return bfs, bfs, nil
	case "camera":
		src, err := NewCameraFrameSource(cfg)
		if err != nil {
			return nil, nil, err
		}
		return src, nil, nil
	default:
		// screen_region, window, or any other native capture source.
		return NewScreenFrameSource(cfg, pokemonID), nil, nil
	}
}

// Start launches the detection goroutine for pokemonID using cfg.
// If a detector for that ID is already running it is stopped first.
// The appropriate FrameSource is created based on cfg.SourceType.
func (m *Manager) Start(pokemonID string, cfg state.DetectorConfig) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if rd, ok := m.running[pokemonID]; ok {
		rd.cancel()
		if rd.browserSource != nil {
			rd.browserSource.Close()
		}
		delete(m.running, pokemonID)
	}

	source, bfs, err := createFrameSource(cfg, pokemonID)
	if err != nil {
		slog.Error("Detector frame source creation failed", "pokemon_id", pokemonID, "error", err)
		return err
	}

	d := newDetector(pokemonID, cfg, m.stateMgr, m.broadcast, m.configDir)
	ctx, cancel := context.WithCancel(context.Background())

	rd := &runningDetector{
		cancel:        cancel,
		detector:      d,
		browserSource: bfs,
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

	if rd, ok := m.running[pokemonID]; ok {
		rd.cancel()
		delete(m.running, pokemonID)
	}
}

// StopAll cancels all running detectors. Called on server shutdown.
func (m *Manager) StopAll() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for id, rd := range m.running {
		rd.cancel()
		delete(m.running, id)
	}
}

// IsRunning reports whether a detector for pokemonID is active.
func (m *Manager) IsRunning(pokemonID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.running[pokemonID]
	return ok
}

// IsBrowserRunning reports whether a browser-source detector for pokemonID
// is active. This replaces the old separate BrowserDetector check.
func (m *Manager) IsBrowserRunning(pokemonID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	rd, ok := m.running[pokemonID]
	return ok && rd.browserSource != nil
}

// SubmitBrowserFrame pushes a frame to the browser-source detector for pokemonID.
// Returns false if no browser detector is running for that ID.
func (m *Manager) SubmitBrowserFrame(pokemonID string, frame image.Image) bool {
	m.mu.Lock()
	rd, ok := m.running[pokemonID]
	m.mu.Unlock()

	if !ok || rd.browserSource == nil {
		return false
	}
	rd.browserSource.Submit(frame)
	return true
}

// GetOrCreateBrowserDetector returns the Detector for pokemonID if it is a
// browser-source detector, or creates and starts one from cfg. This preserves
// API compatibility with the server's handleMatchFrame endpoint.
func (m *Manager) GetOrCreateBrowserDetector(pokemonID string, cfg state.DetectorConfig) *Detector {
	m.mu.Lock()
	rd, ok := m.running[pokemonID]
	m.mu.Unlock()

	if ok && rd.browserSource != nil {
		return rd.detector
	}

	// Start a new browser-source detector.
	_ = m.Start(pokemonID, cfg)

	m.mu.Lock()
	rd = m.running[pokemonID]
	m.mu.Unlock()

	if rd != nil {
		return rd.detector
	}
	return nil
}

// ResetBrowserDetector stops and recreates the browser-source detector for
// pokemonID with a fresh config (e.g. after template changes).
func (m *Manager) ResetBrowserDetector(pokemonID string, cfg state.DetectorConfig) *Detector {
	m.Stop(pokemonID)
	return m.GetOrCreateBrowserDetector(pokemonID, cfg)
}

// pokemonLang returns the tesseract language code for the given pokemonID by
// looking up the Pokémon's Language field in the state manager.
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
