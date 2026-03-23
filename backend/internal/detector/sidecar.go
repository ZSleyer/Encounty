package detector

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"image"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"
)

// frameMagic is the sentinel byte that precedes a raw RGBA frame on the
// sidecar's stdout. Any byte that is NOT frameMagic starts a JSON text line.
const frameMagic byte = 0xFD

// sidecarTimeout is the deadline for synchronous command-response exchanges.
const sidecarTimeout = 5 * time.Second

// captureFrameTimeout is the deadline for the one-shot CaptureFrame command.
// Set to 65 s to allow the user to interact with the Wayland ScreenCast portal
// dialog before the first frame arrives.
const captureFrameTimeout = 65 * time.Second

// sidecarShutdownGrace is how long Close waits for the process to exit
// before sending SIGKILL.
const sidecarShutdownGrace = 3 * time.Second

// sidecarBinaryName is the filename of the Rust capture sidecar.
const sidecarBinaryName = "encounty-capture"

// SourceInfo describes a capture source reported by the sidecar.
type SourceInfo struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	SourceType string `json:"source_type"`
	W          int    `json:"w"`
	H          int    `json:"h"`
}

// MatchResultMsg holds a single match result sent by the sidecar after
// comparing a captured frame against loaded templates.
type MatchResultMsg struct {
	SessionID   string  `json:"session_id"`
	BestScore   float64 `json:"best_score"`
	FrameDelta  float64 `json:"frame_delta"`
	TimestampMs uint64  `json:"timestamp_ms"`
}

// SidecarTemplate describes a template to load into the sidecar for NCC matching.
type SidecarTemplate struct {
	ID      int             `json:"id"`
	Path    string          `json:"path"`
	Regions []SidecarRegion `json:"regions"`
	Enabled bool            `json:"enabled"`
}

// SidecarRegion describes a region within a template used for matching.
type SidecarRegion struct {
	RegionType   string      `json:"region_type"`
	ExpectedText string      `json:"expected_text"`
	Rect         SidecarRect `json:"rect"`
}

// SidecarRect is an axis-aligned rectangle used in sidecar region definitions.
type SidecarRect struct {
	X int `json:"x"`
	Y int `json:"y"`
	W int `json:"w"`
	H int `json:"h"`
}

// SidecarDetectionConfig holds the detection pipeline parameters sent to the
// sidecar with a start_detection command.
type SidecarDetectionConfig struct {
	Precision              float64     `json:"precision"`
	MaxDim                 int         `json:"max_dim"`
	Crop                   SidecarRect `json:"crop"`
	PollIntervalMs         int         `json:"poll_interval_ms"`
	ChangeThreshold        float64     `json:"change_threshold"`
	ConsecutiveHits        int         `json:"consecutive_hits"`
	MinPollMs              int         `json:"min_poll_ms"`
	MaxPollMs              int         `json:"max_poll_ms"`
	RelativeRegions        bool        `json:"relative_regions"`
	RematchEnabled         bool        `json:"rematch_enabled"`
	RematchThresholdOffset float64     `json:"rematch_threshold_offset"`
	RematchWindowSec       int         `json:"rematch_window_sec"`
	ReplayBufferSec        int         `json:"replay_buffer_sec"`
}

// sidecarResponse is the generic JSON envelope returned by the sidecar on
// stdout for command acknowledgements and match results.
type sidecarResponse struct {
	Type      string       `json:"type"`
	SessionID string       `json:"session_id,omitempty"`
	Message   string       `json:"message,omitempty"`
	Sources   []SourceInfo `json:"data,omitempty"`
	Count     int          `json:"count,omitempty"`
	W         int          `json:"w,omitempty"`
	H         int          `json:"h,omitempty"`

	// Match result fields (only populated when Type == "match_result" or "replay_match").
	BestScore   float64 `json:"best_score,omitempty"`
	FrameDelta  float64 `json:"frame_delta,omitempty"`
	TimestampMs uint64  `json:"timestamp_ms,omitempty"`

	// Replay/snapshot fields (populated for replay_status, snapshot_ready, snapshot_frame).
	DurationSec float64 `json:"duration_sec,omitempty"`
	FrameCount  int     `json:"frame_count,omitempty"`
	Path        string  `json:"path,omitempty"`
	FrameIndex  int     `json:"frame_index,omitempty"`
}

// frameHeader mirrors the extended binary frame header emitted by the sidecar.
// Layout (16 bytes): magic(1) + width(2) + height(2) + timestamp(4) +
// format(1) + session_id_len(2) + payload_len(4).
type frameHeader struct {
	Magic      byte
	Width      uint16
	Height     uint16
	Timestamp  uint32
	Format     byte   // 0x00=RGBA, 0x01=JPEG, 0x02=fMP4
	SessionLen uint16
	PayloadLen uint32
}

// PreviewFrameMsg holds a preview frame from the sidecar, tagged with
// the session ID so it can be routed to the correct WebSocket subscriber.
type PreviewFrameMsg struct {
	SessionID string
	Width     int
	Height    int
	IsVideo   bool   // true when FMP4Data is populated
	IsInit    bool   // true for ftyp+moov init segment
	IsRaw     bool   // true when RGBAData is populated (raw preview)
	JPEGData  []byte // populated for FORMAT_JPEG
	FMP4Data  []byte // populated for FORMAT_FMP4
	RGBAData  []byte // populated for FORMAT_RGBA (raw preview)
}

// ReplayMatchMsg holds an asynchronous replay match result emitted by the
// sidecar when its re-match pipeline finds a hit in the replay buffer.
type ReplayMatchMsg struct {
	SessionID   string  `json:"session_id"`
	BestScore   float64 `json:"best_score"`
	TimestampMs uint64  `json:"timestamp_ms"`
}

// SidecarManager manages communication with the encounty-capture Rust binary.
// It sends JSON commands via stdin and reads JSON responses plus binary frame
// data and match results from stdout.
type SidecarManager struct {
	cmd           *exec.Cmd
	stdin         io.WriteCloser
	stdout        *bufio.Reader
	mu            sync.Mutex            // protects command writes
	matchCh       chan MatchResultMsg    // incoming match results
	replayMatchCh chan ReplayMatchMsg    // incoming replay match results
	respCh        chan sidecarResponse   // synchronous command responses
	frameCh       chan image.Image       // RGBA frames from capture_frame
	previewCh     chan PreviewFrameMsg   // JPEG preview frames from sidecar
	stopOnce      sync.Once
	done          chan struct{}
	snapshotCh     chan PreviewFrameMsg // dedicated channel for snapshot frames
	expectSnapshot atomic.Bool          // true when GetSnapshotFrame is waiting
	crashed        atomic.Bool          // set by readLoop on unexpected EOF
}

// NewSidecarManager locates the encounty-capture binary, starts it as a
// subprocess, and returns a ready-to-use SidecarManager. The binary is
// searched for next to the running Go executable first, then via PATH.
func NewSidecarManager() (*SidecarManager, error) {
	binPath, err := findSidecarBinary()
	if err != nil {
		return nil, err
	}

	cmd := exec.Command(binPath)
	stdinPipe, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("sidecar stdin pipe: %w", err)
	}
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("sidecar stdout pipe: %w", err)
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("sidecar stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("sidecar start: %w", err)
	}

	sm := &SidecarManager{
		cmd:           cmd,
		stdin:         stdinPipe,
		stdout:        bufio.NewReaderSize(stdoutPipe, 4*1024*1024), // 4 MiB buffer for frame data
		matchCh:       make(chan MatchResultMsg, 64),
		replayMatchCh: make(chan ReplayMatchMsg, 64),
		respCh:        make(chan sidecarResponse, 4),
		frameCh:       make(chan image.Image, 3),
		previewCh:     make(chan PreviewFrameMsg, 32),
		done:          make(chan struct{}),
		snapshotCh:    make(chan PreviewFrameMsg, 1),
	}

	// Forward sidecar stderr to the Go structured logger.
	go sm.drainStderr(stderrPipe)

	// Start the read loop that dispatches all stdout data.
	go sm.readLoop()

	// Wait for the sidecar to signal readiness after its internal init
	// (GPU context, match engine). This avoids broken-pipe errors when
	// sending commands before the sidecar is ready to receive them.
	const sidecarReadyTimeout = 10 * time.Second
	select {
	case resp := <-sm.respCh:
		if resp.Type != "ready" {
			sm.Close()
			return nil, fmt.Errorf("sidecar: expected ready signal, got %q", resp.Type)
		}
	case <-time.After(sidecarReadyTimeout):
		sm.Close()
		return nil, fmt.Errorf("sidecar: ready signal timeout after %v", sidecarReadyTimeout)
	case <-sm.done:
		return nil, fmt.Errorf("sidecar: process exited before ready signal")
	}

	slog.Info("Sidecar started", "binary", binPath, "pid", cmd.Process.Pid)
	return sm, nil
}

// MatchResults returns a read-only channel that emits match results from the
// sidecar's detection pipeline. The channel is closed when the sidecar exits.
func (s *SidecarManager) MatchResults() <-chan MatchResultMsg {
	return s.matchCh
}

// sidecarSourceType maps the application-level source type to the value the
// Rust sidecar expects. The frontend uses "screen_region" but the sidecar
// only understands "screen".
func sidecarSourceType(appType string) string {
	if appType == "screen_region" {
		return "screen"
	}
	return appType
}

// ListSources asks the sidecar for available capture sources of the given type
// (e.g. "screen", "window", "camera") and returns the list.
func (s *SidecarManager) ListSources(sourceType string) ([]SourceInfo, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	req := map[string]string{"cmd": "list_sources", "source_type": sidecarSourceType(sourceType)}
	resp, err := s.sendCommand(req)
	if err != nil {
		return nil, fmt.Errorf("list_sources: %w", err)
	}
	if resp.Type == "error" {
		return nil, fmt.Errorf("list_sources: sidecar error: %s", resp.Message)
	}
	return resp.Sources, nil
}

// LoadTemplates sends the given templates to the sidecar so they are available
// for subsequent detection runs.
func (s *SidecarManager) LoadTemplates(sessionID string, templates []SidecarTemplate) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	req := map[string]any{
		"cmd":        "load_templates",
		"session_id": sessionID,
		"templates":  templates,
	}
	resp, err := s.sendCommand(req)
	if err != nil {
		return fmt.Errorf("load_templates: %w", err)
	}
	if resp.Type == "error" {
		return fmt.Errorf("load_templates: sidecar error: %s", resp.Message)
	}
	return nil
}

// StartDetection instructs the sidecar to begin its capture-and-match loop for
// the given source. Match results are delivered asynchronously via MatchResults().
func (s *SidecarManager) StartDetection(sessionID string, sourceType string, sourceID string, config SidecarDetectionConfig) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	req := map[string]any{
		"cmd":         "start_detection",
		"session_id":  sessionID,
		"source_type": sidecarSourceType(sourceType),
		"source_id":   sourceID,
		"config":      config,
	}
	resp, err := s.sendCommandWithTimeout(req, captureFrameTimeout)
	if err != nil {
		return fmt.Errorf("start_detection: %w", err)
	}
	if resp.Type == "error" {
		return fmt.Errorf("start_detection: sidecar error: %s", resp.Message)
	}
	return nil
}

// StopDetection tells the sidecar to stop the detection loop for the given
// session. It is safe to call when no detection is active.
func (s *SidecarManager) StopDetection(sessionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	req := map[string]any{
		"cmd":        "stop_detection",
		"session_id": sessionID,
	}
	resp, err := s.sendCommand(req)
	if err != nil {
		return fmt.Errorf("stop_detection: %w", err)
	}
	if resp.Type == "error" {
		return fmt.Errorf("stop_detection: sidecar error: %s", resp.Message)
	}
	return nil
}

// CaptureFrame requests a single preview frame from the sidecar at the given
// resolution. The frame is returned as a decoded image.Image.
func (s *SidecarManager) CaptureFrame(sourceType, sourceID string, w, h int) (image.Image, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	req := map[string]any{
		"cmd":         "capture_frame",
		"source_type": sidecarSourceType(sourceType),
		"source_id":   sourceID,
		"w":           w,
		"h":           h,
	}

	data, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal capture_frame: %w", err)
	}
	data = append(data, '\n')

	if _, err := s.stdin.Write(data); err != nil {
		return nil, fmt.Errorf("write capture_frame: %w", err)
	}

	// Wait for a binary frame or an error response.
	select {
	case img := <-s.frameCh:
		return img, nil
	case resp := <-s.respCh:
		if resp.Type == "error" {
			return nil, fmt.Errorf("capture_frame: sidecar error: %s", resp.Message)
		}
		// Unexpected non-error response; the frame may still arrive.
		select {
		case img := <-s.frameCh:
			return img, nil
		case <-time.After(captureFrameTimeout):
			return nil, fmt.Errorf("capture_frame: timeout waiting for frame after ack")
		}
	case <-time.After(captureFrameTimeout):
		return nil, fmt.Errorf("capture_frame: timeout after %v", captureFrameTimeout)
	case <-s.done:
		return nil, fmt.Errorf("capture_frame: sidecar closed")
	}
}

// PreviewFrames returns a read-only channel that emits JPEG preview frames
// from the sidecar. The channel is closed when the sidecar exits.
func (s *SidecarManager) PreviewFrames() <-chan PreviewFrameMsg {
	return s.previewCh
}

// StartPreview instructs the sidecar to begin streaming JPEG preview frames
// for the given session.
func (s *SidecarManager) StartPreview(sessionID string, maxDim int, quality int, targetFPS int) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	req := map[string]any{
		"cmd":        "start_preview",
		"session_id": sessionID,
		"max_dim":    maxDim,
		"quality":    quality,
		"target_fps": targetFPS,
	}
	resp, err := s.sendCommand(req)
	if err != nil {
		return fmt.Errorf("start_preview: %w", err)
	}
	if resp.Type == "error" {
		return fmt.Errorf("start_preview: sidecar error: %s", resp.Message)
	}
	return nil
}

// StopPreview instructs the sidecar to stop streaming preview frames for the
// given session.
func (s *SidecarManager) StopPreview(sessionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	req := map[string]any{
		"cmd":        "stop_preview",
		"session_id": sessionID,
	}
	resp, err := s.sendCommand(req)
	if err != nil {
		return fmt.Errorf("stop_preview: %w", err)
	}
	if resp.Type == "error" {
		return fmt.Errorf("stop_preview: sidecar error: %s", resp.Message)
	}
	return nil
}

// GetReplayStatus queries the replay buffer status for a session.
func (s *SidecarManager) GetReplayStatus(sessionID string) (duration float64, frameCount int, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	req := map[string]any{"cmd": "get_replay_status", "session_id": sessionID}
	resp, err := s.sendCommand(req)
	if err != nil {
		return 0, 0, fmt.Errorf("get_replay_status: %w", err)
	}
	if resp.Type == "error" {
		return 0, 0, fmt.Errorf("get_replay_status: %s", resp.Message)
	}
	return resp.DurationSec, resp.FrameCount, nil
}

// SnapshotReplay freezes the replay buffer to disk for later frame-by-frame
// inspection. Returns the number of captured frames, their total duration, and
// the filesystem path where the snapshot was written.
func (s *SidecarManager) SnapshotReplay(sessionID string) (frameCount int, durationSec float64, path string, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	req := map[string]any{"cmd": "snapshot_replay", "session_id": sessionID}
	resp, err := s.sendCommand(req)
	if err != nil {
		return 0, 0, "", fmt.Errorf("snapshot_replay: %w", err)
	}
	if resp.Type == "error" {
		return 0, 0, "", fmt.Errorf("snapshot_replay: %s", resp.Message)
	}
	return resp.FrameCount, resp.DurationSec, resp.Path, nil
}

// DeleteSnapshot removes the snapshot directory for a session.
func (s *SidecarManager) DeleteSnapshot(sessionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	req := map[string]any{"cmd": "delete_snapshot", "session_id": sessionID}
	resp, err := s.sendCommand(req)
	if err != nil {
		return fmt.Errorf("delete_snapshot: %w", err)
	}
	if resp.Type == "error" {
		return fmt.Errorf("delete_snapshot: %s", resp.Message)
	}
	return nil
}

// GetSnapshotFrame requests a single JPEG frame from a saved snapshot. The
// sidecar first sends a JSON acknowledgement, then the binary JPEG data
// arrives as a preview frame on the binary channel.
func (s *SidecarManager) GetSnapshotFrame(sessionID string, frameIndex int) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	req := map[string]any{
		"cmd":         "get_snapshot_frame",
		"session_id":  sessionID,
		"frame_index": frameIndex,
	}
	data, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal get_snapshot_frame: %w", err)
	}
	data = append(data, '\n')

	// Signal the read loop to route the next JPEG frame to snapshotCh.
	s.expectSnapshot.Store(true)

	if _, err := s.stdin.Write(data); err != nil {
		s.expectSnapshot.Store(false)
		return nil, fmt.Errorf("write get_snapshot_frame: %w", err)
	}

	// Wait for the JSON header, then the binary JPEG payload.
	select {
	case resp := <-s.respCh:
		if resp.Type == "error" {
			s.expectSnapshot.Store(false)
			return nil, fmt.Errorf("get_snapshot_frame: %s", resp.Message)
		}
		select {
		case frame := <-s.snapshotCh:
			return frame.JPEGData, nil
		case <-time.After(sidecarTimeout):
			return nil, fmt.Errorf("get_snapshot_frame: timeout waiting for frame data")
		case <-s.done:
			return nil, fmt.Errorf("get_snapshot_frame: sidecar closed")
		}
	case <-time.After(sidecarTimeout):
		s.expectSnapshot.Store(false)
		return nil, fmt.Errorf("get_snapshot_frame: timeout waiting for response")
	case <-s.done:
		s.expectSnapshot.Store(false)
		return nil, fmt.Errorf("get_snapshot_frame: sidecar closed")
	}
}

// TriggerRematch runs NCC matching over the replay buffer within the given
// time window. Results arrive asynchronously on ReplayMatchResults().
func (s *SidecarManager) TriggerRematch(sessionID string, windowSec int) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	req := map[string]any{
		"cmd":        "trigger_rematch",
		"session_id": sessionID,
		"window_sec": windowSec,
	}
	resp, err := s.sendCommand(req)
	if err != nil {
		return fmt.Errorf("trigger_rematch: %w", err)
	}
	if resp.Type == "error" {
		return fmt.Errorf("trigger_rematch: %s", resp.Message)
	}
	return nil
}

// ReplayMatchResults returns a read-only channel that emits asynchronous
// replay match results from the sidecar's re-match pipeline.
func (s *SidecarManager) ReplayMatchResults() <-chan ReplayMatchMsg {
	return s.replayMatchCh
}

// UpdateConfig sends updated detection parameters to a running sidecar
// session without restarting it.
func (s *SidecarManager) UpdateConfig(sessionID string, config SidecarDetectionConfig) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	req := map[string]any{
		"cmd":        "update_config",
		"session_id": sessionID,
		"config":     config,
	}
	resp, err := s.sendCommand(req)
	if err != nil {
		return fmt.Errorf("update_config: %w", err)
	}
	if resp.Type == "error" {
		return fmt.Errorf("update_config: sidecar error: %s", resp.Message)
	}
	return nil
}

// IsHealthy reports whether the sidecar process is still running and
// responsive. It checks both the explicit shutdown signal and the crash
// flag set by the read loop when the process exits unexpectedly.
func (s *SidecarManager) IsHealthy() bool {
	if s.crashed.Load() {
		return false
	}
	select {
	case <-s.done:
		return false
	default:
	}
	return true
}

// Close shuts down the sidecar process. It closes stdin (signalling EOF) and
// waits up to 3 seconds for the process to exit before killing it. Close is
// safe to call multiple times.
func (s *SidecarManager) Close() {
	s.stopOnce.Do(func() {
		_ = s.stdin.Close()

		// Wait for process exit with a deadline.
		exited := make(chan struct{})
		go func() {
			_ = s.cmd.Wait()
			close(exited)
		}()

		select {
		case <-exited:
		case <-time.After(sidecarShutdownGrace):
			slog.Warn("Sidecar did not exit in time, killing", "pid", s.cmd.Process.Pid)
			_ = s.cmd.Process.Kill()
		}

		close(s.done)
		slog.Info("Sidecar stopped")
	})
}

// sendCommandWithTimeout marshals req as JSON, writes it followed by a newline
// to stdin, then waits up to timeout for the next command-response message from
// the readLoop. The caller must hold s.mu.
func (s *SidecarManager) sendCommandWithTimeout(req any, timeout time.Duration) (sidecarResponse, error) {
	// Fast-fail if the sidecar has already crashed or been closed.
	if s.crashed.Load() {
		return sidecarResponse{}, fmt.Errorf("sidecar has crashed")
	}
	select {
	case <-s.done:
		return sidecarResponse{}, fmt.Errorf("sidecar is closed")
	default:
	}

	data, err := json.Marshal(req)
	if err != nil {
		return sidecarResponse{}, fmt.Errorf("marshal command: %w", err)
	}
	data = append(data, '\n')

	if _, err := s.stdin.Write(data); err != nil {
		s.crashed.Store(true)
		return sidecarResponse{}, fmt.Errorf("write command: %w", err)
	}

	select {
	case resp := <-s.respCh:
		return resp, nil
	case <-time.After(timeout):
		return sidecarResponse{}, fmt.Errorf("sidecar response timeout after %v", timeout)
	case <-s.done:
		return sidecarResponse{}, fmt.Errorf("sidecar closed while waiting for response")
	}
}

// sendCommand marshals req as JSON, writes it followed by a newline to stdin,
// then waits for the next command-response message from the readLoop. The
// caller must hold s.mu.
func (s *SidecarManager) sendCommand(req any) (sidecarResponse, error) {
	return s.sendCommandWithTimeout(req, sidecarTimeout)
}

// readLoop is the long-running goroutine that reads all data from the
// sidecar's stdout. Binary frames (0xFD prefix) are decoded using the
// extended 16-byte header and dispatched by format: RGBA frames go to frameCh,
// JPEG preview frames go to previewCh. JSON lines are parsed and dispatched:
// match_result messages go to matchCh, everything else goes to respCh.
func (s *SidecarManager) readLoop() {
	defer close(s.matchCh)
	defer close(s.replayMatchCh)
	defer close(s.previewCh)
	defer func() {
		// Mark the sidecar as crashed so the manager can detect it and
		// spawn a replacement. This flag is only set when the read loop
		// exits before Close() is called (i.e. the process died).
		select {
		case <-s.done:
			// Close() already signalled — normal shutdown, not a crash.
		default:
			s.crashed.Store(true)
			slog.Warn("Sidecar read loop exited unexpectedly, process likely crashed")
		}
	}()

	for {
		select {
		case <-s.done:
			return
		default:
		}

		resp, ok := s.readNextMessage()
		if !ok {
			return
		}
		if resp.Type != "" {
			s.dispatchMessage(resp)
		}
	}
}

// readNextMessage reads the next message from the sidecar's stdout. It peeks
// at the first byte to distinguish binary frames from JSON lines. Returns
// (resp, true) on success, or (zero, false) when the loop should stop.
func (s *SidecarManager) readNextMessage() (sidecarResponse, bool) {
	b, err := s.stdout.Peek(1)
	if err != nil {
		if err != io.EOF {
			slog.Warn("Sidecar stdout read error", "error", err)
		}
		return sidecarResponse{}, false
	}

	if b[0] == frameMagic {
		if decErr := s.decodeFrameExtended(); decErr != nil {
			slog.Warn("Sidecar frame decode error", "error", decErr)
			return sidecarResponse{}, false
		}
		// Frame handled; return an empty response so the caller continues.
		return sidecarResponse{}, true
	}

	// Read a JSON line.
	line, err := s.stdout.ReadBytes('\n')
	if err != nil {
		if err != io.EOF {
			slog.Warn("Sidecar stdout line read error", "error", err)
		}
		return sidecarResponse{}, false
	}

	var resp sidecarResponse
	if err := json.Unmarshal(line, &resp); err != nil {
		slog.Debug("Sidecar non-JSON stdout line", "line", string(line))
		return sidecarResponse{}, true
	}

	return resp, true
}

// dispatchMessage routes a parsed JSON response from the sidecar to the
// appropriate channel based on its message type.
func (s *SidecarManager) dispatchMessage(resp sidecarResponse) {
	switch resp.Type {
	case "match_result":
		msg := MatchResultMsg{
			SessionID:   resp.SessionID,
			BestScore:   resp.BestScore,
			FrameDelta:  resp.FrameDelta,
			TimestampMs: resp.TimestampMs,
		}
		// Non-blocking send; drop if the consumer is behind.
		select {
		case s.matchCh <- msg:
		default:
			slog.Debug("Sidecar match result dropped, consumer too slow")
		}

	case "replay_match":
		msg := ReplayMatchMsg{
			SessionID:   resp.SessionID,
			BestScore:   resp.BestScore,
			TimestampMs: resp.TimestampMs,
		}
		select {
		case s.replayMatchCh <- msg:
		default:
			slog.Debug("Sidecar replay match dropped, consumer too slow")
		}

	case "ready":
		select {
		case s.respCh <- resp:
		default:
		}

	case "error":
		slog.Warn("Sidecar reported error", "message", resp.Message)
		// Also forward to respCh in case a command is waiting.
		select {
		case s.respCh <- resp:
		default:
		}

	default:
		// Command acknowledgement (templates_loaded, detection_started,
		// detection_stopped, sources, config_updated, preview_started,
		// preview_stopped, etc.) — forward to the waiting caller.
		select {
		case s.respCh <- resp:
		default:
			slog.Debug("Sidecar response dropped, no command waiting", "type", resp.Type)
		}
	}
}

// decodeFrameExtended reads the extended 16-byte binary header, optional
// session ID, and payload from stdout. RGBA frames (format 0x00) are sent
// to frameCh; JPEG preview frames (format 0x01) are sent to previewCh.
func (s *SidecarManager) decodeFrameExtended() error {
	var hdr frameHeader
	if err := binary.Read(s.stdout, binary.LittleEndian, &hdr); err != nil {
		return fmt.Errorf("read frame header: %w", err)
	}

	// Read optional session ID.
	var sessionID string
	if hdr.SessionLen > 0 {
		sidBuf := make([]byte, hdr.SessionLen)
		if _, err := io.ReadFull(s.stdout, sidBuf); err != nil {
			return fmt.Errorf("read session id (%d bytes): %w", hdr.SessionLen, err)
		}
		sessionID = string(sidBuf)
	}

	// Read payload using the explicit length from the header.
	payload := make([]byte, hdr.PayloadLen)
	if _, err := io.ReadFull(s.stdout, payload); err != nil {
		return fmt.Errorf("read payload (%d bytes): %w", hdr.PayloadLen, err)
	}

	switch hdr.Format {
	case 0x00: // RGBA
		w := int(hdr.Width)
		h := int(hdr.Height)
		if sessionID != "" {
			// RGBA preview frame — route to previewCh for raw preview subscribers.
			msg := PreviewFrameMsg{
				SessionID: sessionID,
				Width:     w,
				Height:    h,
				IsRaw:     true,
				RGBAData:  payload,
			}
			select {
			case s.previewCh <- msg:
			default:
				slog.Debug("Raw preview frame dropped, consumer too slow", "session_id", sessionID)
			}
		} else {
			// One-shot capture frame (no session) — route to frameCh.
			img := &image.RGBA{
				Pix:    payload,
				Stride: w * 4,
				Rect:   image.Rect(0, 0, w, h),
			}
			select {
			case s.frameCh <- img:
			default:
			}
		}

	case 0x01: // JPEG preview
		msg := PreviewFrameMsg{
			SessionID: sessionID,
			Width:     int(hdr.Width),
			Height:    int(hdr.Height),
			JPEGData:  payload,
		}
		// If GetSnapshotFrame is waiting, route there instead of the
		// preview channel to avoid the race where both consumers read
		// from the same channel.
		if s.expectSnapshot.CompareAndSwap(true, false) {
			select {
			case s.snapshotCh <- msg:
			default:
			}
		} else {
			select {
			case s.previewCh <- msg:
			default:
				slog.Debug("Preview frame dropped, consumer too slow", "session_id", sessionID)
			}
		}

	case 0x02: // fMP4 video chunk
		isInit := hdr.Width == 1
		msg := PreviewFrameMsg{
			SessionID: sessionID,
			IsVideo:   true,
			IsInit:    isInit,
			FMP4Data:  payload,
		}
		select {
		case s.previewCh <- msg:
		default:
			slog.Debug("Video chunk dropped, consumer too slow", "session_id", sessionID)
		}

	default:
		slog.Warn("Unknown frame format from sidecar", "format", hdr.Format)
	}

	return nil
}

// drainStderr reads stderr from the sidecar line by line and logs each line
// via the structured logger.
func (s *SidecarManager) drainStderr(r io.Reader) {
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		slog.Warn("Sidecar stderr", "line", scanner.Text())
	}
}

// findSidecarBinary locates the encounty-capture binary. It checks (in order):
// 1. Next to the running Go executable (production builds).
// 2. The Cargo debug/release output directory relative to the working directory
//    (development: ../capture-sidecar/target/{debug,release}/).
// 3. The system PATH.
func findSidecarBinary() (string, error) {
	// Check next to the current executable.
	selfPath, err := os.Executable()
	if err == nil {
		candidate := filepath.Join(filepath.Dir(selfPath), sidecarBinaryName)
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
	}

	// Check Cargo build output relative to cwd (for dev mode with `go run`).
	if cwd, err := os.Getwd(); err == nil {
		for _, profile := range []string{"release", "debug"} {
			candidate := filepath.Join(cwd, "..", "capture-sidecar", "target", profile, sidecarBinaryName)
			if abs, err := filepath.Abs(candidate); err == nil {
				if _, err := os.Stat(abs); err == nil {
					return abs, nil
				}
			}
		}
	}

	// Fall back to PATH.
	p, err := exec.LookPath(sidecarBinaryName)
	if err != nil {
		return "", fmt.Errorf("sidecar binary %q not found next to executable or in PATH", sidecarBinaryName)
	}
	return p, nil
}
