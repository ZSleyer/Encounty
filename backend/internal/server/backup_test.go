// backup_test.go tests backup creation and restore round-trip.
package server

import (
	"archive/zip"
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/zsleyer/encounty/backend/internal/database"
	"github.com/zsleyer/encounty/backend/internal/state"
)

// newTestServerWithDB creates a test server backed by a real SQLite database.
func newTestServerWithDB(t *testing.T) *Server {
	t.Helper()
	dir := t.TempDir()
	stateMgr := state.NewManager(dir)
	db, err := database.Open(filepath.Join(dir, "encounty.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	stateMgr.SetDB(db)

	return &Server{
		state:     stateMgr,
		hub:       NewHub(),
		hotkeyMgr: newMockHotkeyMgr(),
		db:        db,
		version:   "1.0.0",
		commit:    "abc1234",
		buildDate: "032026",
	}
}

func TestBackupCreatesZIP(t *testing.T) {
	srv := newTestServerWithDB(t)

	// Save state so the DB has content
	srv.state.AddPokemon(state.Pokemon{
		ID:         "p1",
		Name:       "Pikachu",
		Encounters: 42,
		CreatedAt:  time.Now(),
	})
	if err := srv.state.Save(); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/backup", nil)
	w := httptest.NewRecorder()
	srv.handleBackup(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	ct := w.Header().Get("Content-Type")
	if ct != "application/zip" {
		t.Errorf("Content-Type = %q, want application/zip", ct)
	}

	cd := w.Header().Get("Content-Disposition")
	if cd == "" {
		t.Error("Content-Disposition header missing")
	}

	zr, err := zip.NewReader(bytes.NewReader(w.Body.Bytes()), int64(w.Body.Len()))
	if err != nil {
		t.Fatalf("invalid zip: %v", err)
	}

	found := false
	for _, f := range zr.File {
		if f.Name == "encounty.db" {
			found = true
		}
	}
	if !found {
		t.Error("encounty.db not found in backup ZIP")
	}
}

func TestBackupMethodNotAllowed(t *testing.T) {
	srv := newTestServer(t)

	req := httptest.NewRequest(http.MethodPost, "/api/backup", nil)
	w := httptest.NewRecorder()
	srv.handleBackup(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", w.Code)
	}
}

func TestRestoreRoundTrip(t *testing.T) {
	srv := newTestServerWithDB(t)

	// Prepare state with a pokemon, save it, then back up
	srv.state.AddPokemon(state.Pokemon{
		ID:         "p1",
		Name:       "Bulbasaur",
		Encounters: 100,
		CreatedAt:  time.Now(),
	})
	if err := srv.state.Save(); err != nil {
		t.Fatal(err)
	}

	// Create backup
	backupReq := httptest.NewRequest(http.MethodGet, "/api/backup", nil)
	backupW := httptest.NewRecorder()
	srv.handleBackup(backupW, backupReq)

	if backupW.Code != http.StatusOK {
		t.Fatalf("backup status = %d", backupW.Code)
	}
	backupData := backupW.Body.Bytes()

	// Restore from backup (we just verify the round-trip produces a valid ZIP
	// and that restore succeeds, not that in-memory state resets)
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, err := mw.CreateFormFile("backup", "backup.zip")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fw.Write(backupData); err != nil {
		t.Fatal(err)
	}
	_ = mw.Close()

	restoreReq := httptest.NewRequest(http.MethodPost, "/api/restore", &body)
	restoreReq.Header.Set("Content-Type", mw.FormDataContentType())
	restoreW := httptest.NewRecorder()
	srv.handleRestore(restoreW, restoreReq)

	if restoreW.Code != http.StatusOK {
		t.Fatalf("restore status = %d, body = %s", restoreW.Code, restoreW.Body.String())
	}

	// Verify state was restored
	st := srv.state.GetState()
	if len(st.Pokemon) != 1 {
		t.Fatalf("expected 1 pokemon after restore, got %d", len(st.Pokemon))
	}
	if st.Pokemon[0].Name != "Bulbasaur" {
		t.Errorf("name = %q, want Bulbasaur", st.Pokemon[0].Name)
	}
	if st.Pokemon[0].Encounters != 100 {
		t.Errorf("encounters = %d, want 100", st.Pokemon[0].Encounters)
	}
}

func TestRestoreMethodNotAllowed(t *testing.T) {
	srv := newTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/api/restore", nil)
	w := httptest.NewRecorder()
	srv.handleRestore(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", w.Code)
	}
}

func TestRestoreNoFile(t *testing.T) {
	srv := newTestServer(t)

	req := httptest.NewRequest(http.MethodPost, "/api/restore", bytes.NewBufferString(""))
	req.Header.Set("Content-Type", "multipart/form-data; boundary=xxx")
	w := httptest.NewRecorder()
	srv.handleRestore(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", w.Code)
	}
}

func TestRestoreInvalidZIP(t *testing.T) {
	srv := newTestServer(t)

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, _ := mw.CreateFormFile("backup", "bad.zip")
	_, _ = fw.Write([]byte("not a zip"))
	_ = mw.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/restore", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	w := httptest.NewRecorder()
	srv.handleRestore(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", w.Code)
	}
}

func TestRestoreZIPMissingDB(t *testing.T) {
	srv := newTestServerWithDB(t)

	// Create a valid ZIP without encounty.db
	var zipBuf bytes.Buffer
	zw := zip.NewWriter(&zipBuf)
	fw, _ := zw.Create("other.txt")
	_, _ = fw.Write([]byte("ignored"))
	_ = zw.Close()

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	formFile, _ := mw.CreateFormFile("backup", "backup.zip")
	_, _ = formFile.Write(zipBuf.Bytes())
	_ = mw.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/restore", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	w := httptest.NewRecorder()
	srv.handleRestore(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 for missing encounty.db", w.Code)
	}

	if w.Body.String() == "" {
		t.Error("expected error message in response body")
	}
}
