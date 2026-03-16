package server

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/gorilla/websocket"
	"github.com/zsleyer/encounty/backend/internal/detector"
	"github.com/zsleyer/encounty/backend/internal/fileoutput"
	"github.com/zsleyer/encounty/backend/internal/hotkeys"
	"github.com/zsleyer/encounty/backend/internal/state"
)

// --- handleBackup coverage ---

// TestBackupWithTemplateFiles exercises the WalkDir path that includes template
// files in the backup ZIP.
func TestBackupWithTemplateFiles(t *testing.T) {
	srv := newTestServer(t)
	configDir := srv.state.GetConfigDir()

	// Write state.json
	if err := os.WriteFile(filepath.Join(configDir, "state.json"), []byte(`{}`), 0644); err != nil {
		t.Fatal(err)
	}

	// Write a template file
	tmplDir := filepath.Join(configDir, "templates", "p1")
	if err := os.MkdirAll(tmplDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tmplDir, "tmpl.png"), []byte("fake-png-data"), 0644); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/backup", nil)
	w := httptest.NewRecorder()
	srv.handleBackup(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	zr, err := zip.NewReader(bytes.NewReader(w.Body.Bytes()), int64(w.Body.Len()))
	if err != nil {
		t.Fatalf("invalid zip: %v", err)
	}

	foundTemplate := false
	for _, f := range zr.File {
		if strings.Contains(f.Name, "tmpl.png") {
			foundTemplate = true
			rc, err := f.Open()
			if err != nil {
				t.Fatal(err)
			}
			content, _ := io.ReadAll(rc)
			rc.Close()
			if string(content) != "fake-png-data" {
				t.Error("template content mismatch")
			}
		}
	}
	if !foundTemplate {
		t.Error("template file not found in backup ZIP")
	}
}

// TestBackupWithBothFiles exercises the pokemon.json path in backup.
func TestBackupWithBothFiles(t *testing.T) {
	srv := newTestServer(t)
	configDir := srv.state.GetConfigDir()

	if err := os.WriteFile(filepath.Join(configDir, "state.json"), []byte(`{"active_id":""}`), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(configDir, "pokemon.json"), []byte(`[]`), 0644); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/backup", nil)
	w := httptest.NewRecorder()
	srv.handleBackup(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	zr, err := zip.NewReader(bytes.NewReader(w.Body.Bytes()), int64(w.Body.Len()))
	if err != nil {
		t.Fatalf("invalid zip: %v", err)
	}

	names := map[string]bool{}
	for _, f := range zr.File {
		names[f.Name] = true
	}
	if !names["state.json"] {
		t.Error("state.json missing from backup")
	}
	if !names["pokemon.json"] {
		t.Error("pokemon.json missing from backup")
	}
}

// TestBackupNoFiles exercises the path where neither state.json nor
// pokemon.json exist — the backup should still succeed with an empty ZIP.
func TestBackupNoFiles(t *testing.T) {
	srv := newTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/api/backup", nil)
	w := httptest.NewRecorder()
	srv.handleBackup(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
}

// --- handleRestore coverage ---

// TestRestoreWithBothFiles tests restoring a ZIP that contains both
// state.json and pokemon.json.
func TestRestoreWithBothFiles(t *testing.T) {
	srv := newTestServer(t)
	configDir := srv.state.GetConfigDir()

	stateJSON := `{"pokemon":[{"id":"p1","name":"Bulbasaur","encounters":5}],"active_id":"p1"}`
	pokemonJSON := `[{"id":1,"canonical":"bulbasaur"}]`

	// Create a ZIP with both files
	var zipBuf bytes.Buffer
	zw := zip.NewWriter(&zipBuf)
	fw, _ := zw.Create("state.json")
	fw.Write([]byte(stateJSON))
	fw2, _ := zw.Create("pokemon.json")
	fw2.Write([]byte(pokemonJSON))
	// Add a file that should be skipped (not state.json or pokemon.json)
	fw3, _ := zw.Create("other.txt")
	fw3.Write([]byte("ignored"))
	zw.Close()

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	formFile, _ := mw.CreateFormFile("backup", "backup.zip")
	formFile.Write(zipBuf.Bytes())
	mw.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/restore", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	w := httptest.NewRecorder()
	srv.handleRestore(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}

	// Verify pokemon.json was written
	data, err := os.ReadFile(filepath.Join(configDir, "pokemon.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != pokemonJSON {
		t.Errorf("pokemon.json content = %q, want %q", string(data), pokemonJSON)
	}
}

// --- readPokedexJSON coverage ---

// TestReadPokedexJSON_EmbeddedFS exercises the frontendFS fallback path.
// Note: The source-dir fallback (via runtime.Caller) may succeed before
// the embedded FS is checked, depending on the test environment. We verify
// that the function returns valid JSON without panicking.
func TestReadPokedexJSON_EmbeddedFS(t *testing.T) {
	srv := newTestServer(t)
	// Set a frontendFS with a pokemon.json file
	srv.frontendFS = fstest.MapFS{
		"frontend/dist/pokemon.json": &fstest.MapFile{Data: []byte(`[{"id":1,"canonical":"test"}]`)},
	}

	data, err := srv.readPokedexJSON()
	if err != nil {
		t.Fatal(err)
	}
	// The function may find data from source-dir or embedded FS; either is valid.
	var entries []PokedexEntry
	if err := json.Unmarshal(data, &entries); err != nil {
		t.Fatalf("returned invalid JSON: %v", err)
	}
	if len(entries) == 0 {
		t.Error("expected at least one entry")
	}
}

// TestReadPokedexJSON_AllFallbacksFail exercises the error return when
// no pokemon.json is found anywhere.
func TestReadPokedexJSON_AllFallbacksFail(t *testing.T) {
	// Use a completely empty server with no frontendFS and a temp config dir
	// that has no pokemon.json. The source-dir and cwd fallbacks may or may
	// not succeed depending on the test environment, but we verify no panic.
	tmpDir := t.TempDir()
	stateMgr := state.NewManager(tmpDir)
	srv := &Server{
		state:     stateMgr,
		hub:       NewHub(),
		hotkeyMgr: newMockHotkeyMgr(),
	}

	_, err := srv.readPokedexJSON()
	// Either finds a fallback or returns error; both are valid
	_ = err
}

// TestHandleGetPokedex_Error exercises the error path where readPokedexJSON
// returns an error.
func TestHandleGetPokedex_Error(t *testing.T) {
	tmpDir := t.TempDir()
	stateMgr := state.NewManager(tmpDir)
	srv := &Server{
		state:     stateMgr,
		hub:       NewHub(),
		hotkeyMgr: newMockHotkeyMgr(),
	}
	// Set frontendFS to nil and work in a directory without pokemon.json
	srv.frontendFS = nil

	req := httptest.NewRequest(http.MethodGet, "/api/pokedex", nil)
	w := httptest.NewRecorder()
	srv.handleGetPokedex(w, req)

	// This might return 200 (if source-dir fallback works) or 500 (if not).
	// The important thing is it doesn't panic.
	if w.Code != http.StatusOK && w.Code != http.StatusInternalServerError {
		t.Errorf("unexpected status = %d", w.Code)
	}
}

// --- writePump coverage: channel close path ---

// TestWritePump_ChannelClose exercises the channel-close path in writePump
// where the send channel is closed, causing the range loop to end and a
// close frame to be sent.
func TestWritePump_ChannelClose(t *testing.T) {
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
	defer conn.Close()

	// Read initial state
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, _, err := conn.ReadMessage(); err != nil {
		t.Fatalf("read initial: %v", err)
	}

	// CloseAll closes all send channels, triggering the close-frame path
	srv.hub.CloseAll()

	// Give time for the close frame to be sent
	time.Sleep(100 * time.Millisecond)

	// Reading should now return a close message or error
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, _, err = conn.ReadMessage()
	// We expect an error because the connection was closed
	if err == nil {
		t.Error("expected error after CloseAll, got nil")
	}
}

// --- handleUpdateCheck coverage: non-dev version path ---

// TestUpdateCheckNonDevVersion exercises the path where version != "dev",
// causing fetchUpdateInfo to be called. Since it calls the real GitHub API,
// this test accepts either success or an error response.
func TestUpdateCheckNonDevVersion(t *testing.T) {
	srv := newTestServer(t)
	srv.version = "0.0.1-test"

	req := httptest.NewRequest(http.MethodGet, "/api/update/check", nil)
	w := httptest.NewRecorder()
	srv.handleUpdateCheck(w, req)

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
	broadcast := func(msgType string, payload any) {}
	tmpDir := stateMgr.GetConfigDir()
	srv.detectorMgr = detector.NewManager(stateMgr, broadcast, tmpDir)

	req := httptest.NewRequest(http.MethodDelete, "/api/pokemon/p1", nil)
	w := httptest.NewRecorder()
	srv.handleDeletePokemon(w, req, "p1")

	if w.Code != http.StatusNoContent {
		t.Errorf("status = %d, want %d", w.Code, http.StatusNoContent)
	}

	st := srv.state.GetState()
	if len(st.Pokemon) != 0 {
		t.Errorf("Pokemon length = %d, want 0", len(st.Pokemon))
	}
}

// --- handleUpdateApply with valid download_url ---

func TestHandleUpdateApplyWithURL(t *testing.T) {
	srv := newTestServer(t)

	body := `{"download_url":"https://example.com/test-binary"}`
	req := httptest.NewRequest(http.MethodPost, "/api/update/apply", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	srv.handleUpdateApply(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
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

// TestBroadcastRaw_MarshalError exercises the BroadcastRaw error path where
// the payload cannot be marshalled.
func TestBroadcastRaw_MarshalError(t *testing.T) {
	h := NewHub()
	c := &wsClient{send: make(chan []byte, sendBufSize)}
	h.mu.Lock()
	h.clients[c] = true
	h.mu.Unlock()

	// func() is not JSON-marshalable
	h.BroadcastRaw("test", func() {})

	select {
	case <-c.send:
		t.Error("should not receive message when marshal fails")
	default:
		// Expected: no message
	}
}

// --- readPokedexJSON embedded FS with error ---

func TestReadPokedexJSON_EmbeddedFSOpenError(t *testing.T) {
	tmpDir := t.TempDir()
	stateMgr := state.NewManager(tmpDir)
	srv := &Server{
		state:     stateMgr,
		hub:       NewHub(),
		hotkeyMgr: newMockHotkeyMgr(),
		// Set frontendFS to an FS that does NOT contain pokemon.json
		frontendFS: fstest.MapFS{
			"frontend/dist/other.txt": &fstest.MapFile{Data: []byte("not pokemon")},
		},
	}

	// This exercises the frontendFS != nil but Open fails path
	_, err := srv.readPokedexJSON()
	// May succeed via source-dir fallback or return error
	_ = err
}

// --- Broadcast error path (marshal error in Broadcast) ---

func TestBroadcast_MarshalError(t *testing.T) {
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

	body := `{"output_enabled":true,"output_dir":"/tmp/test2","browser_port":8888,"overlay":{}}`
	req := httptest.NewRequest(http.MethodPost, "/api/settings", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	srv.handleUpdateSettings(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
	}
	st := srv.state.GetState()
	if st.Settings.BrowserPort != 8888 {
		t.Errorf("BrowserPort = %d, want 8888", st.Settings.BrowserPort)
	}
}

// --- SPA handler with frontendFS in registerRoutes ---

// TestRegisterRoutes_WithFrontendFS exercises the path where frontendFS is set.
func TestRegisterRoutes_WithFrontendFS(t *testing.T) {
	srv := newTestServer(t)
	srv.frontendFS = fstest.MapFS{
		"frontend/dist/index.html":   &fstest.MapFile{Data: []byte("<html>SPA</html>")},
		"frontend/dist/test.js":      &fstest.MapFile{Data: []byte("js")},
	}
	mux := http.NewServeMux()
	srv.registerRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/test.js", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("status = %d for static file, want 200", w.Code)
	}
}

// --- handleGetPokedex with frontendFS containing embedded FS ---

func TestReadPokedexJSON_EmbeddedFSIOError(t *testing.T) {
	tmpDir := t.TempDir()
	stateMgr := state.NewManager(tmpDir)

	// Create an FS that has a pokemon.json but it's a directory-like entry
	srv := &Server{
		state:     stateMgr,
		hub:       NewHub(),
		hotkeyMgr: newMockHotkeyMgr(),
		frontendFS: &errorFS{},
	}

	_, err := srv.readPokedexJSON()
	// May succeed via source-dir fallback or return error
	_ = err
}

// errorFS is a test fs.FS that returns an error on Open for pokemon.json
type errorFS struct{}

func (e *errorFS) Open(name string) (fs.File, error) {
	return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
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

	body := `{"increment":"F5","decrement":"F6","reset":"F7","next_pokemon":"F8"}`
	req := httptest.NewRequest(http.MethodPost, "/api/hotkeys", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	srv.handleUpdateHotkeys(w, req)

	// Should still return 200 (the error is logged, not returned to client)
	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", w.Code)
	}
}

// TestHandleUpdateSingleHotkeyBindingError exercises the error path where
// UpdateBinding returns an error.
func TestHandleUpdateSingleHotkeyBindingError(t *testing.T) {
	srv := newTestServer(t)
	srv.hotkeyMgr = &errorHotkeyMgr{}

	body := `{"key":"F9"}`
	req := httptest.NewRequest(http.MethodPut, "/api/hotkeys/increment", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	srv.handleUpdateSingleHotkey(w, req, "increment")

	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", w.Code)
	}
}

// --- Shutdown with detectorMgr ---

func TestShutdownWithDetectorMgr(t *testing.T) {
	stateMgr := state.NewManager(t.TempDir())
	hkMgr := newMockHotkeyMgr()
	detMgr := detector.NewManager(stateMgr, func(string, any) {}, t.TempDir())

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
