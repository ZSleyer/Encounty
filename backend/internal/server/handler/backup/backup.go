// Package backup provides HTTP handlers for creating and restoring ZIP
// backups. An archive holds exactly the SQLite database, which carries
// everything worth restoring: template images live in it as BLOBs since the v2
// schema, and every field of the former state.json has been a table since
// v0.7.0. An archive from before that schema is refused rather than installed.
package backup

import (
	"archive/zip"
	"bytes"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/zsleyer/encounty/backend/internal/database"
	"github.com/zsleyer/encounty/backend/internal/httputil"
	"github.com/zsleyer/encounty/backend/internal/state"
	"github.com/zsleyer/encounty/backend/internal/ziplimit"

	_ "modernc.org/sqlite"
)

const (
	// maxRestoreBytes bounds the uploaded archive itself.
	maxRestoreBytes = 256 << 20
	// restoreEntry/restoreTotal bound what the archive may expand to, so a
	// small upload cannot decompress into an out-of-memory kill.
	maxRestoreEntryBytes = 256 << 20
	maxRestoreTotalBytes = 512 << 20
	maxRestoreEntries    = 100
)

// Deps declares the capabilities the backup handlers need from the
// application layer, keeping this package decoupled from the server package.
type Deps interface {
	// ConfigDir returns the active configuration directory path.
	ConfigDir() string
	// DB returns the current database handle for close/reopen during
	// restore. Returns nil when no database is configured.
	DB() *database.DB
	// SetDB replaces the active database handle after a restore.
	SetDB(db *database.DB)
	// DBDir returns the directory holding the database, which the user may have
	// moved out of the config directory.
	DBDir() string
	// ReloadState reloads the in-memory state from the database.
	ReloadState() error
	// BroadcastState sends the current state snapshot to all WebSocket clients.
	BroadcastState()
}

// restoreResponse confirms a successful backup restore.
type restoreResponse struct {
	OK bool `json:"ok"`
}

// handler groups the backup HTTP handlers together with their dependencies.
type handler struct {
	deps Deps
}

// RegisterRoutes wires the /api/backup and /api/restore routes onto mux.
func RegisterRoutes(mux *http.ServeMux, d Deps) {
	h := &handler{deps: d}
	mux.HandleFunc("/api/backup", h.handleBackup)
	mux.HandleFunc("/api/restore", h.handleRestore)
}

// handleBackup streams a ZIP file containing the SQLite database and template
// images directly to the response, triggering a browser file download.
//
// @Summary      Download a backup ZIP
// @Tags         system
// swag stamps a response with the @Produce list in force when it parses that
// line, and offers no per-response content type, so the JSON failure is
// declared before @Produce switches to the archive type of the success.
// @Produce      json
// @Failure      500 {object} httputil.ErrResp
// @Produce      application/zip
// @Success      200 {file} binary
// @Router       /backup [get]
func (h *handler) handleBackup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	ts := time.Now().Format("2006-01-02_150405")
	filename := fmt.Sprintf("encounty-backup-%s.zip", ts)

	// Snapshot before any response byte is written: once the ZIP is streaming,
	// a failure can no longer be reported as an HTTP status.
	dbPath, cleanup, err := h.snapshotDB(h.deps.DBDir())
	if err != nil {
		slog.Error("Backup: snapshot failed", "error", err)
		httputil.WriteError(w, http.StatusInternalServerError, "failed to snapshot the database")
		return
	}
	defer cleanup()

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)

	zw := zip.NewWriter(w)
	defer func() { _ = zw.Close() }()

	// Include the SQLite database
	if f, err := os.Open(dbPath); err == nil {
		fw, err := zw.Create(state.DBFilename)
		if err == nil {
			_, _ = io.Copy(fw, f)
		}
		_ = f.Close()
	}
}

// snapshotDB returns the path of a database file safe to put into a backup,
// plus a cleanup function the caller must always call.
//
// The live database runs in WAL mode, so its main file lags behind: recent
// transactions sit in encounty.db-wal until a checkpoint folds them in. Copying
// encounty.db on its own therefore yields a backup that is stale, and on a young
// database an empty one. Snapshot writes a self-contained copy instead. Without
// a database handle there is nothing to snapshot and the raw file is all we
// have, which is also all the pre-database backups ever contained.
func (h *handler) snapshotDB(dbDir string) (string, func(), error) {
	livePath := filepath.Join(dbDir, state.DBFilename)

	db := h.deps.DB()
	if db == nil {
		return livePath, func() {}, nil
	}

	tmpDir, err := os.MkdirTemp("", "encounty-backup-")
	if err != nil {
		return "", nil, err
	}
	cleanup := func() { _ = os.RemoveAll(tmpDir) }

	// VACUUM INTO requires a destination that does not exist yet.
	snapshotPath := filepath.Join(tmpDir, state.DBFilename)
	if err := db.Snapshot(snapshotPath); err != nil {
		cleanup()
		return "", nil, err
	}
	return snapshotPath, cleanup, nil
}

// isRestorableFile reports whether a ZIP entry name should be extracted during
// backup restoration. The database is the whole backup: template images live in
// it as BLOBs, and every field of the former state.json has been a table since
// v0.7.0. An old archive still carries the config-path pointer in its
// state.json, which on the next start would silently redirect the app to a
// directory that has nothing to do with the restored backup.
func isRestorableFile(name string) bool {
	return name == state.DBFilename
}

// extractZipEntry writes a single ZIP file entry to dest using atomic rename
// via a temporary file. Returns whether the entry was written.
func extractZipEntry(f *zip.File, dest string, budget *ziplimit.Budget) bool {
	content, err := budget.Read(f)
	if err != nil {
		slog.Warn("Skipping backup entry", "entry", f.Name, "error", err)
		return false
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
		return false
	}
	tmp := dest + ".tmp"
	if err := os.WriteFile(tmp, content, 0644); err != nil {
		return false
	}
	return os.Rename(tmp, dest) == nil
}

// hasNormalizedState reports whether the database file at path carries the
// normalized state this version reads. It opens the file read-only and without
// running migrations, so an archive that fails the check is left exactly as it
// came out of the ZIP.
func hasNormalizedState(path string) error {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return err
	}
	defer func() { _ = db.Close() }()
	var n int
	if err := db.QueryRow(`SELECT 1 FROM app_config WHERE id = 1`).Scan(&n); err != nil {
		return errors.New("no application state found in the archive")
	}
	return nil
}

// handleRestore accepts a multipart form upload of a backup ZIP, extracts the
// SQLite database and template images into the config dir, reopens the database,
// reloads state, and broadcasts the new snapshot.
//
// @Summary      Restore from a backup ZIP
// @Tags         system
// @Accept       multipart/form-data
// @Produce      json
// @Param        backup formData file true "Backup ZIP file"
// @Success      200 {object} restoreResponse
// @Failure      400 {object} httputil.ErrResp
// @Failure      413 {object} httputil.ErrResp
// @Failure      500 {object} httputil.ErrResp
// @Router       /restore [post]
func (h *handler) handleRestore(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	// The limit covers the whole upload; ParseMultipartForm's argument only
	// decides how much of it is buffered in memory instead of a temp file.
	httputil.LimitBody(w, r, maxRestoreBytes)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		httputil.WriteBodyError(w, err, "failed to parse form")
		return
	}

	file, _, err := r.FormFile("backup")
	if err != nil {
		httputil.WriteError(w, http.StatusBadRequest, "no backup file provided")
		return
	}
	defer func() { _ = file.Close() }()

	data, err := io.ReadAll(file)
	if err != nil {
		httputil.WriteBodyError(w, err, "failed to read file")
		return
	}

	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		httputil.WriteError(w, http.StatusBadRequest, "invalid zip file")
		return
	}

	budget := &ziplimit.Budget{
		MaxEntries:    maxRestoreEntries,
		MaxEntryBytes: maxRestoreEntryBytes,
		MaxTotalBytes: maxRestoreTotalBytes,
	}

	dbDir := h.deps.DBDir()
	if err := os.MkdirAll(dbDir, 0755); err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, "failed to prepare database dir")
		return
	}
	dbPath := filepath.Join(dbDir, state.DBFilename)

	// Stage the archive next to the live database and inspect it there. The
	// restore replaces the file in place, so anything found wanting afterwards
	// would already have cost the user the database they had.
	staged := dbPath + ".restore-tmp"
	defer func() { _ = os.Remove(staged) }()

	stagedDB := false
	for _, f := range zr.File {
		if !isRestorableFile(f.Name) {
			continue
		}
		if extractZipEntry(f, staged, budget) {
			stagedDB = true
		}
	}
	if !stagedDB {
		httputil.WriteError(w, http.StatusBadRequest, "encounty.db not found in backup")
		return
	}
	if err := hasNormalizedState(staged); err != nil {
		httputil.WriteError(w, http.StatusBadRequest,
			"this backup predates the current database format and cannot be restored: "+err.Error())
		return
	}

	// Only now the live database goes away. Replacing encounty.db underneath an
	// open connection leaves that connection writing to the replaced inode, and
	// the old -wal stays on disk to be replayed over the restored database,
	// which silently undoes the restore.
	if db := h.deps.DB(); db != nil {
		_ = db.Close()
	}
	if err := os.Rename(staged, dbPath); err != nil {
		slog.Error("Restore: installing the restored database failed", "error", err)
		httputil.WriteError(w, http.StatusInternalServerError, "failed to install the restored database")
		return
	}
	// The sidecars belong to the database that was just replaced.
	database.RemoveSidecars(dbPath)

	newDB, err := database.Open(dbPath)
	if err != nil {
		slog.Error("Restore: reopening the database failed", "error", err)
		httputil.WriteError(w, http.StatusInternalServerError, "failed to reopen the database")
		return
	}
	h.deps.SetDB(newDB)

	if err := h.deps.ReloadState(); err != nil {
		slog.Error("Restore: reloading state failed", "error", err)
		httputil.WriteError(w, http.StatusInternalServerError, "failed to reload the application state")
		return
	}
	h.deps.BroadcastState()

	httputil.WriteJSON(w, http.StatusOK, restoreResponse{OK: true})
}
