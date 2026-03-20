package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/zsleyer/encounty/backend/internal/state"
)

const (
	testBuildDate = "2026-01-01"
	extFmtStatus  = "status = %d, want %d"
)

// --- New constructor ---

func TestNewServer(t *testing.T) {
	stateMgr := state.NewManager(t.TempDir())
	hkMgr := newMockHotkeyMgr()

	srv := New(Config{
		Port:       0,
		State:      stateMgr,
		HotkeyMgr:  hkMgr,
		Version:    "1.0.0",
		Commit:     "abc1234",
		BuildDate:  testBuildDate,
		ConfigDir:  t.TempDir(),
	})

	if srv == nil {
		t.Fatal("New returned nil")
	}
	if srv.state != stateMgr {
		t.Error("state manager not wired correctly")
	}
	if srv.hub == nil {
		t.Error("hub should not be nil")
	}
	if srv.version != "1.0.0" {
		t.Errorf("version = %q, want %q", srv.version, "1.0.0")
	}
	if srv.commit != "abc1234" {
		t.Errorf("commit = %q, want %q", srv.commit, "abc1234")
	}
	if srv.buildDate != testBuildDate {
		t.Errorf("buildDate = %q, want %q", srv.buildDate, testBuildDate)
	}
	if srv.httpServer == nil {
		t.Error("httpServer should not be nil")
	}
}

// --- Shutdown ---

func TestShutdown(t *testing.T) {
	stateMgr := state.NewManager(t.TempDir())
	hkMgr := newMockHotkeyMgr()

	srv := New(Config{
		Port:       0,
		State:      stateMgr,
		HotkeyMgr:  hkMgr,
		Version:    "dev",
		Commit:     "test",
		ConfigDir:  t.TempDir(),
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Shutdown should succeed even without calling Start
	err := srv.Shutdown(ctx)
	if err != nil {
		t.Errorf("Shutdown returned error: %v", err)
	}
}

// --- Broadcast ---

func TestBroadcast(t *testing.T) {
	srv := newTestServer(t)

	// Register a fake client
	c := &wsClient{send: make(chan []byte, sendBufSize)}
	srv.hub.mu.Lock()
	srv.hub.clients[c] = true
	srv.hub.mu.Unlock()

	srv.Broadcast("test_event", map[string]string{"key": "value"})

	select {
	case data := <-c.send:
		var msg WSMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if msg.Type != "test_event" {
			t.Errorf("type = %q, want %q", msg.Type, "test_event")
		}
	case <-time.After(time.Second):
		t.Error("no broadcast received")
	}
}

// --- Hub getter ---

func TestHub(t *testing.T) {
	srv := newTestServer(t)
	hub := srv.Hub()
	if hub == nil {
		t.Error("Hub() returned nil")
	}
	if hub != srv.hub {
		t.Error("Hub() returned wrong hub instance")
	}
}

// --- broadcastState ---

func TestBroadcastState(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")

	// Register a fake client
	c := &wsClient{send: make(chan []byte, sendBufSize)}
	srv.hub.mu.Lock()
	srv.hub.clients[c] = true
	srv.hub.mu.Unlock()

	srv.broadcastState()

	select {
	case data := <-c.send:
		var msg WSMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if msg.Type != "state_update" {
			t.Errorf("type = %q, want %q", msg.Type, "state_update")
		}
	case <-time.After(time.Second):
		t.Error("no state_update broadcast received")
	}
}

// TestFetchUpdateInfoMockServer moved to internal/updater/updater_test.go
// as TestAssetDownloadURLMock.

// --- handleSyncGames wrong method ---

func TestHandleSyncGamesWrongMethod(t *testing.T) {
	srv := newTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/api/games/sync", nil)
	w := httptest.NewRecorder()
	srv.handleSyncGames(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf(extFmtStatus, w.Code, http.StatusMethodNotAllowed)
	}
}

// --- handleUpdateApply invalid JSON (not in update_test.go) ---

func TestHandleUpdateApplyInvalidJSON(t *testing.T) {
	srv := newTestServer(t)

	req := httptest.NewRequest(http.MethodPost, "/api/update/apply", bytes.NewBufferString("{bad"))
	w := httptest.NewRecorder()
	srv.handleUpdateApply(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf(extFmtStatus, w.Code, http.StatusBadRequest)
	}
}

// --- handleQuit wrong method ---

func TestHandleQuitWrongMethod(t *testing.T) {
	srv := newTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/api/quit", nil)
	w := httptest.NewRecorder()
	srv.handleQuit(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf(extFmtStatus, w.Code, http.StatusMethodNotAllowed)
	}
}

// --- handleRestart wrong method ---

func TestHandleRestartWrongMethod(t *testing.T) {
	srv := newTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/api/restart", nil)
	w := httptest.NewRecorder()
	srv.handleRestart(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf(extFmtStatus, w.Code, http.StatusMethodNotAllowed)
	}
}
