// Package fileoutput writes plain-text files to a user-configured directory
// so that OBS "Text (GDI+)" or "Text (FreeType 2)" sources can display live
// encounter data without a browser source. Files are updated on every counter
// change when output is enabled in settings.
package fileoutput

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/zsleyer/encounty/internal/state"
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
		log.Printf("fileoutput mkdir error: %v", err)
		return
	}

	var active *state.Pokemon
	for i := range st.Pokemon {
		if st.Pokemon[i].ID == st.ActiveID {
			active = &st.Pokemon[i]
			break
		}
	}

	if active == nil {
		w.writeFile(dir, "encounters.txt", "0")
		w.writeFile(dir, "pokemon_name.txt", "—")
		w.writeFile(dir, "encounters_label.txt", "Kein Pokémon aktiv")
	} else {
		w.writeFile(dir, "encounters.txt", fmt.Sprintf("%d", active.Encounters))
		w.writeFile(dir, "pokemon_name.txt", active.Name)
		w.writeFile(dir, "encounters_label.txt", fmt.Sprintf("%s: %d Encounters", active.Name, active.Encounters))
	}

	// Session duration
	elapsed := time.Since(w.startedAt)
	hours := int(elapsed.Hours())
	minutes := int(elapsed.Minutes()) % 60
	seconds := int(elapsed.Seconds()) % 60
	w.writeFile(dir, "session_duration.txt", fmt.Sprintf("%02d:%02d:%02d", hours, minutes, seconds))

	// Today's total encounters
	today := 0
	todayStart := time.Now().Truncate(24 * time.Hour)
	for _, p := range st.Pokemon {
		if p.CreatedAt.After(todayStart) || p.CreatedAt.Equal(todayStart) {
			today += p.Encounters
		}
	}
	// Sum all encounters as approximation for "today" (sessions would be more accurate)
	allEncounters := 0
	for _, p := range st.Pokemon {
		allEncounters += p.Encounters
	}
	w.writeFile(dir, "encounters_today.txt", fmt.Sprintf("%d", allEncounters))
}

func (w *Writer) writeFile(dir, name, content string) {
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		log.Printf("fileoutput write %s: %v", name, err)
	}
}
