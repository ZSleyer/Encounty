// backup_test.go tests backup creation and restore round-trip.
package server

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/zsleyer/encounty/internal/state"
)

func TestBackupCreatesZIP(t *testing.T) {
	srv := newTestServer(t)
	configDir := srv.state.GetConfigDir()

	// Write a state.json into the config dir so backup has something to include
	stateData := `{"pokemon":[{"id":"p1","name":"Pikachu","encounters":42}],"active_id":"p1"}`
	if err := os.WriteFile(filepath.Join(configDir, "state.json"), []byte(stateData), 0644); err != nil {
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

	// Verify the response is a valid ZIP containing state.json
	zr, err := zip.NewReader(bytes.NewReader(w.Body.Bytes()), int64(w.Body.Len()))
	if err != nil {
		t.Fatalf("invalid zip: %v", err)
	}

	found := false
	for _, f := range zr.File {
		if f.Name == "state.json" {
			found = true
			rc, err := f.Open()
			if err != nil {
				t.Fatal(err)
			}
			content, _ := io.ReadAll(rc)
			rc.Close()
			if string(content) != stateData {
				t.Errorf("state.json content mismatch")
			}
		}
	}
	if !found {
		t.Error("state.json not found in backup ZIP")
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
	srv := newTestServer(t)
	configDir := srv.state.GetConfigDir()

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

	// Reset state by writing a fresh state.json
	freshState := `{"pokemon":[],"active_id":""}`
	if err := os.WriteFile(filepath.Join(configDir, "state.json"), []byte(freshState), 0644); err != nil {
		t.Fatal(err)
	}
	if err := srv.state.Reload(); err != nil {
		t.Fatal(err)
	}

	st := srv.state.GetState()
	if len(st.Pokemon) != 0 {
		t.Fatalf("expected 0 pokemon after reset, got %d", len(st.Pokemon))
	}

	// Restore from backup
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, err := mw.CreateFormFile("backup", "backup.zip")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fw.Write(backupData); err != nil {
		t.Fatal(err)
	}
	mw.Close()

	restoreReq := httptest.NewRequest(http.MethodPost, "/api/restore", &body)
	restoreReq.Header.Set("Content-Type", mw.FormDataContentType())
	restoreW := httptest.NewRecorder()
	srv.handleRestore(restoreW, restoreReq)

	if restoreW.Code != http.StatusOK {
		t.Fatalf("restore status = %d, body = %s", restoreW.Code, restoreW.Body.String())
	}

	// Verify state was restored
	st = srv.state.GetState()
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
	fw.Write([]byte("not a zip"))
	mw.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/restore", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	w := httptest.NewRecorder()
	srv.handleRestore(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", w.Code)
	}
}

func TestRestoreZIPMissingState(t *testing.T) {
	srv := newTestServer(t)

	// Create a valid ZIP without state.json
	var zipBuf bytes.Buffer
	zw := zip.NewWriter(&zipBuf)
	fw, _ := zw.Create("pokemon.json")
	fw.Write([]byte("[]"))
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

	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 for missing state.json", w.Code)
	}

	var resp map[string]string
	json.Unmarshal(w.Body.Bytes(), &resp)
	// Response body should mention state.json
	if w.Body.String() == "" {
		t.Error("expected error message in response body")
	}
}
