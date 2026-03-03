package server

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

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

	for _, name := range []string{"state.json", "pokemon.json"} {
		path := filepath.Join(configDir, name)
		f, err := os.Open(path)
		if err != nil {
			continue // skip missing files
		}
		fw, err := zw.Create(name)
		if err != nil {
			f.Close()
			continue
		}
		io.Copy(fw, f)
		f.Close()
	}
}

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

	restoredState := false
	for _, f := range zr.File {
		if f.Name != "state.json" && f.Name != "pokemon.json" {
			continue
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
		tmp := dest + ".tmp"
		if err := os.WriteFile(tmp, content, 0644); err != nil {
			continue
		}
		if err := os.Rename(tmp, dest); err != nil {
			continue
		}
		if f.Name == "state.json" {
			restoredState = true
		}
	}

	if !restoredState {
		http.Error(w, "state.json not found in backup", http.StatusBadRequest)
		return
	}

	if err := s.state.Reload(); err != nil {
		http.Error(w, "failed to reload state: "+err.Error(), http.StatusInternalServerError)
		return
	}
	s.broadcastState()

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
