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
	"time"
)

// frameMagic is the sentinel byte that precedes a raw RGBA frame on the
// sidecar's stdout. Any byte that is NOT frameMagic starts a JSON text line.
const frameMagic byte = 0xFD

// sidecarTimeout is the deadline for synchronous command–response exchanges.
const sidecarTimeout = 5 * time.Second

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

// sidecarResponse is the generic JSON envelope returned by the sidecar on
// stdout for every command except raw frame data.
type sidecarResponse struct {
	Status  string       `json:"status"`            // "ok" or "error"
	Error   string       `json:"error,omitempty"`
	Sources []SourceInfo `json:"sources,omitempty"` // list_sources payload
}

// frameHeader mirrors the binary frame header emitted by the sidecar before
// each raw RGBA frame payload.
type frameHeader struct {
	Magic     byte
	Width     uint16
	Height    uint16
	Timestamp uint32
	Reserved  [3]byte
}

// SidecarManager manages communication with the encounty-capture Rust binary.
// It sends JSON commands via stdin and reads JSON responses plus raw RGBA frame
// data from stdout.
type SidecarManager struct {
	cmd      *exec.Cmd
	stdin    io.WriteCloser
	stdout   *bufio.Reader
	mu       sync.Mutex      // protects command writes and synchronous reads
	frameCh  chan image.Image // incoming decoded frames
	stopOnce sync.Once
	done     chan struct{}
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
		cmd:    cmd,
		stdin:  stdinPipe,
		stdout: bufio.NewReaderSize(stdoutPipe, 4*1024*1024), // 4 MiB buffer for frame data
		done:   make(chan struct{}),
	}

	// Forward sidecar stderr to the Go structured logger.
	go sm.drainStderr(stderrPipe)

	slog.Info("Sidecar started", "binary", binPath, "pid", cmd.Process.Pid)
	return sm, nil
}

// ListSources asks the sidecar for available capture sources of the given type
// (e.g. "screen", "window", "camera") and returns the list.
func (s *SidecarManager) ListSources(sourceType string) ([]SourceInfo, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	req := map[string]string{"cmd": "list_sources", "source_type": sourceType}
	resp, err := s.sendCommand(req)
	if err != nil {
		return nil, fmt.Errorf("list_sources: %w", err)
	}
	if resp.Status == "error" {
		return nil, fmt.Errorf("list_sources: sidecar error: %s", resp.Error)
	}
	return resp.Sources, nil
}

// StartCapture tells the sidecar to begin streaming frames for the given
// source at the requested resolution. The returned channel emits decoded
// image.Image values until StopCapture or Close is called.
func (s *SidecarManager) StartCapture(sourceID string, w, h int) (<-chan image.Image, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	req := map[string]any{
		"cmd":       "start_capture",
		"source_id": sourceID,
		"w":         w,
		"h":         h,
	}
	resp, err := s.sendCommand(req)
	if err != nil {
		return nil, fmt.Errorf("start_capture: %w", err)
	}
	if resp.Status == "error" {
		return nil, fmt.Errorf("start_capture: sidecar error: %s", resp.Error)
	}

	s.frameCh = make(chan image.Image, 3)
	go s.readFrames()
	return s.frameCh, nil
}

// StopCapture asks the sidecar to stop streaming frames. It is safe to call
// multiple times or when no capture is active.
func (s *SidecarManager) StopCapture() {
	s.mu.Lock()
	defer s.mu.Unlock()

	req := map[string]string{"cmd": "stop_capture"}
	if _, err := s.sendCommand(req); err != nil {
		slog.Warn("Sidecar stop_capture failed", "error", err)
	}
}

// Close shuts down the sidecar process. It sends a stop_capture command,
// closes stdin (signalling EOF), and waits up to 3 seconds for the process
// to exit before killing it. Close is safe to call multiple times.
func (s *SidecarManager) Close() {
	s.stopOnce.Do(func() {
		// Best-effort stop of any active capture.
		s.mu.Lock()
		req := map[string]string{"cmd": "stop_capture"}
		_, _ = s.sendCommand(req)
		s.mu.Unlock()

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

// sendCommand marshals req as JSON, writes it followed by a newline to stdin,
// then reads and parses the next JSON line from stdout. The caller must hold
// s.mu. A timeout is applied to the read via a deadline goroutine.
func (s *SidecarManager) sendCommand(req any) (sidecarResponse, error) {
	data, err := json.Marshal(req)
	if err != nil {
		return sidecarResponse{}, fmt.Errorf("marshal command: %w", err)
	}
	data = append(data, '\n')

	if _, err := s.stdin.Write(data); err != nil {
		return sidecarResponse{}, fmt.Errorf("write command: %w", err)
	}

	type result struct {
		resp sidecarResponse
		err  error
	}
	ch := make(chan result, 1)
	go func() {
		resp, readErr := s.readJSONResponse()
		ch <- result{resp, readErr}
	}()

	select {
	case r := <-ch:
		return r.resp, r.err
	case <-time.After(sidecarTimeout):
		return sidecarResponse{}, fmt.Errorf("sidecar response timeout after %v", sidecarTimeout)
	}
}

// readJSONResponse reads a single newline-terminated JSON line from stdout,
// skipping any binary frame data that may be interleaved.
func (s *SidecarManager) readJSONResponse() (sidecarResponse, error) {
	for {
		b, err := s.stdout.Peek(1)
		if err != nil {
			return sidecarResponse{}, fmt.Errorf("peek stdout: %w", err)
		}
		if b[0] == frameMagic {
			// Discard an interleaved frame that arrived before the JSON response.
			if err := s.discardFrame(); err != nil {
				return sidecarResponse{}, fmt.Errorf("discard frame: %w", err)
			}
			continue
		}

		line, err := s.stdout.ReadBytes('\n')
		if err != nil {
			return sidecarResponse{}, fmt.Errorf("read response line: %w", err)
		}
		var resp sidecarResponse
		if err := json.Unmarshal(line, &resp); err != nil {
			return sidecarResponse{}, fmt.Errorf("unmarshal response: %w", err)
		}
		return resp, nil
	}
}

// discardFrame reads and discards a full binary frame (header + RGBA payload)
// from stdout. Used when a frame arrives while waiting for a JSON response.
func (s *SidecarManager) discardFrame() error {
	var hdr frameHeader
	if err := binary.Read(s.stdout, binary.LittleEndian, &hdr); err != nil {
		return err
	}
	payloadSize := int(hdr.Width) * int(hdr.Height) * 4
	_, err := s.stdout.Discard(payloadSize)
	return err
}

// readFrames is the long-running goroutine that reads interleaved binary frame
// data and JSON status lines from the sidecar's stdout. Decoded frames are
// sent on s.frameCh; the channel is closed when the sidecar exits or an
// unrecoverable read error occurs.
func (s *SidecarManager) readFrames() {
	defer close(s.frameCh)

	for {
		select {
		case <-s.done:
			return
		default:
		}

		b, err := s.stdout.Peek(1)
		if err != nil {
			if err != io.EOF {
				slog.Warn("Sidecar stdout read error", "error", err)
			}
			return
		}

		if b[0] == frameMagic {
			img, err := s.decodeFrame()
			if err != nil {
				slog.Warn("Sidecar frame decode error", "error", err)
				return
			}
			// Non-blocking send; drop the frame if the consumer is behind.
			select {
			case s.frameCh <- img:
			default:
			}
			continue
		}

		// Non-frame line — read as JSON (could be error or status update).
		line, err := s.stdout.ReadBytes('\n')
		if err != nil {
			if err != io.EOF {
				slog.Warn("Sidecar stdout line read error", "error", err)
			}
			return
		}
		var resp sidecarResponse
		if err := json.Unmarshal(line, &resp); err != nil {
			slog.Debug("Sidecar non-JSON stdout line", "line", string(line))
			continue
		}
		if resp.Status == "error" {
			slog.Warn("Sidecar reported error during capture", "error", resp.Error)
		}
	}
}

// decodeFrame reads a binary frame header followed by W*H*4 raw RGBA bytes
// from stdout and returns the resulting image.RGBA.
func (s *SidecarManager) decodeFrame() (*image.RGBA, error) {
	var hdr frameHeader
	if err := binary.Read(s.stdout, binary.LittleEndian, &hdr); err != nil {
		return nil, fmt.Errorf("read frame header: %w", err)
	}

	w := int(hdr.Width)
	h := int(hdr.Height)
	payloadSize := w * h * 4

	pix := make([]byte, payloadSize)
	if _, err := io.ReadFull(s.stdout, pix); err != nil {
		return nil, fmt.Errorf("read frame payload (%dx%d, %d bytes): %w", w, h, payloadSize, err)
	}

	img := &image.RGBA{
		Pix:    pix,
		Stride: w * 4,
		Rect:   image.Rect(0, 0, w, h),
	}
	return img, nil
}

// drainStderr reads stderr from the sidecar line by line and logs each line
// via the structured logger.
func (s *SidecarManager) drainStderr(r io.Reader) {
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		slog.Debug("Sidecar stderr", "line", scanner.Text())
	}
}

// findSidecarBinary locates the encounty-capture binary. It first checks the
// directory containing the running Go executable, then falls back to a PATH
// lookup.
func findSidecarBinary() (string, error) {
	// Check next to the current executable.
	selfPath, err := os.Executable()
	if err == nil {
		candidate := filepath.Join(filepath.Dir(selfPath), sidecarBinaryName)
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
	}

	// Fall back to PATH.
	p, err := exec.LookPath(sidecarBinaryName)
	if err != nil {
		return "", fmt.Errorf("sidecar binary %q not found next to executable or in PATH", sidecarBinaryName)
	}
	return p, nil
}
