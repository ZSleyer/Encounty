// Package backup provides HTTP handlers for creating and restoring ZIP
// backups of the Encounty configuration. Backups are ZIP archives containing
// the SQLite database (which includes template images as BLOBs since the v2
// schema). Legacy backups with a separate templates/ directory are still
// accepted during restore.
package backup

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/zsleyer/encounty/backend/internal/database"
	"github.com/zsleyer/encounty/backend/internal/httputil"
	"github.com/zsleyer/encounty/backend/internal/pathsafe"
	"github.com/zsleyer/encounty/backend/internal/state"
	"github.com/zsleyer/encounty/backend/internal/ziplimit"
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
// @Produce      application/zip
// @Success      200 {file} binary
// @Router       /backup [get]
func (h *handler) handleBackup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	configDir := h.deps.ConfigDir()
	ts := time.Now().Format("2006-01-02_150405")
	filename := fmt.Sprintf("encounty-backup-%s.zip", ts)

	// Snapshot before any response byte is written: once the ZIP is streaming,
	// a failure can no longer be reported as an HTTP status.
	dbPath, cleanup, err := h.snapshotDB(h.deps.DBDir())
	if err != nil {
		http.Error(w, "failed to snapshot database: "+err.Error(), http.StatusInternalServerError)
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

	// Recursively include all template images under templates/.
	templatesDir := filepath.Join(configDir, "templates")
	_ = filepath.WalkDir(templatesDir, func(path string, d os.DirEntry, _ error) error {
		if d == nil || d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(configDir, path)
		if err != nil {
			return nil
		}
		f, err := os.Open(path)
		if err != nil {
			return nil
		}
		defer func() { _ = f.Close() }()
		fw, err := zw.Create(rel)
		if err != nil {
			return nil
		}
		_, _ = io.Copy(fw, f)
		return nil
	})
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
// backup restoration (the database and legacy template images).
//
// state.json is deliberately not restored. Every field it holds has lived in
// the database since v0.7.0, and an old archive still carries the config-path
// pointer, which on the next start would silently redirect the app to a
// directory that has nothing to do with the restored backup.
func isRestorableFile(name string) bool {
	return name == state.DBFilename ||
		strings.HasPrefix(name, "templates/")
}

// extractZipEntry writes a single ZIP file entry to disk under root using
// atomic rename via a temporary file. Returns true if the entry was the database.
func extractZipEntry(f *zip.File, root string, budget *ziplimit.Budget) bool {
	content, err := budget.Read(f)
	if err != nil {
		slog.Warn("Skipping backup entry", "entry", f.Name, "error", err)
		return false
	}

	// Containment check defeats zip-slip: a crafted entry name like
	// "templates/../../../etc/x" must not write outside root.
	dest, err := pathsafe.Join(root, f.Name)
	if err != nil {
		return false
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
		return false
	}
	tmp := dest + ".tmp"
	if err := os.WriteFile(tmp, content, 0644); err != nil {
		return false
	}
	if err := os.Rename(tmp, dest); err != nil {
		return false
	}
	return f.Name == state.DBFilename
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
// @Failure      400 {string} string
// @Failure      500 {string} string
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
		http.Error(w, "no backup file provided", http.StatusBadRequest)
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
		http.Error(w, "invalid zip file", http.StatusBadRequest)
		return
	}

	configDir := h.deps.ConfigDir()
	if err := os.MkdirAll(configDir, 0755); err != nil {
		http.Error(w, "failed to prepare config dir", http.StatusInternalServerError)
		return
	}

	budget := &ziplimit.Budget{
		MaxEntries:    maxRestoreEntries,
		MaxEntryBytes: maxRestoreEntryBytes,
		MaxTotalBytes: maxRestoreTotalBytes,
	}

	dbDir := h.deps.DBDir()
	if err := os.MkdirAll(dbDir, 0755); err != nil {
		http.Error(w, "failed to prepare database dir", http.StatusInternalServerError)
		return
	}
	dbPath := filepath.Join(dbDir, state.DBFilename)

	// Close before overwriting the file. Replacing encounty.db underneath an
	// open connection leaves that connection writing to the replaced inode, and
	// the old -wal stays on disk to be replayed over the restored database,
	// which silently undoes the restore.
	if db := h.deps.DB(); db != nil {
		_ = db.Close()
	}
	// Reopen whatever ends up on disk, so a failed restore still leaves the app
	// with a working database instead of a closed one.
	reopen := func() error {
		newDB, err := database.Open(dbPath)
		if err != nil {
			return err
		}
		h.deps.SetDB(newDB)
		return nil
	}

	restoredDB := false
	for _, f := range zr.File {
		if !isRestorableFile(f.Name) {
			continue
		}
		// The database follows its own directory; templates belong to the
		// config directory, which never moves.
		root := configDir
		if f.Name == state.DBFilename {
			root = dbDir
		}
		if extractZipEntry(f, root, budget) {
			restoredDB = true
		}
	}

	// The sidecars belong to the database that was just replaced.
	database.RemoveSidecars(dbPath)

	if !restoredDB {
		if err := reopen(); err != nil {
			slog.Error("Failed to reopen database after a rejected restore", "error", err)
		}
		http.Error(w, "encounty.db not found in backup", http.StatusBadRequest)
		return
	}

	if err := reopen(); err != nil {
		http.Error(w, "failed to reopen database: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if err := h.deps.ReloadState(); err != nil {
		http.Error(w, "failed to reload state: "+err.Error(), http.StatusInternalServerError)
		return
	}
	h.deps.BroadcastState()

	httputil.WriteJSON(w, http.StatusOK, restoreResponse{OK: true})
}
