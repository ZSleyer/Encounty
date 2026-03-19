// backup.go implements the backup and restore endpoints.
// Backups are ZIP archives containing the SQLite database (which includes
// template images as BLOBs since the v2 schema). Legacy backups with a
// separate templates/ directory are still accepted during restore.
package server

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/zsleyer/encounty/backend/internal/database"
)

// handleBackup streams a ZIP file containing the SQLite database and template
// images directly to the response, triggering a browser file download.
// GET /api/backup
func (s *Server) handleBackup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	configDir := s.state.GetConfigDir()
	ts := time.Now().Format("2006-01-02_150405")
	filename := fmt.Sprintf("encounty-backup-%s.zip", ts)

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)

	zw := zip.NewWriter(w)
	defer zw.Close()

	// Include the SQLite database
	dbPath := filepath.Join(configDir, "encounty.db")
	if f, err := os.Open(dbPath); err == nil {
		fw, err := zw.Create("encounty.db")
		if err == nil {
			io.Copy(fw, f)
		}
		f.Close()
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
		defer f.Close()
		fw, err := zw.Create(rel)
		if err != nil {
			return nil
		}
		io.Copy(fw, f)
		return nil
	})
}

// handleRestore accepts a multipart form upload of a backup ZIP, extracts the
// SQLite database and template images into the config dir, reopens the database,
// reloads state, and broadcasts the new snapshot. POST /api/restore
func (s *Server) handleRestore(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	if err := r.ParseMultipartForm(32 << 20); err != nil {
		http.Error(w, "failed to parse form", http.StatusBadRequest)
		return
	}

	file, _, err := r.FormFile("backup")
	if err != nil {
		http.Error(w, "no backup file provided", http.StatusBadRequest)
		return
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		http.Error(w, "failed to read file", http.StatusInternalServerError)
		return
	}

	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		http.Error(w, "invalid zip file", http.StatusBadRequest)
		return
	}

	configDir := s.state.GetConfigDir()
	if err := os.MkdirAll(configDir, 0755); err != nil {
		http.Error(w, "failed to prepare config dir", http.StatusInternalServerError)
		return
	}

	restoredDB := false
	for _, f := range zr.File {
		// Accept encounty.db and template files
		if f.Name != "encounty.db" && !strings.HasPrefix(f.Name, "templates/") {
			// Also accept legacy state.json for backward compatibility
			if f.Name != "state.json" {
				continue
			}
		}

		rc, err := f.Open()
		if err != nil {
			continue
		}
		content, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			continue
		}

		dest := filepath.Join(configDir, f.Name)
		if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
			continue
		}
		tmp := dest + ".tmp"
		if err := os.WriteFile(tmp, content, 0644); err != nil {
			continue
		}
		if err := os.Rename(tmp, dest); err != nil {
			continue
		}
		if f.Name == "encounty.db" {
			restoredDB = true
		}
	}

	if !restoredDB {
		http.Error(w, "encounty.db not found in backup", http.StatusBadRequest)
		return
	}

	// Reopen the database and reload state
	if s.db != nil {
		s.db.Close()
	}
	dbPath := filepath.Join(configDir, "encounty.db")
	newDB, err := database.Open(dbPath)
	if err != nil {
		http.Error(w, "failed to reopen database: "+err.Error(), http.StatusInternalServerError)
		return
	}
	s.db = newDB
	s.state.SetDB(newDB)

	if err := s.state.Reload(); err != nil {
		http.Error(w, "failed to reload state: "+err.Error(), http.StatusInternalServerError)
		return
	}
	s.broadcastState()

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
