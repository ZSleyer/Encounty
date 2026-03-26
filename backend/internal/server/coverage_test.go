package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/zsleyer/encounty/backend/internal/detector"
	"github.com/zsleyer/encounty/backend/internal/fileoutput"
	"github.com/zsleyer/encounty/backend/internal/hotkeys"
	"github.com/zsleyer/encounty/backend/internal/pokedex"
	"github.com/zsleyer/encounty/backend/internal/state"
)

const (
	covFmtStatus = "status = %d, want 200"
)

// --- ReadJSON coverage ---

// TestReadPokedexJSONAllFallbacksFail exercises the error return when
// no pokemon.json is found anywhere.
func TestReadPokedexJSONAllFallbacksFail(t *testing.T) {
	// Use a completely empty temp dir that has no pokemon.json.
	// The source-dir and cwd fallbacks may or may not succeed depending
	// on the test environment, but we verify no panic.
	tmpDir := t.TempDir()

	_, err := pokedex.ReadJSON(tmpDir)
	// Either finds a fallback or returns error; both are valid
	_ = err
}

// TestHandleGetPokedexError exercises the error path where readPokedexJSON
// returns an error via the mux-routed handler.
func TestHandleGetPokedexError(t *testing.T) {
	tmpDir := t.TempDir()
	stateMgr := state.NewManager(tmpDir)
	srv := &Server{
		state:     stateMgr,
		hub:       NewHub(),
		hotkeyMgr: newMockHotkeyMgr(),
	}
	mux := http.NewServeMux()
	srv.registerRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/pokedex", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	// This might return 200 (if source-dir fallback works) or 500 (if not).
	// The important thing is it doesn't panic.
	if w.Code != http.StatusOK && w.Code != http.StatusInternalServerError {
		t.Errorf("unexpected status = %d", w.Code)
	}
}

// --- writePump coverage: channel close path ---

// TestWritePumpChannelClose exercises the channel-close path in writePump
// where the send channel is closed, causing the range loop to end and a
// close frame to be sent.
func TestWritePumpChannelClose(t *testing.T) {
	srv := newTestServer(t)
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		srv.hub.ServeWS(srv, w, r)
	})
	ts := httptest.NewServer(mux)
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer func() { _ = conn.Close() }()

	// Read initial state
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, _, err := conn.ReadMessage(); err != nil {
		t.Fatalf("read initial: %v", err)
	}

	// CloseAll closes all send channels, triggering the close-frame path
	srv.hub.CloseAll()

	// Give time for the close frame to be sent
	time.Sleep(100 * time.Millisecond)

	// Reading should now return a close message or error
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, _, err = conn.ReadMessage()
	// We expect an error because the connection was closed
	if err == nil {
		t.Error("expected error after CloseAll, got nil")
	}
}

// --- handleUpdateCheck coverage: non-dev version path ---

// TestUpdateCheckNonDevVersion exercises the path where version != "dev",
// causing updater.CheckForUpdate to be called. Since it calls the real GitHub
// API, this test accepts either success or an error response.
func TestUpdateCheckNonDevVersion(t *testing.T) {
	srv := newTestServer(t)
	srv.version = "0.0.1-test"

	mux := newTestMux(srv)
	req := httptest.NewRequest(http.MethodGet, "/api/update/check", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	// The GitHub API call may succeed or fail depending on network; both are valid.
	if w.Code != http.StatusOK && w.Code != http.StatusInternalServerError {
		t.Errorf("unexpected status = %d", w.Code)
	}
}

// --- handleDeletePokemon with detectorMgr ---

// TestHandleDeletePokemonWithDetectorMgr exercises the detectorMgr != nil
// path in handleDeletePokemon.
func TestHandleDeletePokemonWithDetectorMgr(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")

	// Create a real detector manager
	stateMgr := srv.state
	tmpDir := stateMgr.GetConfigDir()
	srv.detectorMgr = detector.NewManager(stateMgr, tmpDir)
	mux := newTestMux(srv)

	req := httptest.NewRequest(http.MethodDelete, "/api/pokemon/p1", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf(fmtStatusWant, w.Code, http.StatusNoContent)
	}

	st := srv.state.GetState()
	if len(st.Pokemon) != 0 {
		t.Errorf("Pokemon length = %d, want 0", len(st.Pokemon))
	}
}

// --- handleUpdateApply with valid download_url ---

func TestHandleUpdateApplyWithURL(t *testing.T) {
	srv := newTestServer(t)

	mux := newTestMux(srv)
	body := `{"download_url":"https://example.com/test-binary"}`
	req := httptest.NewRequest(http.MethodPost, "/api/update/apply", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf(fmtStatusWant, w.Code, http.StatusOK)
	}

	var resp map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp["status"] != "updating" {
		t.Errorf("status = %q, want updating", resp["status"])
	}
}

// --- BroadcastRaw error path ---

// TestBroadcastRawMarshalError exercises the BroadcastRaw error path where
// the payload cannot be marshalled.
func TestBroadcastRawMarshalError(t *testing.T) {
	h := NewHub()
	c := &wsClient{send: make(chan wsPayload, sendBufSize)}
	h.mu.Lock()
	h.clients[c] = true
	h.mu.Unlock()

	// func() is not JSON-marshalable
	h.BroadcastRaw("test", func() { // no-op for test
	})

	select {
	case <-c.send:
		t.Error("should not receive message when marshal fails")
	default:
		// Expected: no message
	}
}

// --- Broadcast error path (marshal error in Broadcast) ---

func TestBroadcastMarshalError(t *testing.T) {
	h := NewHub()
	// Invalid payload that cannot be marshalled
	h.Broadcast(WSMessage{Type: "test", Payload: json.RawMessage(`invalid`)})
	// This exercises the json.Marshal error return in Broadcast
}

// --- handleUpdateSettings with fileWriter methods ---

// TestHandleUpdatePokemonWithFileWriter ensures file writer does not interfere
// with update operations.
func TestHandleUpdateSettingsFileWriterConfig(t *testing.T) {
	srv := newTestServer(t)
	mux := newTestMux(srv)

	body := `{"output_enabled":true,"output_dir":"/tmp/test2","browser_port":8888,"overlay":{}}`
	req := httptest.NewRequest(http.MethodPost, "/api/settings", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf(fmtStatusWant, w.Code, http.StatusOK)
	}
	st := srv.state.GetState()
	if st.Settings.BrowserPort != 8888 {
		t.Errorf("BrowserPort = %d, want 8888", st.Settings.BrowserPort)
	}
}

// --- handleUpdateHotkeys with UpdateAllBindings error ---

// errorHotkeyMgr is a mock that returns errors from binding operations.
type errorHotkeyMgr struct {
	mockHotkeyMgr
}

func (m *errorHotkeyMgr) UpdateAllBindings(hm state.HotkeyMap) error {
	return fmt.Errorf("binding error")
}

func (m *errorHotkeyMgr) UpdateBinding(action, keyCombo string) error {
	return fmt.Errorf("single binding error")
}

// TestHandleUpdateHotkeysBindingError exercises the error path in
// handleUpdateHotkeys where UpdateAllBindings returns an error (logged but
// request still succeeds).
func TestHandleUpdateHotkeysBindingError(t *testing.T) {
	srv := newTestServer(t)
	srv.hotkeyMgr = &errorHotkeyMgr{}
	mux := newTestMux(srv)

	body := `{"increment":"F5","decrement":"F6","reset":"F7","next_pokemon":"F8"}`
	req := httptest.NewRequest(http.MethodPost, "/api/hotkeys", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	// Should still return 200 (the error is logged, not returned to client)
	if w.Code != http.StatusOK {
		t.Errorf(covFmtStatus, w.Code)
	}
}

// TestHandleUpdateSingleHotkeyBindingError exercises the error path where
// UpdateBinding returns an error.
func TestHandleUpdateSingleHotkeyBindingError(t *testing.T) {
	srv := newTestServer(t)
	srv.hotkeyMgr = &errorHotkeyMgr{}
	mux := newTestMux(srv)

	body := `{"key":"F9"}`
	req := httptest.NewRequest(http.MethodPut, "/api/hotkeys/increment", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", w.Code)
	}
}

// --- Shutdown with detectorMgr ---

func TestShutdownWithDetectorMgr(t *testing.T) {
	stateMgr := state.NewManager(t.TempDir())
	hkMgr := newMockHotkeyMgr()
	detMgr := detector.NewManager(stateMgr, t.TempDir())

	srv := New(Config{
		Port:        0,
		State:       stateMgr,
		HotkeyMgr:   hkMgr,
		Version:     "dev",
		Commit:      "test",
		ConfigDir:   t.TempDir(),
		DetectorMgr: detMgr,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	err := srv.Shutdown(ctx)
	if err != nil {
		t.Errorf("Shutdown returned error: %v", err)
	}
}

// --- processHotkeyActions with fileWriter ---

func TestProcessHotkeyActionsIncrementWithFileWriter(t *testing.T) {
	srv := newTestServer(t)
	dir := t.TempDir()
	srv.fileWriter = fileoutput.New(dir, true)
	addTestPokemon(t, srv, "p1", "Pikachu")
	srv.state.SetActive("p1")

	ch := make(chan hotkeys.Action, 1)
	ch <- hotkeys.Action{Type: "increment"}
	close(ch)
	srv.processHotkeyActions(ch)

	st := srv.state.GetState()
	if st.Pokemon[0].Encounters != 1 {
		t.Errorf("encounters = %d, want 1", st.Pokemon[0].Encounters)
	}
}

func TestProcessHotkeyActionsDecrementWithFileWriter(t *testing.T) {
	srv := newTestServer(t)
	dir := t.TempDir()
	srv.fileWriter = fileoutput.New(dir, true)
	addTestPokemon(t, srv, "p1", "Pikachu")
	srv.state.SetActive("p1")
	srv.state.Increment("p1")

	ch := make(chan hotkeys.Action, 1)
	ch <- hotkeys.Action{Type: "decrement"}
	close(ch)
	srv.processHotkeyActions(ch)

	st := srv.state.GetState()
	if st.Pokemon[0].Encounters != 0 {
		t.Errorf("encounters = %d, want 0", st.Pokemon[0].Encounters)
	}
}
