package detector

import (
	"context"
	"errors"
	"fmt"
	"image"
	"log/slog"
	"os"
	"path/filepath"
	"sync"

	"github.com/zsleyer/encounty/backend/internal/state"
)

const errSidecarNotAvailable = "sidecar not available"

// runningDetector tracks a running detector and its associated resources.
type runningDetector struct {
	cancel        context.CancelFunc
	detector      *Detector
	sidecarSource *SidecarMatchSource // non-nil when using sidecar match pipeline
}

// Manager owns and supervises all running Detector goroutines.
// All methods are safe to call concurrently.
type Manager struct {
	mu          sync.Mutex
	running     map[string]*runningDetector // pokemon_id → running detector
	previewOnly map[string]bool             // pokemon_id → true when a preview-only sidecar session is active
	stateMgr    *state.Manager
	broadcast   BroadcastFunc
	configDir   string
	sidecar     *SidecarManager // nil if sidecar not available

	// browserDetectors holds browser-driven detectors keyed by pokemon ID.
	// These are driven by external score submissions from the frontend WebGPU
	// engine rather than the sidecar capture pipeline.
	browserDetectors map[string]*BrowserDetector

	// matchRouterCancel stops the matchRouter goroutine on shutdown.
	matchRouterCancel context.CancelFunc

	// previewMu guards previewSubs. Separate from mu to avoid holding the
	// main lock while dispatching preview frames.
	previewMu          sync.Mutex
	previewSubs        map[*previewSub]struct{}
	previewDispatchStop context.CancelFunc

	// initSegments caches the fMP4 init segment (ftyp+moov) per session
	// so late-joining HTTP stream subscribers receive it immediately.
	initSegments   map[string][]byte
	initSegmentsMu sync.RWMutex

	// virtualCamNodes caches the PipeWire virtual camera node name
	// returned by the sidecar when starting a detection session.
	virtualCamNodes map[string]string // pokemon_id → node_name
}

// previewSub is a single subscriber to the preview frame fan-out.
type previewSub struct {
	ch        chan PreviewFrameMsg
	sessionID string // filter; empty string = all sessions
}

// NewManager creates a Manager. broadcast is called for each WebSocket event
// emitted by detectors. sidecar may be nil if the sidecar binary is not available.
func NewManager(stateMgr *state.Manager, broadcast BroadcastFunc, configDir string, sidecar *SidecarManager) *Manager {
	m := &Manager{
		running:          make(map[string]*runningDetector),
		previewOnly:      make(map[string]bool),
		virtualCamNodes:  make(map[string]string),
		browserDetectors: make(map[string]*BrowserDetector),
		stateMgr:         stateMgr,
		broadcast:        broadcast,
		configDir:        configDir,
	}

	if sidecar != nil {
		m.wireSidecar(sidecar)
	}

	return m
}

// wireSidecar connects a sidecar instance to the manager's routing
// goroutines (match router, replay match router, preview dispatcher).
// Any previously running routers are cancelled first.
func (m *Manager) wireSidecar(sc *SidecarManager) {
	// Cancel previous routers if they exist.
	if m.matchRouterCancel != nil {
		m.matchRouterCancel()
	}
	if m.previewDispatchStop != nil {
		m.previewDispatchStop()
	}

	m.sidecar = sc

	ctx, cancel := context.WithCancel(context.Background())
	m.matchRouterCancel = cancel
	go m.matchRouter(ctx, sc.MatchResults())
	go m.replayMatchRouter(ctx, sc.ReplayMatchResults())

	dispatchCtx, dispatchCancel := context.WithCancel(context.Background())
	m.previewDispatchStop = dispatchCancel
	if m.previewSubs == nil {
		m.previewSubs = make(map[*previewSub]struct{})
	}
	if m.initSegments == nil {
		m.initSegments = make(map[string][]byte)
	}
	go m.dispatchPreviewFrames(dispatchCtx, sc.PreviewFrames())
}

// ensureSidecar checks the health of the current sidecar process and
// restarts it if necessary. Returns an error only if the sidecar binary
// is not available at all. Caller must hold m.mu.
func (m *Manager) ensureSidecar() error {
	if m.sidecar != nil && m.sidecar.IsHealthy() {
		return nil
	}

	if m.sidecar != nil {
		slog.Warn("Sidecar process is unhealthy, restarting")
		m.sidecar.Close()
	}

	sc, err := NewSidecarManager()
	if err != nil {
		m.sidecar = nil
		return fmt.Errorf("sidecar restart failed: %w", err)
	}

	// Clear stale preview-only state since the old sidecar sessions are gone.
	for id := range m.previewOnly {
		delete(m.previewOnly, id)
	}

	m.wireSidecar(sc)
	slog.Info("Sidecar restarted successfully", "pid", sc.cmd.Process.Pid)
	return nil
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
// When a sidecar is available and the source type supports it, the sidecar
// pipeline is used for capture and matching.
func (m *Manager) Start(pokemonID string, cfg state.DetectorConfig) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.stopLocked(pokemonID)

	// Ensure sidecar is healthy; restart if it crashed.
	if err := m.ensureSidecar(); err != nil {
		slog.Warn("Sidecar restart failed, will use native fallback", "error", err)
	}

	// Use sidecar path when available.
	if m.sidecar != nil {
		// If a preview-only session is already running on the same source,
		// promote it to a full detection session by loading templates and
		// updating the config. This avoids tearing down the capture pipeline
		// and re-opening the device, which can fail on exclusive V4L2 devices.
		if m.previewOnly[pokemonID] {
			rd, err := m.promotePreviewSession(pokemonID, cfg)
			if err != nil {
				slog.Warn("Preview promotion failed, falling back to full restart", "pokemon_id", pokemonID, "error", err)
				// Fall through to stop + restart below.
			} else {
				delete(m.previewOnly, pokemonID)
				m.running[pokemonID] = rd
				return nil
			}
		}

		// Tear down any preview-only session that could not be promoted.
		if m.previewOnly[pokemonID] && m.sidecar != nil {
			if err := m.sidecar.StopDetection(pokemonID); err != nil {
				slog.Warn("Failed to stop preview-only session before start", "pokemon_id", pokemonID, "error", err)
			}
			delete(m.previewOnly, pokemonID)
		}

		rd, err := m.startWithSidecar(pokemonID, cfg)
		if err != nil {
			slog.Error("Sidecar start failed, falling back to native", "pokemon_id", pokemonID, "error", err)
		} else {
			m.running[pokemonID] = rd
			return nil
		}
	}

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
// SidecarMatchSource is closed to unblock NextResult and the sidecar pipeline
// is stopped explicitly.
func (m *Manager) stopLocked(pokemonID string) {
	rd, ok := m.running[pokemonID]
	if !ok {
		return
	}
	rd.cancel()
	if rd.sidecarSource != nil {
		rd.sidecarSource.Close()
		if m.sidecar != nil {
			if err := m.sidecar.StopDetection(pokemonID); err != nil {
				slog.Warn("Sidecar stop detection failed", "pokemon_id", pokemonID, "error", err)
			}
		}
	}
	delete(m.running, pokemonID)
	delete(m.virtualCamNodes, pokemonID)
}

// StopAll cancels all running detectors. Called on server shutdown.
func (m *Manager) StopAll() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for id := range m.running {
		m.stopLocked(id)
	}

	if m.matchRouterCancel != nil {
		m.matchRouterCancel()
	}

	if m.previewDispatchStop != nil {
		m.previewDispatchStop()
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

// promotePreviewSession upgrades a preview-only sidecar session to a full
// detection session by loading templates and updating the config. The capture
// pipeline keeps running so exclusive-access devices (V4L2 with exclusive_caps)
// are not re-opened. Caller must hold m.mu.
func (m *Manager) promotePreviewSession(pokemonID string, cfg state.DetectorConfig) (*runningDetector, error) {
	templates := prepareSidecarTemplates(cfg, m.configDir, pokemonID)
	if len(templates) == 0 {
		return nil, fmt.Errorf("no valid templates for sidecar")
	}

	if err := m.sidecar.LoadTemplates(pokemonID, templates); err != nil {
		return nil, fmt.Errorf("sidecar load templates: %w", err)
	}

	scConfig := toSidecarConfig(cfg)
	if err := m.sidecar.UpdateConfig(pokemonID, scConfig); err != nil {
		return nil, fmt.Errorf("sidecar update config: %w", err)
	}

	d := newDetector(pokemonID, cfg, m.stateMgr, m.broadcast, m.configDir)
	source := NewSidecarMatchSource(64)
	ctx, cancel := context.WithCancel(context.Background())

	go func() {
		defer source.Close()
		d.RunWithMatchSource(ctx, source)
	}()

	return &runningDetector{
		cancel:        cancel,
		detector:      d,
		sidecarSource: source,
	}, nil
}

// startWithSidecar creates a sidecar-backed detector for native capture sources.
// It loads templates into the sidecar, starts the detection pipeline, and spawns
// a goroutine that feeds pre-computed results into the detector's state machine.
// Caller must hold m.mu.
func (m *Manager) startWithSidecar(pokemonID string, cfg state.DetectorConfig) (*runningDetector, error) {
	templates := prepareSidecarTemplates(cfg, m.configDir, pokemonID)
	if len(templates) == 0 {
		return nil, fmt.Errorf("no valid templates for sidecar")
	}

	if err := m.sidecar.LoadTemplates(pokemonID, templates); err != nil {
		return nil, fmt.Errorf("sidecar load templates: %w", err)
	}

	scConfig := toSidecarConfig(cfg)
	result, err := m.sidecar.StartDetection(pokemonID, cfg.SourceType, cfg.WindowTitle, scConfig)
	if err != nil {
		return nil, fmt.Errorf("sidecar start detection: %w", err)
	}

	if result.VirtualCamNode != "" {
		m.virtualCamNodes[pokemonID] = result.VirtualCamNode
	}

	d := newDetector(pokemonID, cfg, m.stateMgr, m.broadcast, m.configDir)
	source := NewSidecarMatchSource(64)
	ctx, cancel := context.WithCancel(context.Background())

	go func() {
		defer source.Close()
		d.RunWithMatchSource(ctx, source)
	}()

	return &runningDetector{
		cancel:        cancel,
		detector:      d,
		sidecarSource: source,
	}, nil
}

// matchRouter reads match results from the sidecar and dispatches each to the
// correct SidecarMatchSource based on session_id (which maps to pokemon_id).
// It runs until ctx is cancelled.
func (m *Manager) matchRouter(ctx context.Context, ch <-chan MatchResultMsg) {
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			m.mu.Lock()
			rd, exists := m.running[msg.SessionID]
			m.mu.Unlock()

			if exists && rd.sidecarSource != nil {
				rd.sidecarSource.Submit(SidecarMatchResult{
					BestScore:  msg.BestScore,
					FrameDelta: msg.FrameDelta,
				})
			}
		}
	}
}

// prepareSidecarTemplates converts state.DetectorTemplate entries to
// SidecarTemplate values, resolving filesystem paths for the sidecar.
func prepareSidecarTemplates(cfg state.DetectorConfig, configDir, pokemonID string) []SidecarTemplate {
	var result []SidecarTemplate
	for i, t := range cfg.Templates {
		if t.Enabled != nil && !*t.Enabled {
			continue
		}

		absPath := t.ImagePath
		if absPath != "" && !filepath.IsAbs(absPath) {
			absPath = filepath.Join(configDir, "templates", pokemonID, t.ImagePath)
		}

		// When ImagePath is empty but ImageData is available (v2 DB storage),
		// write the image to a temporary file so the sidecar can read it.
		if absPath == "" && len(t.ImageData) > 0 {
			tmpDir := filepath.Join(os.TempDir(), "encounty-templates", pokemonID)
			if err := os.MkdirAll(tmpDir, 0o700); err == nil {
				tmpPath := filepath.Join(tmpDir, fmt.Sprintf("template_%d.png", i))
				if err := os.WriteFile(tmpPath, t.ImageData, 0o600); err == nil {
					absPath = tmpPath
				}
			}
		}

		// Skip templates whose file cannot be found.
		if absPath == "" {
			continue
		}
		if _, err := os.Stat(absPath); err != nil {
			slog.Warn("Sidecar template file not found, skipping", "pokemon_id", pokemonID, "path", absPath)
			continue
		}

		var regions []SidecarRegion
		for _, r := range t.Regions {
			regions = append(regions, SidecarRegion{
				RegionType:   r.Type,
				ExpectedText: r.ExpectedText,
				Rect: SidecarRect{
					X: r.Rect.X,
					Y: r.Rect.Y,
					W: r.Rect.W,
					H: r.Rect.H,
				},
			})
		}

		result = append(result, SidecarTemplate{
			ID:      i,
			Path:    absPath,
			Regions: regions,
			Enabled: true,
		})
	}
	return result
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

// StartPreview starts the JPEG preview stream for a running detector session.
func (m *Manager) StartPreview(pokemonID string, maxDim, quality, targetFPS int) error {
	if m.sidecar == nil {
		return errors.New(errSidecarNotAvailable)
	}
	return m.sidecar.StartPreview(pokemonID, maxDim, quality, targetFPS)
}

// StopPreview stops the JPEG preview stream for a detector session.
func (m *Manager) StopPreview(pokemonID string) error {
	if m.sidecar == nil {
		return errors.New(errSidecarNotAvailable)
	}
	return m.sidecar.StopPreview(pokemonID)
}

// StartPreviewSession starts a live preview without running actual detection.
// If a detection session is already running for pokemonID, the preview is
// started on the existing session. Otherwise a minimal sidecar session is
// created with no templates and a high poll interval so it does minimal work.
// When the sidecar process has crashed, it is automatically restarted.
func (m *Manager) StartPreviewSession(pokemonID string, cfg state.DetectorConfig) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Ensure the sidecar is alive; restart it if it crashed.
	if err := m.ensureSidecar(); err != nil {
		return err
	}
	if m.sidecar == nil {
		return errors.New(errSidecarNotAvailable)
	}

	// If a real detection session is already running, just start the preview.
	if _, running := m.running[pokemonID]; running {
		return m.sidecar.StartPreview(pokemonID, 480, 85, 20)
	}

	// Already have a preview-only session — no-op.
	if m.previewOnly[pokemonID] {
		return nil
	}

	// Discard any stale init segment from a previous session so that
	// late-joining subscribers don't receive an outdated init.
	m.initSegmentsMu.Lock()
	delete(m.initSegments, pokemonID)
	m.initSegmentsMu.Unlock()

	// Start a lightweight sidecar session with no templates. The replay
	// buffer is enabled so users can create templates from captured frames
	// before starting full detection.
	replayBuf := cfg.ReplayBufferSec
	if replayBuf == 0 {
		replayBuf = 30 // match sidecar default
	}
	previewConfig := SidecarDetectionConfig{
		PollIntervalMs:  1000,
		ReplayBufferSec: replayBuf,
		Crop: SidecarRect{
			X: cfg.Region.X,
			Y: cfg.Region.Y,
			W: cfg.Region.W,
			H: cfg.Region.H,
		},
	}
	result, err := m.sidecar.StartDetection(pokemonID, cfg.SourceType, cfg.WindowTitle, previewConfig)
	if err != nil {
		// The sidecar may have crashed during the write. Try to restart and retry once.
		if restartErr := m.ensureSidecar(); restartErr != nil {
			return fmt.Errorf("sidecar start preview session (restart failed): %w", restartErr)
		}
		if m.sidecar == nil {
			return errors.New(errSidecarNotAvailable)
		}
		result2, err2 := m.sidecar.StartDetection(pokemonID, cfg.SourceType, cfg.WindowTitle, previewConfig)
		if err2 != nil {
			return fmt.Errorf("sidecar start preview session (retry): %w", err2)
		}
		result = result2
	}

	if result.VirtualCamNode != "" {
		m.virtualCamNodes[pokemonID] = result.VirtualCamNode
	}

	m.previewOnly[pokemonID] = true

	return m.sidecar.StartPreview(pokemonID, 480, 85, 20)
}

// StopPreviewSession stops a preview-only session. If the session was created
// solely for preview (not backed by a real detection), the underlying sidecar
// detection is also stopped. Tolerates a crashed sidecar by cleaning up local
// state even when commands cannot be sent.
func (m *Manager) StopPreviewSession(pokemonID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.sidecar != nil && m.sidecar.IsHealthy() {
		_ = m.sidecar.StopPreview(pokemonID)

		if m.previewOnly[pokemonID] {
			if err := m.sidecar.StopDetection(pokemonID); err != nil {
				slog.Warn("Failed to stop preview-only sidecar session", "pokemon_id", pokemonID, "error", err)
			}
		}
	}

	// Always clear state so the next start creates a fresh session,
	// even if the stop commands failed (e.g. broken pipe after crash).
	delete(m.previewOnly, pokemonID)
	delete(m.virtualCamNodes, pokemonID)

	m.initSegmentsMu.Lock()
	delete(m.initSegments, pokemonID)
	m.initSegmentsMu.Unlock()

	return nil
}

// UpdateConfig propagates updated detection parameters to a running sidecar
// session. Source-type changes require a full restart; this only updates
// tunable parameters. No-op if the session is not running via sidecar.
func (m *Manager) UpdateConfig(pokemonID string, cfg state.DetectorConfig) error {
	m.mu.Lock()
	rd, ok := m.running[pokemonID]
	m.mu.Unlock()

	if !ok || rd.sidecarSource == nil || m.sidecar == nil {
		return nil
	}

	scConfig := toSidecarConfig(cfg)
	return m.sidecar.UpdateConfig(pokemonID, scConfig)
}

// SubscribePreview returns a channel that receives JPEG preview frames for
// the given session ID. Call the returned function to unsubscribe.
func (m *Manager) SubscribePreview(sessionID string) (<-chan PreviewFrameMsg, func()) {
	sub := &previewSub{
		ch:        make(chan PreviewFrameMsg, 8),
		sessionID: sessionID,
	}
	m.previewMu.Lock()
	m.previewSubs[sub] = struct{}{}
	m.previewMu.Unlock()

	// Send cached init segment to late-joining subscriber.
	m.initSegmentsMu.RLock()
	if initData, ok := m.initSegments[sessionID]; ok {
		sub.ch <- PreviewFrameMsg{
			SessionID: sessionID,
			IsVideo:   true,
			IsInit:    true,
			FMP4Data:  initData,
		}
	}
	m.initSegmentsMu.RUnlock()

	var once sync.Once
	unsub := func() {
		once.Do(func() {
			m.previewMu.Lock()
			delete(m.previewSubs, sub)
			m.previewMu.Unlock()
			close(sub.ch)
		})
	}
	return sub.ch, unsub
}

// dispatchPreviewFrames reads from the sidecar's preview channel and fans
// out each frame to matching subscribers via non-blocking sends.
func (m *Manager) dispatchPreviewFrames(ctx context.Context, ch <-chan PreviewFrameMsg) {
	for {
		select {
		case <-ctx.Done():
			return
		case frame, ok := <-ch:
			if !ok {
				return
			}
			// Cache init segment for late-joining video stream subscribers.
			if frame.IsVideo && frame.IsInit {
				m.initSegmentsMu.Lock()
				m.initSegments[frame.SessionID] = frame.FMP4Data
				m.initSegmentsMu.Unlock()
			}
			m.previewMu.Lock()
			for sub := range m.previewSubs {
				if sub.sessionID == "" || sub.sessionID == frame.SessionID {
					select {
					case sub.ch <- frame:
					default:
					}
				}
			}
			m.previewMu.Unlock()
		}
	}
}

// StartReplay starts (or restarts) the replay buffer for the given pokemon's
// sidecar session with the configured buffer duration.
func (m *Manager) StartReplay(pokemonID string) error {
	if m.sidecar == nil {
		return errors.New(errSidecarNotAvailable)
	}

	// Read the configured replay buffer duration from the detector config.
	bufferSec := 30 // default
	m.mu.Lock()
	if rd, ok := m.running[pokemonID]; ok && rd.detector != nil {
		if rd.detector.cfg.ReplayBufferSec > 0 {
			bufferSec = rd.detector.cfg.ReplayBufferSec
		}
	}
	m.mu.Unlock()

	return m.sidecar.StartReplay(pokemonID, bufferSec)
}

// StopReplay stops the replay buffer for the given pokemon's sidecar session.
func (m *Manager) StopReplay(pokemonID string) error {
	if m.sidecar == nil {
		return errors.New(errSidecarNotAvailable)
	}
	return m.sidecar.StopReplay(pokemonID)
}

// GetReplayStatus returns the replay buffer status for the given pokemon's
// sidecar session: current duration in seconds and frame count.
func (m *Manager) GetReplayStatus(pokemonID string) (float64, int, error) {
	if m.sidecar == nil {
		return 0, 0, errors.New(errSidecarNotAvailable)
	}
	return m.sidecar.GetReplayStatus(pokemonID)
}

// SnapshotReplay freezes the replay buffer for the given pokemon's sidecar
// session. Returns the frame count, duration, and filesystem path.
func (m *Manager) SnapshotReplay(pokemonID string) (int, float64, string, error) {
	if m.sidecar == nil {
		return 0, 0, "", errors.New(errSidecarNotAvailable)
	}
	return m.sidecar.SnapshotReplay(pokemonID)
}

// DeleteSnapshot removes the snapshot directory for the given pokemon's session.
func (m *Manager) DeleteSnapshot(pokemonID string) error {
	if m.sidecar == nil {
		return errors.New(errSidecarNotAvailable)
	}
	return m.sidecar.DeleteSnapshot(pokemonID)
}

// GetSnapshotFrame retrieves a single JPEG frame from the snapshot of the
// given pokemon's session at the specified index.
func (m *Manager) GetSnapshotFrame(pokemonID string, frameIndex int) ([]byte, error) {
	if m.sidecar == nil {
		return nil, errors.New(errSidecarNotAvailable)
	}
	return m.sidecar.GetSnapshotFrame(pokemonID, frameIndex)
}

// TriggerRematch runs NCC matching over the replay buffer of the given
// pokemon's session within the specified time window (in seconds).
func (m *Manager) TriggerRematch(pokemonID string, windowSec int) error {
	if m.sidecar == nil {
		return errors.New(errSidecarNotAvailable)
	}
	return m.sidecar.TriggerRematch(pokemonID, windowSec)
}

// ListSources asks the sidecar for capture sources of the given type
// (e.g. "screen", "window", "camera"). Returns nil when no sidecar is available.
// Automatically restarts the sidecar if it has crashed.
func (m *Manager) ListSources(sourceType string) ([]SourceInfo, error) {
	m.mu.Lock()
	if err := m.ensureSidecar(); err != nil {
		m.mu.Unlock()
		return nil, err
	}
	sc := m.sidecar
	m.mu.Unlock()

	if sc == nil {
		return nil, errors.New(errSidecarNotAvailable)
	}
	return sc.ListSources(sourceType)
}

// CaptureSourceFrame captures a single frame from the given source via the
// sidecar and returns it as a decoded image. Useful for generating thumbnails.
func (m *Manager) CaptureSourceFrame(sourceType, sourceID string, w, h int) (image.Image, error) {
	if m.sidecar == nil {
		return nil, errors.New(errSidecarNotAvailable)
	}
	return m.sidecar.CaptureFrame(sourceType, sourceID, w, h)
}

// VirtualCamNode returns the cached PipeWire virtual camera node name for the
// given pokemon's sidecar session. Returns an empty string when no node is available.
func (m *Manager) VirtualCamNode(pokemonID string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.virtualCamNodes[pokemonID]
}

// replayMatchRouter reads replay match results from the sidecar and handles
// auto-increment plus WebSocket broadcast for each hit.
func (m *Manager) replayMatchRouter(ctx context.Context, ch <-chan ReplayMatchMsg) {
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			if m.stateMgr != nil {
				m.stateMgr.Increment(msg.SessionID)
				m.stateMgr.AppendDetectionLog(msg.SessionID, msg.BestScore)
			}
			m.broadcast("detector_match", map[string]any{
				"pokemon_id": msg.SessionID,
				"confidence": msg.BestScore,
				"source":     "replay",
			})
		}
	}
}

// toSidecarConfig maps state.DetectorConfig fields to a SidecarDetectionConfig.
func toSidecarConfig(cfg state.DetectorConfig) SidecarDetectionConfig {
	return SidecarDetectionConfig{
		Precision:       floatOrDefault(cfg.Precision, defaultPrecision),
		MaxDim:          0, // let sidecar decide
		Crop: SidecarRect{
			X: cfg.Region.X,
			Y: cfg.Region.Y,
			W: cfg.Region.W,
			H: cfg.Region.H,
		},
		PollIntervalMs:         intOrDefault(cfg.PollIntervalMs, defaultPollIntervalMs),
		ChangeThreshold:        floatOrDefault(cfg.ChangeThreshold, defaultChangeThreshold),
		ConsecutiveHits:        intOrDefault(cfg.ConsecutiveHits, defaultConsecutiveHits),
		MinPollMs:              intOrDefault(cfg.MinPollMs, defaultMinPollMs),
		MaxPollMs:              intOrDefault(cfg.MaxPollMs, defaultMaxPollMs),
		RelativeRegions:        cfg.RelativeRegions,
		RematchEnabled:         cfg.RematchEnabled,
		RematchThresholdOffset: cfg.RematchThresholdOffset,
		RematchWindowSec:       cfg.RematchWindowSec,
		ReplayBufferSec:        cfg.ReplayBufferSec,
	}
}
