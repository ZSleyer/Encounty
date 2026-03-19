// Package fileoutput writes plain-text files to a user-configured directory
// so that OBS "Text (GDI+)" or "Text (FreeType 2)" sources can display live
// encounter data without a browser source. Files are updated on every counter
// change when output is enabled in settings.
package fileoutput

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// File name constants used for OBS text source integration.
const (
	encountersFile      = "encounters.txt"
	pokemonNameFile     = "pokemon_name.txt"
	encountersLabelFile = "encounters_label.txt"
)

// Writer manages file output to a directory. All public methods are safe
// for concurrent use; a mutex protects the mutable dir/enabled fields.
type Writer struct {
	mu        sync.Mutex
	dir       string
	enabled   bool
	startedAt time.Time
}

// New creates a Writer that will write to dir when enabled is true.
// startedAt is initialised to the current time for session-duration tracking.
func New(dir string, enabled bool) *Writer {
	return &Writer{dir: dir, enabled: enabled, startedAt: time.Now()}
}

// SetConfig updates the output directory and enabled flag at runtime.
// Called whenever settings are saved.
func (w *Writer) SetConfig(dir string, enabled bool) {
	w.mu.Lock()
	w.dir = dir
	w.enabled = enabled
	w.mu.Unlock()
}

// writeRootFiles writes the top-level text files for the active Pokémon
// (encounters, name, label) and session-wide metrics (duration, daily total).
func (w *Writer) writeRootFiles(dir string, st state.AppState) {
	var active *state.Pokemon
	for i := range st.Pokemon {
		if st.Pokemon[i].ID == st.ActiveID {
			active = &st.Pokemon[i]
			break
		}
	}

	if active == nil {
		w.writeFile(dir, encountersFile, "0")
		w.writeFile(dir, pokemonNameFile, "—")
		w.writeFile(dir, encountersLabelFile, "Kein Pokémon aktiv")
	} else {
		w.writeFile(dir, encountersFile, fmt.Sprintf("%d", active.Encounters))
		w.writeFile(dir, pokemonNameFile, active.Name)
		w.writeFile(dir, encountersLabelFile, fmt.Sprintf("%s: %d Encounters", active.Name, active.Encounters))
	}

	elapsed := time.Since(w.startedAt)
	hours := int(elapsed.Hours())
	minutes := int(elapsed.Minutes()) % 60
	seconds := int(elapsed.Seconds()) % 60
	w.writeFile(dir, "session_duration.txt", fmt.Sprintf("%02d:%02d:%02d", hours, minutes, seconds))

	allEncounters := 0
	for _, p := range st.Pokemon {
		allEncounters += p.Encounters
	}
	w.writeFile(dir, "encounters_today.txt", fmt.Sprintf("%d", allEncounters))
}

// writePokemonDir creates and populates the per-Pokémon subdirectory with
// encounter count, name, title, label, and timer text files for OBS sources.
func (w *Writer) writePokemonDir(dir string, p state.Pokemon) {
	idPrefix := p.ID
	if len(idPrefix) > 5 {
		idPrefix = idPrefix[:5]
	}
	subDir := sanitizeFilename(p.Name) + "_" + idPrefix
	pokemonDir := filepath.Join(dir, subDir)
	if err := os.MkdirAll(pokemonDir, 0755); err != nil {
		slog.Error("Per-pokemon dir error", "dir", subDir, "error", err)
		return
	}
	w.writeFile(pokemonDir, encountersFile, fmt.Sprintf("%d", p.Encounters))
	w.writeFile(pokemonDir, pokemonNameFile, p.Name)
	title := p.Title
	if title == "" {
		title = p.Name
	}
	w.writeFile(pokemonDir, "title.txt", title)
	w.writeFile(pokemonDir, encountersLabelFile, fmt.Sprintf("%s: %d Encounters", p.Name, p.Encounters))

	totalMs := p.TimerAccumulatedMs
	if p.TimerStartedAt != nil {
		totalMs += time.Since(*p.TimerStartedAt).Milliseconds()
	}
	timerH := totalMs / 3600000
	timerM := (totalMs % 3600000) / 60000
	timerS := (totalMs % 60000) / 1000
	w.writeFile(pokemonDir, "timer.txt", fmt.Sprintf("%02d:%02d:%02d", timerH, timerM, timerS))
}

// pokemonSubDirName returns the sanitized directory name for a Pokémon.
func pokemonSubDirName(p state.Pokemon) string {
	idPrefix := p.ID
	if len(idPrefix) > 5 {
		idPrefix = idPrefix[:5]
	}
	return sanitizeFilename(p.Name) + "_" + idPrefix
}

// Write updates all output text files from the given state snapshot.
// It is a no-op when output is disabled or no output directory is configured.
// Files written: encounters.txt, pokemon_name.txt, encounters_label.txt,
// session_duration.txt, encounters_today.txt.
func (w *Writer) Write(st state.AppState) {
	w.mu.Lock()
	dir := w.dir
	enabled := w.enabled
	w.mu.Unlock()

	if dir == "" || !enabled {
		return
	}

	if err := os.MkdirAll(dir, 0755); err != nil {
		slog.Error("File output mkdir error", "error", err)
		return
	}

	w.writeRootFiles(dir, st)

	// Per-Pokemon subdirectories
	validDirs := make(map[string]bool)
	for _, p := range st.Pokemon {
		subDir := pokemonSubDirName(p)
		validDirs[subDir] = true
		w.writePokemonDir(dir, p)
	}

	// Clean up orphaned per-pokemon directories
	dirEntries, _ := os.ReadDir(dir)
	for _, e := range dirEntries {
		if e.IsDir() && strings.Contains(e.Name(), "_") && !validDirs[e.Name()] {
			_ = os.RemoveAll(filepath.Join(dir, e.Name()))
		}
	}
}

var unsafeChars = regexp.MustCompile(`[^a-zA-Z0-9_\-.]`)

// sanitizeFilename replaces special characters and limits length for safe
// use as a directory or file name on all major platforms.
func sanitizeFilename(name string) string {
	s := unsafeChars.ReplaceAllString(name, "_")
	if len(s) > 60 {
		s = s[:60]
	}
	if s == "" {
		s = "unknown"
	}
	return s
}

func (w *Writer) writeFile(dir, name, content string) {
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		slog.Error("File output write error", "file", name, "error", err)
	}
}
