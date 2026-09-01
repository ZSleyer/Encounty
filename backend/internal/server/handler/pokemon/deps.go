// deps.go declares the interfaces the Pokemon handlers require from the
// application layer. Keeping them apart from the handlers makes the surface a
// caller has to implement visible without reading the handler bodies.

package pokemon

import (
	"time"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// DetectorStopper can stop a running detector for a given Pokemon ID.
type DetectorStopper interface {
	Stop(pokemonID string)
}

// EncounterLogger persists encounter events to the database.
type EncounterLogger interface {
	LogEncounter(pokemonID, pokemonName string, delta, countAfter int, source string) error
	DeleteEncounterEvents(pokemonID string) error
}

// Broadcaster sends typed messages to all connected WebSocket clients.
type Broadcaster interface {
	BroadcastRaw(msgType string, payload any)
}

// SpriteStore defines the database operations needed to persist and serve
// user-uploaded local Pokemon sprite images as BLOBs.
type SpriteStore interface {
	SaveSprite(pokemonID string, data []byte, mime string) error
	LoadSprite(pokemonID string) (data []byte, mime string, err error)
	DeleteSprite(pokemonID string) error
}

// Deps declares the capabilities that pokemon handlers require from the
// application layer. Each method maps to a specific subsystem so this package
// stays decoupled from the concrete Server type.
type Deps interface {
	// State mutations
	StateAddPokemon(p state.Pokemon)
	StateUpdatePokemon(id string, update state.Pokemon) bool
	// StateClearPokemonSprite resets sprite_url to empty. UpdatePokemon cannot
	// do this itself since it treats an empty SpriteURL as "leave unchanged".
	StateClearPokemonSprite(id string) bool
	StateDeletePokemon(id string) bool
	StateIncrement(id string) (int, bool)
	StateDecrement(id string) (int, bool)
	StateReset(id string) bool
	StateSetEncounters(id string, count int) (int, bool)
	StateReorderPokemon(orderedIDs []string) error
	StateSetActive(id string) bool
	StateCompletePokemon(id string) bool
	// StateSetCompletedAt re-dates an entry that is already finished.
	StateSetCompletedAt(id string, at time.Time) bool
	StateUncompletePokemon(id string) bool
	// StateFailPokemon marks the hunt as finished and failed: a shiny was
	// sighted but not caught.
	StateFailPokemon(id string) bool
	// StateSetCatchMeta replaces the optional details recorded for a catch.
	StateSetCatchMeta(id string, meta *state.CatchMeta, nickname, gender string, spriteURL *string) bool
	// StateEndPhase archives catch as a phase entry of the hunt and restarts
	// the hunt's counter and timer at zero. failed marks the archived phase
	// entry as sighted-but-not-caught instead of a regular catch.
	StateEndPhase(parentID string, catch state.PhaseCatch, failed bool) (state.Pokemon, error)
	// StateUndoPhase removes the newest phase entry of a hunt and returns its
	// encounters and timer milliseconds to the parent hunt.
	StateUndoPhase(childID string) (state.Pokemon, error)
	StateUnlinkOverlay(pokemonID string) bool
	StateStartTimer(id string) bool
	StateStopTimer(id string) bool
	StateResetTimer(id string) bool
	StateSetTimer(id string, ms int64) bool
	StateGetState() state.AppState
	StateScheduleSave()

	// Infrastructure
	DetectorStopper() DetectorStopper
	EncounterLogger() EncounterLogger
	Broadcaster() Broadcaster
	BroadcastState()
	// PokemonDB returns the sprite store, or nil when no database is configured.
	PokemonDB() SpriteStore
}
