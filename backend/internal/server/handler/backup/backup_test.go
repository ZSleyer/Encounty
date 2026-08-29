// backup_test.go tests backup creation and restore round-trip.
package backup

import (
	"archive/zip"
	"bytes"
	"database/sql"
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
	"github.com/zsleyer/encounty/backend/internal/ziplimit"
)

const (
	pathAPIBackup  = "/api/backup"
	pathAPIRestore = "/api/restore"
	hdrContentType = "Content-Type"

	testDBName       = "encounty.db"
	wantStatus200    = "status = %d, want 200"
	wantStatus400Fmt = "status = %d, want 400"
	errInvalidZip    = "invalid zip: %v"
	testBackupFile   = "backup.zip"
	testTemplatePNG  = "tmpl.png"
	testOtherFile    = "other.txt"
	testTemplatePath = "templates/p1/tmpl.png"
	fakePNGContent   = "fake-png"
)

// testDeps implements the Deps interface using real state and database objects.
type testDeps struct {
	stateMgr *state.Manager
	db       *database.DB
}

func (d *testDeps) ConfigDir() string     { return d.stateMgr.GetConfigDir() }
func (d *testDeps) DBDir() string         { return d.stateMgr.GetDBDir() }
func (d *testDeps) DB() *database.DB      { return d.db }
func (d *testDeps) SetDB(db *database.DB) { d.db = db; d.stateMgr.SetDB(db) }
func (d *testDeps) ReloadState() error    { return d.stateMgr.Reload() }
func (d *testDeps) BroadcastState()       { /* no-op: mock implementation for testing */ }

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

// TestRestoreRoundTripRelocatedDB verifies that backup and restore follow the
// database to a directory outside the config directory.
func TestRestoreRoundTripRelocatedDB(t *testing.T) {
	mux, deps := newTestMux(t)
	configDir := deps.stateMgr.GetConfigDir()

	// Move the database out of the config dir, the way the settings handler does.
	dbDir := t.TempDir()
	if err := deps.db.Snapshot(filepath.Join(dbDir, testDBName)); err != nil {
		t.Fatal(err)
	}
	_ = deps.db.Close()
	relocated, err := database.Open(filepath.Join(dbDir, testDBName))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = relocated.Close() })
	deps.SetDB(relocated)
	deps.stateMgr.SetDBDir(dbDir)
	// A real move leaves nothing behind, so a database reappearing in the config
	// dir can only come from the restore.
	if err := os.Remove(filepath.Join(configDir, testDBName)); err != nil {
		t.Fatal(err)
	}
	database.RemoveSidecars(filepath.Join(configDir, testDBName))

	deps.stateMgr.AddPokemon(state.Pokemon{ID: "p1", Name: "Bulbasaur", Encounters: 42, CreatedAt: time.Now()})
	if err := deps.stateMgr.Save(); err != nil {
		t.Fatal(err)
	}

	backupReq := httptest.NewRequest(http.MethodGet, pathAPIBackup, nil)
	backupW := httptest.NewRecorder()
	mux.ServeHTTP(backupW, backupReq)
	if backupW.Code != http.StatusOK {
		t.Fatalf("backup status = %d", backupW.Code)
	}

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, err := mw.CreateFormFile("backup", testBackupFile)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fw.Write(backupW.Body.Bytes()); err != nil {
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
	t.Cleanup(func() { _ = deps.db.Close() })

	// The restored database belongs at the relocated path, not back in the
	// config directory.
	if _, err := os.Stat(filepath.Join(configDir, testDBName)); !os.IsNotExist(err) {
		t.Errorf("restore recreated a database in the config dir (err = %v)", err)
	}
	st := deps.stateMgr.GetState()
	if len(st.Pokemon) != 1 || st.Pokemon[0].Encounters != 42 {
		t.Errorf("state after restore = %+v, want the backed-up Bulbasaur", st.Pokemon)
	}
}

// TestRestoreRejectsPreV2Archive verifies that an archive whose database has no
// normalized state is refused, and that the live database survives the attempt.
// The restore used to overwrite the file before anyone could look at it.
func TestRestoreRejectsPreV2Archive(t *testing.T) {
	mux, deps := newTestMux(t)
	deps.stateMgr.AddPokemon(state.Pokemon{ID: "p1", Name: "Bulbasaur", Encounters: 7, CreatedAt: time.Now()})
	if err := deps.stateMgr.Save(); err != nil {
		t.Fatal(err)
	}

	// An SQLite file without app_config: the shape of a pre-v2 backup.
	oldDBPath := filepath.Join(t.TempDir(), testDBName)
	oldDB, err := sql.Open("sqlite", oldDBPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := oldDB.Exec(`CREATE TABLE app_state (id INTEGER PRIMARY KEY, data TEXT)`); err != nil {
		t.Fatal(err)
	}
	_ = oldDB.Close()
	oldBytes, err := os.ReadFile(oldDBPath)
	if err != nil {
		t.Fatal(err)
	}

	var zipBuf bytes.Buffer
	zw := zip.NewWriter(&zipBuf)
	fw, _ := zw.Create(testDBName)
	_, _ = fw.Write(oldBytes)
	_ = zw.Close()

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	ff, err := mw.CreateFormFile("backup", testBackupFile)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ff.Write(zipBuf.Bytes()); err != nil {
		t.Fatal(err)
	}
	_ = mw.Close()

	req := httptest.NewRequest(http.MethodPost, pathAPIRestore, &body)
	req.Header.Set(hdrContentType, mw.FormDataContentType())
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body = %s", w.Code, w.Body.String())
	}
	// The running database was never closed or replaced.
	if err := deps.stateMgr.Save(); err != nil {
		t.Errorf("Save after a rejected restore failed: %v", err)
	}
	st := deps.stateMgr.GetState()
	if len(st.Pokemon) != 1 || st.Pokemon[0].Encounters != 7 {
		t.Errorf("state after a rejected restore = %+v, want the untouched Bulbasaur", st.Pokemon)
	}
	// No staging file left behind.
	staged := filepath.Join(deps.stateMgr.GetDBDir(), testDBName+".restore-tmp")
	if _, err := os.Stat(staged); !os.IsNotExist(err) {
		t.Errorf("staging file left behind (err = %v)", err)
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
		t.Errorf(wantStatus400Fmt, w.Code)
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
		t.Errorf(wantStatus400Fmt, w.Code)
	}
}

func TestRestoreZIPMissingDB(t *testing.T) {
	mux, _ := newTestMux(t)

	// Create a valid ZIP without encounty.db
	var zipBuf bytes.Buffer
	zw := zip.NewWriter(&zipBuf)
	fw, _ := zw.Create(testOtherFile)
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

// TestExtractZipEntryInvalidEntry exercises the error path when a zip entry
// cannot be opened.
func TestExtractZipEntryWithValidFile(t *testing.T) {
	dir := t.TempDir()

	// Create a valid ZIP with one entry
	var zipBuf bytes.Buffer
	zw := zip.NewWriter(&zipBuf)
	fw, _ := zw.Create("test.txt")
	_, _ = fw.Write([]byte("hello"))
	_ = zw.Close()

	zr, err := zip.NewReader(bytes.NewReader(zipBuf.Bytes()), int64(zipBuf.Len()))
	if err != nil {
		t.Fatal(err)
	}

	dest := filepath.Join(dir, "test.txt")
	if !extractZipEntry(zr.File[0], dest, testBudget()) {
		t.Fatal("extractZipEntry reported failure for a valid entry")
	}

	data, err := os.ReadFile(dest)
	if err != nil {
		t.Fatalf("file not written: %v", err)
	}
	if string(data) != "hello" {
		t.Errorf("content = %q, want hello", string(data))
	}
}

func TestExtractZipEntryDBFile(t *testing.T) {
	dir := t.TempDir()

	// Create a valid ZIP with the DB file
	var zipBuf bytes.Buffer
	zw := zip.NewWriter(&zipBuf)
	fw, _ := zw.Create(testDBName)
	_, _ = fw.Write([]byte("db-content"))
	_ = zw.Close()

	zr, err := zip.NewReader(bytes.NewReader(zipBuf.Bytes()), int64(zipBuf.Len()))
	if err != nil {
		t.Fatal(err)
	}

	dest := filepath.Join(dir, testDBName)
	if !extractZipEntry(zr.File[0], dest, testBudget()) {
		t.Error("extractZipEntry should report the database entry as written")
	}
}

// TestIsRestorableFile exercises the restorable file check.
func TestIsRestorableFile(t *testing.T) {
	tests := []struct {
		name string
		want bool
	}{
		{testDBName, true},
		{testTemplatePath, false}, // template images live in the database
		{"state.json", false},     // never restored: it can only carry a stale redirect
		{testOtherFile, false},
		{"random/path.json", false},
		{"", false},
	}
	for _, tc := range tests {
		got := isRestorableFile(tc.name)
		if got != tc.want {
			t.Errorf("isRestorableFile(%q) = %v, want %v", tc.name, got, tc.want)
		}
	}
}

// TestRestoreInvalidMultipart exercises the error path where multipart parsing fails.
func TestRestoreInvalidMultipart(t *testing.T) {
	mux := newSimpleTestMux(t)

	req := httptest.NewRequest(http.MethodPost, pathAPIRestore, strings.NewReader("not multipart"))
	req.Header.Set(hdrContentType, "text/plain")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf(wantStatus400Fmt, w.Code)
	}
}

// testBudget returns a permissive ZIP budget for tests that exercise extraction
// logic rather than the limits themselves.
func testBudget() *ziplimit.Budget {
	return &ziplimit.Budget{
		MaxEntries:    maxRestoreEntries,
		MaxEntryBytes: maxRestoreEntryBytes,
		MaxTotalBytes: maxRestoreTotalBytes,
	}
}
