// wal_test.go covers the write-ahead-log hazards of copying SQLite as a file:
// a backup made from a stale main file, and a stale sidecar surviving a restore.
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
	"testing"
	"time"

	"github.com/zsleyer/encounty/backend/internal/database"
	"github.com/zsleyer/encounty/backend/internal/state"
)

// extractDBFromZip writes the encounty.db entry of a backup archive to a file
// and returns its path.
func extractDBFromZip(t *testing.T, archive []byte, dest string) string {
	t.Helper()

	zr, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		t.Fatalf("open archive: %v", err)
	}
	for _, f := range zr.File {
		if f.Name != testDBName {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("open entry: %v", err)
		}
		defer func() { _ = rc.Close() }()

		out, err := os.Create(dest)
		if err != nil {
			t.Fatalf("create file: %v", err)
		}
		defer func() { _ = out.Close() }()

		if _, err := out.ReadFrom(rc); err != nil {
			t.Fatalf("write file: %v", err)
		}
		return dest
	}
	t.Fatalf("archive has no %s entry", testDBName)
	return ""
}

// TestBackupContainsCommittedData is the regression test for backups that came
// out empty. The live database runs in WAL mode, so its main file holds nothing
// until a checkpoint; a backup that copies that file ships an unusable database.
func TestBackupContainsCommittedData(t *testing.T) {
	mux, deps := newTestMux(t)

	deps.stateMgr.AddPokemon(state.Pokemon{
		ID:         "p1",
		Name:       "Glurak",
		Encounters: 1234,
		CreatedAt:  time.Now(),
	})
	if err := deps.stateMgr.Save(); err != nil {
		t.Fatal(err)
	}

	// Guard the premise: with a checkpointed main file the test would pass even
	// against the file-copy implementation it exists to catch.
	livePath := filepath.Join(deps.ConfigDir(), testDBName)
	if wal, err := os.Stat(livePath + "-wal"); err != nil || wal.Size() == 0 {
		t.Fatalf("expected a non-empty write-ahead log, got %v", err)
	}

	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest(http.MethodGet, pathAPIBackup, nil))
	if w.Code != http.StatusOK {
		t.Fatalf(wantStatus200, w.Code)
	}

	dbPath := extractDBFromZip(t, w.Body.Bytes(), filepath.Join(t.TempDir(), "from-backup.db"))
	backedUp, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open backed-up database: %v", err)
	}
	defer func() { _ = backedUp.Close() }()

	var name string
	var encounters int
	err = backedUp.QueryRow(`SELECT name, encounters FROM pokemon WHERE id = 'p1'`).Scan(&name, &encounters)
	if err != nil {
		t.Fatalf("read pokemon from backup: %v", err)
	}
	if name != "Glurak" || encounters != 1234 {
		t.Errorf("got %q/%d, want Glurak/1234", name, encounters)
	}
}

// TestRestoreReplacesLiveDatabase restores a backup taken from a different
// database. The existing round-trip test cannot catch a stale sidecar, because
// backing up and restoring the same database makes a replayed write-ahead log
// look like a successful restore.
func TestRestoreReplacesLiveDatabase(t *testing.T) {
	mux, deps := newTestMux(t)

	deps.stateMgr.AddPokemon(state.Pokemon{
		ID: "local", Name: "Glurak", Encounters: 10, CreatedAt: time.Now(),
	})
	if err := deps.stateMgr.Save(); err != nil {
		t.Fatal(err)
	}

	archive := foreignBackup(t)

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, err := mw.CreateFormFile("backup", testBackupFile)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fw.Write(archive); err != nil {
		t.Fatal(err)
	}
	_ = mw.Close()

	req := httptest.NewRequest(http.MethodPost, pathAPIRestore, &body)
	req.Header.Set(hdrContentType, mw.FormDataContentType())
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("restore status = %d, body = %s", w.Code, w.Body.String())
	}

	st := deps.stateMgr.GetState()
	if len(st.Pokemon) != 1 {
		t.Fatalf("expected 1 pokemon after restore, got %d", len(st.Pokemon))
	}
	if st.Pokemon[0].Name != "Pikachu" {
		t.Errorf("name = %q, want Pikachu — the local database survived the restore",
			st.Pokemon[0].Name)
	}
}

// foreignBackup builds a backup archive from a separate database, closed so its
// main file is checkpointed and self-contained.
func foreignBackup(t *testing.T) []byte {
	t.Helper()

	dir := t.TempDir()
	mgr := state.NewManager(dir)
	db, err := database.Open(filepath.Join(dir, testDBName))
	if err != nil {
		t.Fatal(err)
	}
	mgr.SetDB(db)
	mgr.AddPokemon(state.Pokemon{
		ID: "foreign", Name: "Pikachu", Encounters: 42, CreatedAt: time.Now(),
	})
	if err := mgr.Save(); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile(filepath.Join(dir, testDBName))
	if err != nil {
		t.Fatal(err)
	}

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	entry, err := zw.Create(testDBName)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write(raw); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}
