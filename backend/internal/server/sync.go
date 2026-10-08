// sync.go runs the initial games and Pokédex synchronization, reports its
// progress to connected clients, provides the online and offline setup
// entry points, and keeps existing installs current with a throttled
// background refresh from PokéAPI.

package server

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/zsleyer/encounty/backend/internal/gamesync"
	"github.com/zsleyer/encounty/backend/internal/pokedex"
	"github.com/zsleyer/encounty/backend/internal/server/handler/games"
)

// syncProgress is the WebSocket payload for "sync_progress" events sent
// during InitAsync to inform connected clients about data-loading phases.
type syncProgress struct {
	Phase   string `json:"phase"`
	Step    string `json:"step"`
	Message string `json:"message"`
	Error   string `json:"error,omitempty"`
}

// InitAsync runs initial setup tasks (games and Pokédex loading) in the
// background and marks the server as ready when complete. In dev mode it
// skips auto-sync and waits for the user to choose online or offline
// setup via the /api/setup/* endpoints. Progress is reported via
// "sync_progress" WebSocket events; a final "system_ready" event is
// broadcast once all phases have finished. Afterwards a throttled check
// against PokéAPI picks up newly released games and species.
func (s *Server) InitAsync() {
	go func() {
		// In dev mode, skip auto-sync and let the user choose.
		if s.devMode {
			s.setupPending.Store(true)
			s.ready.Store(true)
			s.hub.BroadcastRaw("system_ready", map[string]any{
				"ready": true, "setup_pending": true, "dev_mode": true,
			})
			slog.Info("Dev mode: waiting for manual setup")
			return
		}

		s.runInitialSync(false)
		s.refreshIfOutdated()
	}()
}

// runInitialSync performs the games and Pokédex synchronization. It
// broadcasts progress via WebSocket and marks the server as ready on
// completion. When the API is unreachable it sends a sync_error event
// so the frontend can offer the offline fallback. When force is true the
// games catalog is refreshed from PokéAPI and the Pokédex sync runs
// unconditionally, bypassing the NeedsSync check. It holds syncMu for the
// whole run, so a forced sync waits for a running background refresh
// instead of failing.
func (s *Server) runInitialSync(force bool) {
	s.syncMu.Lock()
	defer s.syncMu.Unlock()

	// Phase 1: Games
	slog.Info("InitAsync: starting games sync")
	s.hub.BroadcastRaw("sync_progress", syncProgress{
		Phase: "games", Step: "syncing", Message: "Syncing game database...",
	})
	if force {
		s.syncGames(true)
	}
	_ = games.LoadGames(s)
	slog.Info("InitAsync: games sync complete")

	// Phase 2: Pokédex
	store := s.PokedexDB()
	var syncResult *pokedex.SyncResult
	if force || pokedex.NeedsSync(store) {
		slog.Info("InitAsync: starting Pokédex sync")
		s.hub.BroadcastRaw("sync_progress", syncProgress{
			Phase: "pokedex", Step: "syncing", Message: "Syncing Pokédex...",
		})
		syncResult = s.syncPokedex(store, true)
	} else {
		slog.Info("InitAsync: Pokédex already up to date")
		_ = pokedex.LoadPokedex(store)
	}

	s.setupPending.Store(false)
	s.ready.Store(true)
	readyPayload := map[string]any{"ready": true}
	if syncResult != nil {
		readyPayload["sync_result"] = syncResult
	}
	s.hub.BroadcastRaw("system_ready", readyPayload)
	slog.Info("Server initialization complete")
}

// RunSetupOnline triggers a forced online sync from the settings endpoint.
// It always re-syncs the games catalog and the Pokédex regardless of the
// NeedsSync check.
func (s *Server) RunSetupOnline() {
	s.setupPending.Store(false)
	s.ready.Store(false)
	go s.runInitialSync(true)
}

// RunSetupOffline seeds games and Pokédex from embedded fallback data.
func (s *Server) RunSetupOffline() error {
	slog.Info("Setup: seeding from embedded fallback data")
	if err := gamesync.SeedFromFallback(s.GamesDB()); err != nil {
		return fmt.Errorf("seed games: %w", err)
	}
	if err := pokedex.SeedFromFallback(s.PokedexDB()); err != nil {
		return fmt.Errorf("seed pokédex: %w", err)
	}
	s.setupPending.Store(false)
	s.ready.Store(true)
	s.hub.BroadcastRaw("system_ready", map[string]bool{"ready": true})
	slog.Info("Setup: offline seeding complete")
	return nil
}

// syncGames merges new games and missing translations from PokéAPI into the
// games catalog. When notify is true each processed version is broadcast as
// a "sync_progress" event (phase "games", step "version") for the Settings
// UI. Failures are only logged: the local catalog stays usable offline, and
// an error event would make the UI abort the Pokédex phase that follows.
func (s *Server) syncGames(notify bool) {
	store := s.GamesDB()
	if store == nil {
		return
	}
	var progress gamesync.ProgressFn
	if notify {
		progress = func(step string, current, total int) {
			s.hub.BroadcastRaw("sync_progress", syncProgress{
				Phase:   "games",
				Step:    step,
				Message: fmt.Sprintf("Syncing game database (%d/%d)...", current, total),
			})
		}
	}
	result, err := gamesync.SyncFromPokeAPI(store, progress)
	if err != nil {
		slog.Info("Games sync from PokéAPI failed, keeping the local catalog", "error", err)
		return
	}
	slog.Info("Games sync from PokéAPI complete", "added", result.Added, "updated", result.Updated)
}

// syncPokedex performs a full Pokédex sync from PokéAPI and persists the
// result to the database. When notify is true, progress and failures are
// broadcast via the WebSocket hub so the frontend can display a loading
// indicator; the background refresh passes false because no UI listens
// then. Returns the sync result on success, or nil on failure.
func (s *Server) syncPokedex(store pokedex.PokedexStore, notify bool) *pokedex.SyncResult {
	current := pokedex.LoadPokedex(store)

	var progress pokedex.ProgressFn
	if notify {
		progress = func(step, _ string) {
			slog.Info("Pokédex sync progress", "step", step)
			s.hub.BroadcastRaw("sync_progress", syncProgress{
				Phase:   "pokedex",
				Step:    step,
				Message: "Syncing Pokédex – " + step + "...",
			})
		}
	}

	result, updated, err := pokedex.SyncFromPokeAPI(current, progress)
	if err != nil {
		if !notify {
			slog.Info("Background Pokédex sync failed", "error", err)
			return nil
		}
		slog.Error("Pokédex sync failed", "error", err)
		s.hub.BroadcastRaw("sync_progress", syncProgress{
			Phase: "pokedex",
			Step:  "error",
			Error: err.Error(),
		})
		return nil
	}

	species, forms := pokedex.EntriesToRows(updated)
	if err := store.SavePokedex(species, forms); err != nil {
		slog.Error("Failed to save Pokédex", "error", err)
		return nil
	}
	pokedex.InvalidateCache()

	// Backfill base_name/form_name on existing pokemon from the freshly
	// synced pokedex data so the sidebar can display them immediately.
	if n, err := s.db.BackfillPokemonFormNames(); err != nil {
		slog.Warn("Failed to backfill pokemon form names", "error", err)
	} else if n > 0 {
		slog.Info("Backfilled pokemon form names", "updated", n)
	}

	slog.Info("Pokédex sync complete", "total", result.Total, "added", result.Added, "names_updated", result.NamesUpdated)
	return &result
}

// TryStartSync claims the shared PokéAPI sync slot without blocking and
// reports whether it succeeded. It implements games.Deps.
func (s *Server) TryStartSync() bool { return s.syncMu.TryLock() }

// FinishSync releases the slot claimed by a successful TryStartSync.
func (s *Server) FinishSync() { s.syncMu.Unlock() }

// --- Background refresh ------------------------------------------------------

// refreshInterval is the minimum time between two automatic freshness
// checks. While PokéAPI rolls out a new game its endpoints can disagree, so
// a mismatch a sync cannot resolve must not trigger a full sync on every
// launch.
const refreshInterval = 24 * time.Hour

// refreshStampFile is the file in the config directory that records when the
// last automatic refresh was attempted, so the throttle survives restarts.
const refreshStampFile = "pokeapi_refresh_checked"

// pokeAPIRefresh bundles the steps of the background refresh. The network
// calls are plain funcs so tests can exercise the decision logic offline.
type pokeAPIRefresh struct {
	stampPath       string
	now             func() time.Time
	gamesOutdated   func() (bool, error)
	speciesOutdated func() (bool, error)
	syncGames       func()
	syncSpecies     func()
}

// run checks PokéAPI for new games and species and syncs whichever side is
// outdated. It does nothing while the last attempt is younger than
// refreshInterval and reports whether the checks ran.
func (r pokeAPIRefresh) run() bool {
	now := r.now()
	// A stamp from the future (clock moved back) is ignored rather than
	// blocking the refresh until the clock catches up.
	if last, ok := readRefreshStamp(r.stampPath); ok && !last.After(now) && now.Sub(last) < refreshInterval {
		slog.Debug("PokéAPI refresh: checked recently, skipping", "last", last)
		return false
	}
	// The stamp is written before any request so that an offline launch or
	// an unresolvable mismatch still counts as this interval's attempt.
	if err := os.WriteFile(r.stampPath, []byte(now.UTC().Format(time.RFC3339)), 0o644); err != nil {
		slog.Info("PokéAPI refresh: cannot record attempt, skipping", "error", err)
		return false
	}

	if outdated, err := r.gamesOutdated(); err != nil {
		slog.Info("PokéAPI refresh: games check failed", "error", err)
	} else if outdated {
		slog.Info("PokéAPI refresh: new games available, syncing")
		r.syncGames()
	}

	if outdated, err := r.speciesOutdated(); err != nil {
		slog.Info("PokéAPI refresh: species check failed", "error", err)
	} else if outdated {
		slog.Info("PokéAPI refresh: new species available, syncing")
		r.syncSpecies()
	}
	return true
}

// readRefreshStamp returns the time recorded in the stamp file. A missing or
// unparseable stamp reports ok=false, which means "never attempted".
func readRefreshStamp(path string) (time.Time, bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return time.Time{}, false
	}
	t, err := time.Parse(time.RFC3339, strings.TrimSpace(string(data)))
	if err != nil {
		return time.Time{}, false
	}
	return t, true
}

// refreshIfOutdated runs the throttled background refresh after a normal
// startup so existing installs pick up new games and species without user
// action. It is skipped without a database or config directory (tests, broken
// setups) and when another sync already holds syncMu. Nothing is broadcast:
// the UI is already ready and failures are expected while offline.
func (s *Server) refreshIfOutdated() {
	if s.db == nil {
		return
	}
	dir := s.ConfigDir()
	if dir == "" {
		return
	}
	if !s.TryStartSync() {
		slog.Debug("PokéAPI refresh: another sync is running, skipping")
		return
	}
	defer s.FinishSync()

	pokeAPIRefresh{
		stampPath:       filepath.Join(dir, refreshStampFile),
		now:             time.Now,
		gamesOutdated:   func() (bool, error) { return gamesync.HasNewVersions(s.GamesDB()) },
		speciesOutdated: func() (bool, error) { return pokedex.HasNewSpecies(s.PokedexDB()) },
		syncGames:       func() { s.syncGames(false) },
		syncSpecies:     func() { s.syncPokedex(s.PokedexDB(), false) },
	}.run()
}
