// server_deps.go implements the dependency interfaces the handler
// sub-packages expect from the Server: thin forwards to the state manager,
// plus the typed database views the handlers consume.

package server

import (
	"time"

	"github.com/zsleyer/encounty/backend/internal/detector"
	"github.com/zsleyer/encounty/backend/internal/server/handler/backgrounds"
	detectorhandler "github.com/zsleyer/encounty/backend/internal/server/handler/detector"
	pokemonhandler "github.com/zsleyer/encounty/backend/internal/server/handler/pokemon"
	"github.com/zsleyer/encounty/backend/internal/state"
)

// --- pokemonhandler.Deps implementation --------------------------------------

// StateAddPokemon appends a new Pokemon to the in-memory state.
func (s *Server) StateAddPokemon(p state.Pokemon) { s.state.AddPokemon(p) }

// StateUpdatePokemon applies field updates to the Pokemon with the given id.
func (s *Server) StateUpdatePokemon(id string, update state.Pokemon) bool {
	return s.state.UpdatePokemon(id, update)
}

// StateClearPokemonSprite resets sprite_url to empty for the Pokemon with the given id.
func (s *Server) StateClearPokemonSprite(id string) bool { return s.state.ClearPokemonSprite(id) }

// StateDeletePokemon removes the Pokemon with the given id.
func (s *Server) StateDeletePokemon(id string) bool { return s.state.DeletePokemon(id) }

// StateIncrement adds one encounter step to the Pokemon.
func (s *Server) StateIncrement(id string) (int, bool) { return s.state.Increment(id) }

// StateDecrement subtracts one encounter step from the Pokemon.
func (s *Server) StateDecrement(id string) (int, bool) { return s.state.Decrement(id) }

// StateReset zeroes the encounter counter for the Pokemon.
func (s *Server) StateReset(id string) bool { return s.state.Reset(id) }

// StateSetEncounters sets the encounter count to an exact value.
func (s *Server) StateSetEncounters(id string, count int) (int, bool) {
	return s.state.SetEncounters(id, count)
}

// StateReorderPokemon assigns each Pokemon in orderedIDs a zero-based SortOrder
// matching its position. Returns an error if any id is unknown.
func (s *Server) StateReorderPokemon(orderedIDs []string) error {
	return s.state.ReorderPokemon(orderedIDs)
}

// StateSetActive marks the given Pokemon as active.
func (s *Server) StateSetActive(id string) bool { return s.state.SetActive(id) }

// StateCompletePokemon stamps CompletedAt on the Pokemon.
func (s *Server) StateCompletePokemon(id string) bool { return s.state.CompletePokemon(id) }

// StateSetCompletedAt re-dates an entry that is already finished.
func (s *Server) StateSetCompletedAt(id string, at time.Time) bool {
	return s.state.SetCompletedAt(id, at)
}

// StateUncompletePokemon clears CompletedAt on the Pokemon.
func (s *Server) StateUncompletePokemon(id string) bool { return s.state.UncompletePokemon(id) }

// StateFailPokemon stamps CompletedAt and sets Failed on the Pokemon: a shiny
// was sighted but not caught.
func (s *Server) StateFailPokemon(id string) bool { return s.state.FailPokemon(id) }

// StateSetCatchMeta replaces the optional details recorded for the catch.
func (s *Server) StateSetCatchMeta(id string, meta *state.CatchMeta, nickname, gender string, spriteURL *string) bool {
	return s.state.SetCatchMeta(id, meta, nickname, gender, spriteURL)
}

// StateEndPhase ends the current phase of the hunt, archiving the off-target
// catch as a linked phase entry. failed marks the archived phase entry as
// sighted-but-not-caught instead of a regular catch.
func (s *Server) StateEndPhase(parentID string, catch state.PhaseCatch, failed bool) (state.Pokemon, error) {
	return s.state.EndPhase(parentID, catch, failed)
}

// StateUndoPhase removes the newest phase entry and returns its encounters and
// timer milliseconds to the parent hunt.
func (s *Server) StateUndoPhase(childID string) (state.Pokemon, error) {
	return s.state.UndoPhase(childID)
}

// StateUnlinkOverlay copies the resolved overlay and sets mode to custom.
func (s *Server) StateUnlinkOverlay(pokemonID string) bool {
	return s.state.UnlinkOverlay(pokemonID)
}

// StateStartTimer begins the per-Pokemon timer.
func (s *Server) StateStartTimer(id string) bool { return s.state.StartTimer(id) }

// StateStopTimer stops the per-Pokemon timer.
func (s *Server) StateStopTimer(id string) bool { return s.state.StopTimer(id) }

// StateResetTimer clears the per-Pokemon timer.
func (s *Server) StateResetTimer(id string) bool { return s.state.ResetTimer(id) }

// StateSetTimer delegates to the state manager's SetTimer.
func (s *Server) StateSetTimer(id string, ms int64) bool { return s.state.SetTimer(id, ms) }

// StateGetState returns a snapshot of the current application state.
func (s *Server) StateGetState() state.AppState { return s.state.GetState() }

// StateScheduleSave enqueues a deferred state save.
func (s *Server) StateScheduleSave() { s.state.ScheduleSave() }

// StateListGroups returns a copy of all organizational groups.
func (s *Server) StateListGroups() []state.Group { return s.state.ListGroups() }

// StateCreateGroup appends a new group with the given name and color.
func (s *Server) StateCreateGroup(name, color string) (state.Group, error) {
	return s.state.CreateGroup(name, color)
}

// StateUpdateGroup applies a partial update to the given group.
func (s *Server) StateUpdateGroup(id string, patch state.GroupPatch) (state.Group, error) {
	return s.state.UpdateGroup(id, patch)
}

// StateDeleteGroup removes the given group and clears GroupID on members.
func (s *Server) StateDeleteGroup(id string) bool { return s.state.DeleteGroup(id) }

// StateToggleHunt flips the timer state for a Pokémon and reports the
// post-toggle running flag plus the Pokémon's configured hunt_mode.
func (s *Server) StateToggleHunt(id string) (bool, string, bool) {
	return s.state.ToggleHunt(id)
}

// DetectorStopper returns nil, native detection has been removed. The
// interface is retained so the pokemon handler can still check and no-op
// when deleting a Pokemon.
func (s *Server) DetectorStopper() pokemonhandler.DetectorStopper {
	return nil
}

// EncounterLogger returns the database as an EncounterLogger, or nil.
func (s *Server) EncounterLogger() pokemonhandler.EncounterLogger {
	return dbAs[pokemonhandler.EncounterLogger](s.db)
}

// Broadcaster returns the WebSocket hub as a Broadcaster.
func (s *Server) Broadcaster() pokemonhandler.Broadcaster { return s.hub }

// DetectorMgr returns the detector manager instance. Returns nil when no
// detector manager is configured.
func (s *Server) DetectorMgr() *detector.Manager {
	return s.detectorMgr
}

// BackgroundsDB returns the database as a backgrounds store so the overlay
// background images can be read and written without the handler package
// depending on the concrete *database.DB type. Returns nil when no database is
// configured.
func (s *Server) BackgroundsDB() backgrounds.BackgroundStore {
	return dbAs[backgrounds.BackgroundStore](s.db)
}

// DetectorDB returns the database handle as a detectorhandler.DetectorStore so
// the detector handler sub-package can load, save and delete template images
// without depending on the concrete *database.DB type. Returns nil when no
// database is configured.
func (s *Server) DetectorDB() detectorhandler.DetectorStore {
	return dbAs[detectorhandler.DetectorStore](s.db)
}

// DetectorEncounterLogger returns the database as a detectorhandler.EncounterLogger
// so the detector match handler can persist encounter events. Returns nil when
// no database is configured.
func (s *Server) DetectorEncounterLogger() detectorhandler.EncounterLogger {
	return dbAs[detectorhandler.EncounterLogger](s.db)
}

// PokemonDB returns the database handle as a pokemonhandler.SpriteStore so the
// pokemon handler can save, load and delete user-uploaded sprite images without
// depending on the concrete *database.DB type. Returns nil when no database is
// configured.
func (s *Server) PokemonDB() pokemonhandler.SpriteStore {
	return dbAs[pokemonhandler.SpriteStore](s.db)
}
