// sync.go runs the initial games and Pokédex synchronization, reports its
// progress to connected clients, and provides the online and offline setup
// entry points.

package server

import (
	"fmt"
	"log/slog"

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
// broadcast once all phases have finished.
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
	}()
}

// runInitialSync performs the games and Pokédex synchronization. It
// broadcasts progress via WebSocket and marks the server as ready on
// completion. When the API is unreachable it sends a sync_error event
// so the frontend can offer the offline fallback. When force is true the
// Pokédex sync runs unconditionally, bypassing the NeedsSync check.
func (s *Server) runInitialSync(force bool) {
	// Phase 1: Games
	slog.Info("InitAsync: starting games sync")
	s.hub.BroadcastRaw("sync_progress", syncProgress{
		Phase: "games", Step: "syncing", Message: "Syncing game database...",
	})
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
		syncResult = s.syncPokedex(store)
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
// It always re-syncs the Pokédex regardless of the NeedsSync check.
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

// syncPokedex performs a full Pokédex sync from PokéAPI and persists the
// result to the database. Progress updates are broadcast via the WebSocket
// hub so the frontend can display a loading indicator. Returns the sync
// result on success, or nil on failure.
func (s *Server) syncPokedex(store pokedex.PokedexStore) *pokedex.SyncResult {
	current := pokedex.LoadPokedex(store)

	progress := func(step, detail string) {
		slog.Info("Pokédex sync progress", "step", step)
		s.hub.BroadcastRaw("sync_progress", syncProgress{
			Phase:   "pokedex",
			Step:    step,
			Message: "Syncing Pokédex – " + step + "...",
		})
	}

	result, updated, err := pokedex.SyncFromPokeAPI(current, progress)
	if err != nil {
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
