// backup_test.go tests backup creation and restore round-trip.
package backup

import (
	"archive/zip"
	"bytes"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/zsleyer/encounty/backend/internal/database"
	"github.com/zsleyer/encounty/backend/internal/state"
)

const (
	pathAPIBackup  = "/api/backup"
	pathAPIRestore = "/api/restore"
	hdrContentType = "Content-Type"

	testDBName      = "encounty.db"
	wantStatus200   = "status = %d, want 200"
	errInvalidZip   = "invalid zip: %v"
	testBackupFile  = "backup.zip"
	testTemplatePNG = "tmpl.png"
	fakePNGContent  = "fake-png"
)

// testDeps implements the Deps interface using real state and database objects.
type testDeps struct {
	stateMgr *state.Manager
	db       *database.DB
}

func (d *testDeps) ConfigDir() string          { return d.stateMgr.GetConfigDir() }
func (d *testDeps) DB() *database.DB     { return d.db }
func (d *testDeps) SetDB(db *database.DB) { d.db = db; d.stateMgr.SetDB(db) }
func (d *testDeps) ReloadState() error          { return d.stateMgr.Reload() }
func (d *testDeps) BroadcastState()             { /* no-op: mock implementation for testing */ }

// newTestMux creates a test HTTP mux with the backup routes registered,
// backed by a real SQLite database.
func newTestMux(t *testing.T) (*http.ServeMux, *testDeps) {
	t.Helper()
	dir := t.TempDir()
	stateMgr := state.NewManager(dir)
	db, err := database.Open(filepath.Join(dir, testDBName))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	stateMgr.SetDB(db)

	deps := &testDeps{stateMgr: stateMgr, db: db}
	mux := http.NewServeMux()
	RegisterRoutes(mux, deps)
	return mux, deps
}

// newSimpleTestMux creates a test HTTP mux without a database, for tests
// that only need basic request validation.
func newSimpleTestMux(t *testing.T) *http.ServeMux {
	t.Helper()
	dir := t.TempDir()
	stateMgr := state.NewManager(dir)

	deps := &testDeps{stateMgr: stateMgr}
	mux := http.NewServeMux()
	RegisterRoutes(mux, deps)
	return mux
}

func TestBackupCreatesZIP(t *testing.T) {
	mux, deps := newTestMux(t)

	// Save state so the DB has content
	deps.stateMgr.AddPokemon(state.Pokemon{
		ID:         "p1",
		Name:       "Pikachu",
		Encounters: 42,
		CreatedAt:  time.Now(),
	})
	if err := deps.stateMgr.Save(); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, pathAPIBackup, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(wantStatus200, w.Code)
	}

	ct := w.Header().Get(hdrContentType)
	if ct != "application/zip" {
		t.Errorf("Content-Type = %q, want application/zip", ct)
	}

	cd := w.Header().Get("Content-Disposition")
	if cd == "" {
		t.Error("Content-Disposition header missing")
	}

	zr, err := zip.NewReader(bytes.NewReader(w.Body.Bytes()), int64(w.Body.Len()))
	if err != nil {
		t.Fatalf(errInvalidZip, err)
	}

	found := false
	for _, f := range zr.File {
		if f.Name == testDBName {
			found = true
		}
	}
	if !found {
		t.Error(testDBName + " not found in backup ZIP")
	}
}

func TestBackupMethodNotAllowed(t *testing.T) {
	mux := newSimpleTestMux(t)

	req := httptest.NewRequest(http.MethodPost, pathAPIBackup, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", w.Code)
	}
}

func TestRestoreRoundTrip(t *testing.T) {
	mux, deps := newTestMux(t)

	// Prepare state with a pokemon, save it, then back up
	deps.stateMgr.AddPokemon(state.Pokemon{
		ID:         "p1",
		Name:       "Bulbasaur",
		Encounters: 100,
		CreatedAt:  time.Now(),
	})
	if err := deps.stateMgr.Save(); err != nil {
		t.Fatal(err)
	}

	// Create backup
	backupReq := httptest.NewRequest(http.MethodGet, pathAPIBackup, nil)
	backupW := httptest.NewRecorder()
	mux.ServeHTTP(backupW, backupReq)

	if backupW.Code != http.StatusOK {
		t.Fatalf("backup status = %d", backupW.Code)
	}
	backupData := backupW.Body.Bytes()

	// Restore from backup
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, err := mw.CreateFormFile("backup", testBackupFile)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fw.Write(backupData); err != nil {
		t.Fatal(err)
	}
	_ = mw.Close()

	restoreReq := httptest.NewRequest(http.MethodPost, pathAPIRestore, &body)
	restoreReq.Header.Set(hdrContentType, mw.FormDataContentType())
	restoreW := httptest.NewRecorder()
	mux.ServeHTTP(restoreW, restoreReq)

	if restoreW.Code != http.StatusOK {
		t.Fatalf("restore status = %d, body = %s", restoreW.Code, restoreW.Body.String())
	}

	// Verify state was restored
	st := deps.stateMgr.GetState()
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
	mux := newSimpleTestMux(t)

	req := httptest.NewRequest(http.MethodGet, pathAPIRestore, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", w.Code)
	}
}

func TestRestoreNoFile(t *testing.T) {
	mux := newSimpleTestMux(t)

	req := httptest.NewRequest(http.MethodPost, pathAPIRestore, bytes.NewBufferString(""))
	req.Header.Set(hdrContentType, "multipart/form-data; boundary=xxx")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", w.Code)
	}
}

func TestRestoreInvalidZIP(t *testing.T) {
	mux := newSimpleTestMux(t)

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, _ := mw.CreateFormFile("backup", "bad.zip")
	_, _ = fw.Write([]byte("not a zip"))
	_ = mw.Close()

	req := httptest.NewRequest(http.MethodPost, pathAPIRestore, &body)
	req.Header.Set(hdrContentType, mw.FormDataContentType())
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", w.Code)
	}
}

func TestRestoreZIPMissingDB(t *testing.T) {
	mux, _ := newTestMux(t)

	// Create a valid ZIP without encounty.db
	var zipBuf bytes.Buffer
	zw := zip.NewWriter(&zipBuf)
	fw, _ := zw.Create("other.txt")
	_, _ = fw.Write([]byte("ignored"))
	_ = zw.Close()

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	formFile, _ := mw.CreateFormFile("backup", testBackupFile)
	_, _ = formFile.Write(zipBuf.Bytes())
	_ = mw.Close()

	req := httptest.NewRequest(http.MethodPost, pathAPIRestore, &body)
	req.Header.Set(hdrContentType, mw.FormDataContentType())
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 for missing encounty.db", w.Code)
	}

	if w.Body.String() == "" {
		t.Error("expected error message in response body")
	}
}

// TestBackupWithTemplateFiles exercises the WalkDir path that includes template
// files in the backup ZIP.
func TestBackupWithTemplateFiles(t *testing.T) {
	mux, deps := newTestMux(t)
	configDir := deps.stateMgr.GetConfigDir()

	// Write state.json
	if err := os.WriteFile(filepath.Join(configDir, "state.json"), []byte(`{}`), 0644); err != nil {
		t.Fatal(err)
	}

	// Write a template file
	tmplDir := filepath.Join(configDir, "templates", "p1")
	if err := os.MkdirAll(tmplDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tmplDir, testTemplatePNG), []byte("fake-png-data"), 0644); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, pathAPIBackup, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(wantStatus200, w.Code)
	}

	zr, err := zip.NewReader(bytes.NewReader(w.Body.Bytes()), int64(w.Body.Len()))
	if err != nil {
		t.Fatalf(errInvalidZip, err)
	}

	foundTemplate := false
	for _, f := range zr.File {
		if strings.Contains(f.Name, testTemplatePNG) {
			foundTemplate = true
			rc, err := f.Open()
			if err != nil {
				t.Fatal(err)
			}
			content, _ := io.ReadAll(rc)
			_ = rc.Close()
			if string(content) != "fake-png-data" {
				t.Error("template content mismatch")
			}
		}
	}
	if !foundTemplate {
		t.Error("template file not found in backup ZIP")
	}
}

// TestBackupWithBothFiles exercises the template-images path in backup.
func TestBackupWithBothFiles(t *testing.T) {
	mux, deps := newTestMux(t)
	configDir := deps.stateMgr.GetConfigDir()

	// Save state so DB has content
	deps.stateMgr.AddPokemon(state.Pokemon{
		ID:        "p1",
		Name:      "Pikachu",
		CreatedAt: time.Now(),
	})
	if err := deps.stateMgr.Save(); err != nil {
		t.Fatal(err)
	}

	// Create a template image so both DB and templates are in the backup
	tmplDir := filepath.Join(configDir, "templates", "p1")
	if err := os.MkdirAll(tmplDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tmplDir, testTemplatePNG), []byte(fakePNGContent), 0644); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, pathAPIBackup, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(wantStatus200, w.Code)
	}

	zr, err := zip.NewReader(bytes.NewReader(w.Body.Bytes()), int64(w.Body.Len()))
	if err != nil {
		t.Fatalf(errInvalidZip, err)
	}

	names := map[string]bool{}
	for _, f := range zr.File {
		names[f.Name] = true
	}
	if !names[testDBName] {
		t.Error(testDBName + " missing from backup")
	}
	if !names["templates/p1/tmpl.png"] {
		t.Error("templates/p1/tmpl.png missing from backup")
	}
}

// TestBackupNoFiles exercises the path where neither state.json nor
// pokemon.json exist -- the backup should still succeed with an empty ZIP.
func TestBackupNoFiles(t *testing.T) {
	mux := newSimpleTestMux(t)

	req := httptest.NewRequest(http.MethodGet, pathAPIBackup, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(wantStatus200, w.Code)
	}
}

// TestRestoreWithBothFiles tests restoring a ZIP that contains both
// encounty.db and template images.
func TestRestoreWithBothFiles(t *testing.T) {
	mux, deps := newTestMux(t)
	configDir := deps.stateMgr.GetConfigDir()

	// Save state so the DB has content for backup
	deps.stateMgr.AddPokemon(state.Pokemon{
		ID:         "p1",
		Name:       "Bulbasaur",
		Encounters: 5,
		CreatedAt:  time.Now(),
	})
	if err := deps.stateMgr.Save(); err != nil {
		t.Fatal(err)
	}

	// Read the DB file to put into our ZIP
	dbData, err := os.ReadFile(filepath.Join(configDir, testDBName))
	if err != nil {
		t.Fatal(err)
	}

	// Create a ZIP with encounty.db, a template file, and a file that should be skipped
	var zipBuf bytes.Buffer
	zw := zip.NewWriter(&zipBuf)
	fw, _ := zw.Create(testDBName)
	_, _ = fw.Write(dbData)
	fw2, _ := zw.Create("templates/p1/tmpl.png")
	_, _ = fw2.Write([]byte(fakePNGContent))
	fw3, _ := zw.Create("other.txt")
	_, _ = fw3.Write([]byte("ignored"))
	_ = zw.Close()

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	formFile, _ := mw.CreateFormFile("backup", testBackupFile)
	_, _ = formFile.Write(zipBuf.Bytes())
	_ = mw.Close()

	req := httptest.NewRequest(http.MethodPost, pathAPIRestore, &body)
	req.Header.Set(hdrContentType, mw.FormDataContentType())
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}

	// Verify template file was written
	data, err := os.ReadFile(filepath.Join(configDir, "templates", "p1", testTemplatePNG))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != fakePNGContent {
		t.Errorf("template content = %q, want %q", string(data), fakePNGContent)
	}
}
