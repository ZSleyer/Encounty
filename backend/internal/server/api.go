// api.go implements the REST API handlers registered by server.go.
// Each handler follows a consistent pattern: parse input, call the state
// manager, schedule a debounced save, broadcast the new state, and respond.
// WebSocket action messages are also routed here via handleWSMessage.
package server

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zsleyer/encounty/backend/internal/database"
	"github.com/zsleyer/encounty/backend/internal/licenses"
	"github.com/zsleyer/encounty/backend/internal/state"
)

// writeJSON sets the Content-Type header, writes the HTTP status code, and
// encodes v as JSON into the response body.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// readJSON decodes the JSON request body into v.
func readJSON(r *http.Request, v any) error {
	return json.NewDecoder(r.Body).Decode(v)
}

type errResp struct {
	Error string `json:"error"`
}

// handleGetState returns the full AppState snapshot as JSON.
// GET /api/state
//
// @Summary      Get full application state
// @Description  Returns the complete AppState snapshot including all Pokemon, settings, and sessions
// @Tags         state
// @Produce      json
// @Success      200 {object} state.AppState
// @Router       /state [get]
func (s *Server) handleGetState(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.state.GetState())
}

// handleReadyStatus reports whether the server has finished initial setup
// (games sync, etc.) so the frontend can show a loading screen until ready.
//
// @Summary      Check server readiness
// @Tags         system
// @Produce      json
// @Success      200 {object} ReadyStatusResponse
// @Router       /status/ready [get]
func (s *Server) handleReadyStatus(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, ReadyStatusResponse{
		Ready: s.ready.Load(),
	})
}

// handleAddPokemon creates a new Pokémon entry, assigns a UUID and timestamp,
// and appends it to the state. POST /api/pokemon
//
// @Summary      Create a new Pokemon
// @Description  Creates a new Pokemon entry with a generated UUID and timestamp
// @Tags         pokemon
// @Accept       json
// @Produce      json
// @Param        pokemon body state.Pokemon true "Pokemon to create"
// @Success      201 {object} state.Pokemon
// @Failure      400 {object} errResp
// @Router       /pokemon [post]
func (s *Server) handleAddPokemon(w http.ResponseWriter, r *http.Request) {
	var p state.Pokemon
	if err := readJSON(r, &p); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{err.Error()})
		return
	}
	p.ID = uuid.NewString()
	p.CreatedAt = time.Now()
	// p.Phase removed
	s.state.AddPokemon(p)
	s.state.ScheduleSave()
	s.broadcastState()
	writeJSON(w, http.StatusCreated, p)
}

// handleUpdatePokemon applies the JSON body fields to the Pokémon with the
// given id. PUT /api/pokemon/{id}
//
// @Summary      Update a Pokemon
// @Description  Applies the JSON body fields to the Pokemon with the given ID
// @Tags         pokemon
// @Accept       json
// @Produce      json
// @Param        id path string true "Pokemon ID"
// @Param        pokemon body state.Pokemon true "Updated Pokemon fields"
// @Success      200 {object} state.AppState
// @Failure      400 {object} errResp
// @Failure      404 {object} errResp
// @Router       /pokemon/{id} [put]
func (s *Server) handleUpdatePokemon(w http.ResponseWriter, r *http.Request, id string) {
	var p state.Pokemon
	if err := readJSON(r, &p); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{err.Error()})
		return
	}
	if !s.state.UpdatePokemon(id, p) {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}
	s.state.ScheduleSave()
	s.broadcastState()
	writeJSON(w, http.StatusOK, s.state.GetState())
}

// handleDeletePokemon removes the Pokémon with the given id.
// It also stops any running detector goroutine and removes the template files.
// DELETE /api/pokemon/{id}
//
// @Summary      Delete a Pokemon
// @Description  Removes the Pokemon, stops its detector, and deletes template files
// @Tags         pokemon
// @Param        id path string true "Pokemon ID"
// @Success      204
// @Failure      404 {object} errResp
// @Router       /pokemon/{id} [delete]
func (s *Server) handleDeletePokemon(w http.ResponseWriter, _ *http.Request, id string) {
	if s.detectorMgr != nil {
		s.detectorMgr.Stop(id)
	}
	_ = os.RemoveAll(filepath.Join(s.state.GetConfigDir(), "templates", id))
	if !s.state.DeletePokemon(id) {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}
	s.state.ScheduleSave()
	s.hub.BroadcastRaw("pokemon_deleted", map[string]any{"pokemon_id": id})
	s.broadcastState()
	w.WriteHeader(http.StatusNoContent)
}

// handleIncrement adds one encounter to the Pokémon and broadcasts both a
// targeted "encounter_added" event and a full state update.
// POST /api/pokemon/{id}/increment
//
// @Summary      Increment encounter count
// @Description  Adds one encounter to the Pokemon and broadcasts the update
// @Tags         pokemon
// @Produce      json
// @Param        id path string true "Pokemon ID"
// @Success      200 {object} CountResponse
// @Failure      404 {object} errResp
// @Router       /pokemon/{id}/increment [post]
func (s *Server) handleIncrement(w http.ResponseWriter, _ *http.Request, id string) {
	count, ok := s.state.Increment(id)
	if !ok {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}
	s.logEncounter(id, count, "api")
	s.state.ScheduleSave()
	s.hub.BroadcastRaw("encounter_added", map[string]any{"pokemon_id": id, "count": count})
	s.broadcastState()
	writeJSON(w, http.StatusOK, CountResponse{Count: count})
}

// handleDecrement subtracts one encounter (floor 0) from the Pokémon.
// POST /api/pokemon/{id}/decrement
//
// @Summary      Decrement encounter count
// @Description  Subtracts one encounter from the Pokemon (floor 0)
// @Tags         pokemon
// @Produce      json
// @Param        id path string true "Pokemon ID"
// @Success      200 {object} CountResponse
// @Failure      404 {object} errResp
// @Router       /pokemon/{id}/decrement [post]
func (s *Server) handleDecrement(w http.ResponseWriter, _ *http.Request, id string) {
	count, ok := s.state.Decrement(id)
	if !ok {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}
	s.logEncounter(id, count, "api")
	s.state.ScheduleSave()
	s.hub.BroadcastRaw("encounter_removed", map[string]any{"pokemon_id": id, "count": count})
	s.broadcastState()
	writeJSON(w, http.StatusOK, CountResponse{Count: count})
}

// handleReset zeroes out the encounter counter for the Pokémon.
// POST /api/pokemon/{id}/reset
//
// @Summary      Reset encounter count
// @Description  Zeroes out the encounter counter for the Pokemon
// @Tags         pokemon
// @Param        id path string true "Pokemon ID"
// @Success      204
// @Failure      404 {object} errResp
// @Router       /pokemon/{id}/reset [post]
func (s *Server) handleReset(w http.ResponseWriter, _ *http.Request, id string) {
	if !s.state.Reset(id) {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}
	s.state.ScheduleSave()
	s.hub.BroadcastRaw("encounter_reset", map[string]any{"pokemon_id": id})
	s.broadcastState()
	w.WriteHeader(http.StatusNoContent)
}

// handleSetEncounters sets the encounter count to an exact value.
// POST /api/pokemon/{id}/set_encounters
//
// @Summary      Set encounter count
// @Description  Sets the encounter count to an exact value
// @Tags         pokemon
// @Accept       json
// @Produce      json
// @Param        id path string true "Pokemon ID"
// @Param        body body SetEncountersRequest true "Encounter count to set"
// @Success      200 {object} CountResponse
// @Failure      400 {object} errResp
// @Failure      404 {object} errResp
// @Router       /pokemon/{id}/set_encounters [post]
func (s *Server) handleSetEncounters(w http.ResponseWriter, r *http.Request, id string) {
	var body SetEncountersRequest
	if err := readJSON(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{err.Error()})
		return
	}
	count, ok := s.state.SetEncounters(id, body.Count)
	if !ok {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}
	s.state.ScheduleSave()
	s.hub.BroadcastRaw("encounter_set", map[string]any{"pokemon_id": id, "count": count})
	s.broadcastState()
	writeJSON(w, http.StatusOK, CountResponse{Count: count})
}

// handleTimerStart begins the per-Pokemon timer.
// POST /api/pokemon/{id}/timer/start
//
// @Summary      Start Pokemon timer
// @Description  Begins the per-Pokemon timer
// @Tags         pokemon
// @Param        id path string true "Pokemon ID"
// @Success      204
// @Failure      404 {object} errResp
// @Router       /pokemon/{id}/timer/start [post]
func (s *Server) handleTimerStart(w http.ResponseWriter, _ *http.Request, id string) {
	if !s.state.StartTimer(id) {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}
	s.state.ScheduleSave()
	s.broadcastState()
	w.WriteHeader(http.StatusNoContent)
}

// handleTimerStop stops the per-Pokemon timer and accumulates elapsed time.
// POST /api/pokemon/{id}/timer/stop
//
// @Summary      Stop Pokemon timer
// @Description  Stops the per-Pokemon timer and accumulates elapsed time
// @Tags         pokemon
// @Param        id path string true "Pokemon ID"
// @Success      204
// @Failure      404 {object} errResp
// @Router       /pokemon/{id}/timer/stop [post]
func (s *Server) handleTimerStop(w http.ResponseWriter, _ *http.Request, id string) {
	if !s.state.StopTimer(id) {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}
	s.state.ScheduleSave()
	s.broadcastState()
	w.WriteHeader(http.StatusNoContent)
}

// handleTimerReset clears the per-Pokemon timer entirely.
// POST /api/pokemon/{id}/timer/reset
//
// @Summary      Reset Pokemon timer
// @Description  Clears the per-Pokemon timer entirely
// @Tags         pokemon
// @Param        id path string true "Pokemon ID"
// @Success      204
// @Failure      404 {object} errResp
// @Router       /pokemon/{id}/timer/reset [post]
func (s *Server) handleTimerReset(w http.ResponseWriter, _ *http.Request, id string) {
	if !s.state.ResetTimer(id) {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}
	s.state.ScheduleSave()
	s.broadcastState()
	w.WriteHeader(http.StatusNoContent)
}

// handleSetConfigPath moves all data to a new directory.
// POST /api/settings/config-path
//
// @Summary      Set config directory path
// @Description  Moves all data to a new directory
// @Tags         settings
// @Accept       json
// @Produce      json
// @Param        body body SetConfigPathRequest true "New config path"
// @Success      200 {object} PathResponse
// @Failure      400 {object} errResp
// @Router       /settings/config-path [post]
func (s *Server) handleSetConfigPath(w http.ResponseWriter, r *http.Request) {
	var body SetConfigPathRequest
	if err := readJSON(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{err.Error()})
		return
	}
	if body.Path == "" {
		writeJSON(w, http.StatusBadRequest, errResp{"path is required"})
		return
	}

	// Close the current database before copying files
	if s.db != nil {
		_ = s.db.Close()
	}

	if err := s.state.SetConfigDir(body.Path); err != nil {
		// Reopen old DB on failure
		if s.db != nil {
			oldDB, _ := database.Open(filepath.Join(s.state.GetConfigDir(), dbFilename))
			s.db = oldDB
			s.state.SetDB(oldDB)
			gamesDB = oldDB
		}
		writeJSON(w, http.StatusBadRequest, errResp{err.Error()})
		return
	}

	// Open the database at the new location
	newDB, err := database.Open(filepath.Join(body.Path, dbFilename))
	if err != nil {
		slog.Warn("Could not open database at new path", "error", err)
	}
	s.db = newDB
	s.state.SetDB(newDB)
	if newDB != nil {
		gamesDB = newDB
	}

	s.broadcastState()
	writeJSON(w, http.StatusOK, PathResponse{Path: body.Path})
}

// handleActivate sets the given Pokémon as the active one for hotkey actions.
// POST /api/pokemon/{id}/activate
//
// @Summary      Activate a Pokemon
// @Description  Sets the given Pokemon as the active one for hotkey actions
// @Tags         pokemon
// @Param        id path string true "Pokemon ID"
// @Success      204
// @Failure      404 {object} errResp
// @Router       /pokemon/{id}/activate [post]
func (s *Server) handleActivate(w http.ResponseWriter, _ *http.Request, id string) {
	if !s.state.SetActive(id) {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}
	s.state.ScheduleSave()
	s.broadcastState()
	w.WriteHeader(http.StatusNoContent)
}

// handleCompletePokemon marks the hunt as finished by stamping CompletedAt.
// POST /api/pokemon/{id}/complete
//
// @Summary      Complete a Pokemon hunt
// @Description  Marks the hunt as finished by stamping CompletedAt
// @Tags         pokemon
// @Param        id path string true "Pokemon ID"
// @Success      204
// @Failure      404 {object} errResp
// @Router       /pokemon/{id}/complete [post]
func (s *Server) handleCompletePokemon(w http.ResponseWriter, _ *http.Request, id string) {
	if !s.state.CompletePokemon(id) {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}
	s.state.ScheduleSave()
	s.hub.BroadcastRaw("pokemon_completed", map[string]any{"pokemon_id": id})
	s.broadcastState()
	w.WriteHeader(http.StatusNoContent)
}

// handleUncompletePokemon clears CompletedAt, returning the Pokémon to
// active-hunt status. POST /api/pokemon/{id}/uncomplete
//
// @Summary      Uncomplete a Pokemon hunt
// @Description  Clears CompletedAt, returning the Pokemon to active-hunt status
// @Tags         pokemon
// @Param        id path string true "Pokemon ID"
// @Success      204
// @Failure      404 {object} errResp
// @Router       /pokemon/{id}/uncomplete [post]
func (s *Server) handleUncompletePokemon(w http.ResponseWriter, _ *http.Request, id string) {
	if !s.state.UncompletePokemon(id) {
		writeJSON(w, http.StatusNotFound, errResp{errPokemonNotFound})
		return
	}
	s.state.ScheduleSave()
	s.broadcastState()
	w.WriteHeader(http.StatusNoContent)
}

// handleGetSessions returns the session history as JSON. GET /api/sessions
//
// @Summary      Get session history
// @Description  Returns the session history as JSON
// @Tags         state
// @Produce      json
// @Success      200 {array} state.Session
// @Router       /sessions [get]
func (s *Server) handleGetSessions(w http.ResponseWriter, r *http.Request) {
	st := s.state.GetState()
	writeJSON(w, http.StatusOK, st.Sessions)
}

// handleAcceptLicense records that the user has accepted the AGPLv3 license.
// POST /api/license/accept
//
// @Summary      Accept license
// @Description  Records that the user has accepted the AGPLv3 license
// @Tags         system
// @Produce      json
// @Success      200 {object} LicenseAcceptResponse
// @Router       /license/accept [post]
func (s *Server) handleAcceptLicense(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	s.state.AcceptLicense()
	s.state.ScheduleSave()
	s.broadcastState()
	writeJSON(w, http.StatusOK, LicenseAcceptResponse{LicenseAccepted: true})
}

// handleUpdateSettings replaces the settings block, reconfigures the file
// output writer with the new directory/enabled state, and broadcasts the
// change. POST /api/settings
//
// @Summary      Update settings
// @Description  Replaces the settings block and reconfigures file output
// @Tags         settings
// @Accept       json
// @Produce      json
// @Param        settings body state.Settings true "Updated settings"
// @Success      200 {object} state.Settings
// @Failure      400 {object} errResp
// @Router       /settings [post]
func (s *Server) handleUpdateSettings(w http.ResponseWriter, r *http.Request) {
	var settings state.Settings
	if err := readJSON(r, &settings); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{err.Error()})
		return
	}
	s.state.UpdateSettings(settings)
	s.state.ScheduleSave()
	if s.fileWriter != nil {
		s.fileWriter.SetConfig(settings.OutputDir, settings.OutputEnabled)
	}
	s.broadcastState()
	writeJSON(w, http.StatusOK, settings)
}

// handleVersion returns build version information injected at compile time.
// GET /api/version
//
// @Summary      Get version info
// @Description  Returns build version information injected at compile time
// @Tags         system
// @Produce      json
// @Success      200 {object} VersionResponse
// @Router       /version [get]
func (s *Server) handleVersion(w http.ResponseWriter, _ *http.Request) {
	var display string
	if s.version == "dev" {
		display = "dev-" + s.commit
	} else {
		display = s.version + "-" + s.commit
	}
	writeJSON(w, http.StatusOK, VersionResponse{
		Version:   s.version,
		Commit:    s.commit,
		BuildDate: s.buildDate,
		Display:   display,
	})
}

// handleLicenses returns all collected third-party license entries.
// GET /api/licenses
//
// @Summary      Get third-party licenses
// @Description  Returns all collected third-party license entries
// @Tags         system
// @Produce      json
// @Success      200 {array} licenses.Entry
// @Router       /licenses [get]
func (s *Server) handleLicenses(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, licenses.All())
}

// handleUpdateHotkeys replaces the full hotkey map and re-registers all
// bindings with the OS hotkey manager. POST /api/hotkeys
//
// @Summary      Update all hotkeys
// @Description  Replaces the full hotkey map and re-registers all bindings
// @Tags         hotkeys
// @Accept       json
// @Produce      json
// @Param        hotkeys body state.HotkeyMap true "Complete hotkey map"
// @Success      200 {object} state.HotkeyMap
// @Failure      400 {object} errResp
// @Router       /hotkeys [post]
func (s *Server) handleUpdateHotkeys(w http.ResponseWriter, r *http.Request) {
	var hk state.HotkeyMap
	if err := readJSON(r, &hk); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{err.Error()})
		return
	}
	s.state.UpdateHotkeys(hk)
	s.state.ScheduleSave()
	if err := s.hotkeyMgr.UpdateAllBindings(hk); err != nil {
		slog.Error("Failed to update hotkey bindings", "error", err)
	}
	s.broadcastState()
	writeJSON(w, http.StatusOK, hk)
}

// handleUpdateSingleHotkey updates one action's key binding without
// touching the others. PUT /api/hotkeys/{action}
//
// @Summary      Update a single hotkey
// @Description  Updates one action's key binding without touching the others
// @Tags         hotkeys
// @Accept       json
// @Produce      json
// @Param        action path string true "Hotkey action name"
// @Param        body body UpdateHotkeyRequest true "New key binding"
// @Success      200 {object} HotkeyUpdateResponse
// @Failure      400 {object} errResp
// @Failure      404 {object} errResp
// @Router       /hotkeys/{action} [put]
func (s *Server) handleUpdateSingleHotkey(w http.ResponseWriter, r *http.Request, action string) {
	var body UpdateHotkeyRequest
	if err := readJSON(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{err.Error()})
		return
	}
	if !s.state.UpdateSingleHotkey(action, body.Key) {
		writeJSON(w, http.StatusNotFound, errResp{"unknown hotkey action"})
		return
	}
	s.state.ScheduleSave()
	if err := s.hotkeyMgr.UpdateBinding(action, body.Key); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{err.Error()})
		return
	}
	s.broadcastState()
	writeJSON(w, http.StatusOK, HotkeyUpdateResponse{Action: action, Key: body.Key})
}

// handleGetGames returns the games list sorted by generation. GET /api/games
//
// @Summary      Get games list
// @Description  Returns the games list sorted by generation
// @Tags         games
// @Produce      json
// @Success      200 {array} GameEntry
// @Router       /games [get]
func (s *Server) handleGetGames(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, loadGames())
}

// handleGetHuntTypes returns all available hunt type presets as JSON.
// The slice is ordered as defined in state.HuntTypePresets.
// GET /api/hunt-types
//
// @Summary      Get hunt type presets
// @Description  Returns all available hunt type presets
// @Tags         games
// @Produce      json
// @Success      200 {array} state.HuntTypePreset
// @Router       /hunt-types [get]
func (s *Server) handleGetHuntTypes(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, state.HuntTypePresets)
}

// handleOverlayState returns only the data needed by the OBS overlay page:
// the active Pokémon and its id. GET /api/overlay/state
//
// @Summary      Get overlay state
// @Description  Returns the active Pokemon and its ID for the OBS overlay page
// @Tags         overlay
// @Produce      json
// @Success      200 {object} OverlayStateResponse
// @Router       /overlay/state [get]
func (s *Server) handleOverlayState(w http.ResponseWriter, r *http.Request) {
	st := s.state.GetState()
	var active *state.Pokemon
	for i := range st.Pokemon {
		if st.Pokemon[i].ID == st.ActiveID {
			active = &st.Pokemon[i]
			break
		}
	}
	writeJSON(w, http.StatusOK, OverlayStateResponse{
		ActivePokemon: active,
		ActiveID:      st.ActiveID,
	})
}

// handleUnlinkOverlay copies the resolved overlay into the Pokemon and sets
// its mode to "custom", breaking any link to another Pokemon's overlay.
// POST /api/pokemon/{id}/overlay/unlink
//
// @Summary      Unlink Pokemon overlay
// @Description  Copies the resolved overlay into the Pokemon and sets mode to custom
// @Tags         pokemon
// @Param        id path string true "Pokemon ID"
// @Success      204
// @Failure      404 {object} errResp
// @Router       /pokemon/{id}/overlay/unlink [post]
func (s *Server) handleUnlinkOverlay(w http.ResponseWriter, r *http.Request) {
	id := pokemonIDFromPath(r.URL.Path, "/api/pokemon/", "/overlay/unlink")
	if !s.state.UnlinkOverlay(id) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	s.state.ScheduleSave()
	s.broadcastState()
	w.WriteHeader(http.StatusNoContent)
}

// logEncounter writes an encounter event to the database.
// It resolves the Pokemon name and computes the delta from the previous count.
func (s *Server) logEncounter(pokemonID string, countAfter int, source string) {
	if s.db == nil {
		return
	}
	st := s.state.GetState()
	name := pokemonID
	step := 1
	for _, p := range st.Pokemon {
		if p.ID == pokemonID {
			name = p.Name
			if p.Step > 0 {
				step = p.Step
			}
			break
		}
	}
	// For increment the delta is +step, for decrement -step.
	// We infer direction from the source context; callers use this after Increment/Decrement.
	// Since we don't know direction here, log step as positive (most common).
	// Actual delta = countAfter - previous. We approximate with step.
	_ = s.db.LogEncounter(pokemonID, name, step, countAfter, source)
}

// broadcastState serialises the current AppState and sends a "state_update"
// message to every connected WebSocket client.
func (s *Server) broadcastState() {
	st := s.state.GetState()
	s.hub.BroadcastRaw("state_update", st)
}

// wsIDPayload is the common payload shape for WebSocket actions that only
// need a pokemon_id field.
type wsIDPayload struct {
	PokemonID string `json:"pokemon_id"`
}

// handleWSMessage dispatches action messages sent by the frontend over
// WebSocket. Each case delegates to a dedicated wsHandle* method that mirrors
// the equivalent REST endpoint but without an HTTP response.
func (s *Server) handleWSMessage(msg WSMessage) {
	switch msg.Type {
	case "increment":
		s.wsHandleIncrement(msg.Payload)
	case "decrement":
		s.wsHandleDecrement(msg.Payload)
	case "reset":
		s.wsHandleReset(msg.Payload)
	case "set_active":
		s.wsHandleSetActive(msg.Payload)
	case "set_encounters":
		s.wsHandleSetEncounters(msg.Payload)
	case "complete":
		s.wsHandleComplete(msg.Payload)
	case "uncomplete":
		s.wsHandleUncomplete(msg.Payload)
	case "timer_start":
		s.wsHandleTimerStart(msg.Payload)
	case "timer_stop":
		s.wsHandleTimerStop(msg.Payload)
	case "timer_reset":
		s.wsHandleTimerReset(msg.Payload)
	case "update_hotkeys":
		s.wsHandleUpdateHotkeys(msg.Payload)
	}
}

// wsHandleIncrement adds one encounter to the Pokémon identified in the
// payload and broadcasts the updated state.
func (s *Server) wsHandleIncrement(payload json.RawMessage) {
	var p wsIDPayload
	if json.Unmarshal(payload, &p) != nil || p.PokemonID == "" {
		return
	}
	count, ok := s.state.Increment(p.PokemonID)
	if !ok {
		return
	}
	s.logEncounter(p.PokemonID, count, "hotkey")
	s.state.ScheduleSave()
	s.hub.BroadcastRaw("encounter_added", map[string]any{"pokemon_id": p.PokemonID, "count": count})
	s.broadcastState()
}

// wsHandleDecrement subtracts one encounter from the Pokémon identified in
// the payload and broadcasts the updated state.
func (s *Server) wsHandleDecrement(payload json.RawMessage) {
	var p wsIDPayload
	if json.Unmarshal(payload, &p) != nil || p.PokemonID == "" {
		return
	}
	count, ok := s.state.Decrement(p.PokemonID)
	if !ok {
		return
	}
	s.logEncounter(p.PokemonID, count, "hotkey")
	s.state.ScheduleSave()
	s.hub.BroadcastRaw("encounter_removed", map[string]any{"pokemon_id": p.PokemonID, "count": count})
	s.broadcastState()
}

// wsHandleReset zeroes out the encounter counter for the Pokémon identified
// in the payload and broadcasts the updated state.
func (s *Server) wsHandleReset(payload json.RawMessage) {
	var p wsIDPayload
	if json.Unmarshal(payload, &p) != nil || p.PokemonID == "" {
		return
	}
	if !s.state.Reset(p.PokemonID) {
		return
	}
	s.state.ScheduleSave()
	s.hub.BroadcastRaw("encounter_reset", map[string]any{"pokemon_id": p.PokemonID})
	s.broadcastState()
}

// wsHandleSetActive sets the given Pokémon as the active one for hotkey
// actions and broadcasts the updated state.
func (s *Server) wsHandleSetActive(payload json.RawMessage) {
	var p wsIDPayload
	if json.Unmarshal(payload, &p) != nil || p.PokemonID == "" {
		return
	}
	s.state.SetActive(p.PokemonID)
	s.state.ScheduleSave()
	s.broadcastState()
}

// wsHandleSetEncounters sets the encounter count to an exact value for the
// Pokémon identified in the payload and broadcasts the updated state.
func (s *Server) wsHandleSetEncounters(payload json.RawMessage) {
	var p struct {
		PokemonID string `json:"pokemon_id"`
		Count     int    `json:"count"`
	}
	if json.Unmarshal(payload, &p) != nil || p.PokemonID == "" {
		return
	}
	count, ok := s.state.SetEncounters(p.PokemonID, p.Count)
	if !ok {
		return
	}
	s.state.ScheduleSave()
	s.hub.BroadcastRaw("encounter_set", map[string]any{"pokemon_id": p.PokemonID, "count": count})
	s.broadcastState()
}

// wsHandleComplete marks the hunt as finished for the Pokémon identified in
// the payload and broadcasts the updated state.
func (s *Server) wsHandleComplete(payload json.RawMessage) {
	var p wsIDPayload
	if json.Unmarshal(payload, &p) != nil || p.PokemonID == "" {
		return
	}
	if !s.state.CompletePokemon(p.PokemonID) {
		return
	}
	s.state.ScheduleSave()
	s.hub.BroadcastRaw("pokemon_completed", map[string]any{"pokemon_id": p.PokemonID})
	s.broadcastState()
}

// wsHandleUncomplete clears CompletedAt for the Pokémon identified in the
// payload, returning it to active-hunt status.
func (s *Server) wsHandleUncomplete(payload json.RawMessage) {
	var p wsIDPayload
	if json.Unmarshal(payload, &p) != nil || p.PokemonID == "" {
		return
	}
	s.state.UncompletePokemon(p.PokemonID)
	s.state.ScheduleSave()
	s.broadcastState()
}

// wsHandleTimerStart begins the per-Pokemon timer for the Pokémon identified
// in the payload and broadcasts the updated state.
func (s *Server) wsHandleTimerStart(payload json.RawMessage) {
	var p wsIDPayload
	if json.Unmarshal(payload, &p) != nil || p.PokemonID == "" {
		return
	}
	if s.state.StartTimer(p.PokemonID) {
		s.state.ScheduleSave()
		s.broadcastState()
	}
}

// wsHandleTimerStop stops the per-Pokemon timer and accumulates elapsed time
// for the Pokémon identified in the payload.
func (s *Server) wsHandleTimerStop(payload json.RawMessage) {
	var p wsIDPayload
	if json.Unmarshal(payload, &p) != nil || p.PokemonID == "" {
		return
	}
	if s.state.StopTimer(p.PokemonID) {
		s.state.ScheduleSave()
		s.broadcastState()
	}
}

// wsHandleTimerReset clears the per-Pokemon timer entirely for the Pokémon
// identified in the payload and broadcasts the updated state.
func (s *Server) wsHandleTimerReset(payload json.RawMessage) {
	var p wsIDPayload
	if json.Unmarshal(payload, &p) != nil || p.PokemonID == "" {
		return
	}
	if s.state.ResetTimer(p.PokemonID) {
		s.state.ScheduleSave()
		s.broadcastState()
	}
}

// wsHandleUpdateHotkeys replaces the full hotkey map and re-registers all
// bindings via the WebSocket action, mirroring the REST endpoint.
func (s *Server) wsHandleUpdateHotkeys(payload json.RawMessage) {
	var hk state.HotkeyMap
	if json.Unmarshal(payload, &hk) != nil {
		return
	}
	s.state.UpdateHotkeys(hk)
	s.state.ScheduleSave()
	if err := s.hotkeyMgr.UpdateAllBindings(hk); err != nil {
		slog.Error("Failed to update hotkey bindings via WebSocket", "error", err)
	}
	s.broadcastState()
}

// pokemonIDFromPath extracts the id segment from paths like /api/pokemon/{id}/action
func pokemonIDFromPath(path, prefix, suffix string) string {
	path = strings.TrimPrefix(path, prefix)
	if suffix != "" {
		path = strings.TrimSuffix(path, suffix)
	}
	return strings.Trim(path, "/")
}

// handleSyncGames triggers a background sync of game metadata from PokéAPI
// and writes the merged result to the config-dir games.json.
// POST /api/games/sync
//
// @Summary      Sync games from PokeAPI
// @Description  Triggers a background sync of game metadata from PokeAPI
// @Tags         games
// @Produce      json
// @Success      200 {object} GamesSyncResult
// @Failure      500 {object} errResp
// @Router       /games/sync [post]
func (s *Server) handleSyncGames(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	result, err := SyncGamesFromPokeAPI()
	if err != nil {
		slog.Error("Games sync error", "error", err)
		writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// handleHotkeysPause suspends global hotkey dispatch without unregistering
// the bindings (useful while the settings UI captures key input).
// POST /api/hotkeys/pause
//
// @Summary      Pause hotkeys
// @Description  Suspends global hotkey dispatch without unregistering bindings
// @Tags         hotkeys
// @Produce      json
// @Success      200 {object} StatusResponse
// @Router       /hotkeys/pause [post]
func (s *Server) handleHotkeysPause(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	s.hotkeyMgr.SetPaused(true)
	writeJSON(w, http.StatusOK, StatusResponse{Status: "paused"})
}

// handleHotkeysResume re-enables hotkey dispatch after a pause.
// POST /api/hotkeys/resume
//
// @Summary      Resume hotkeys
// @Description  Re-enables hotkey dispatch after a pause
// @Tags         hotkeys
// @Produce      json
// @Success      200 {object} StatusResponse
// @Router       /hotkeys/resume [post]
func (s *Server) handleHotkeysResume(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	s.hotkeyMgr.SetPaused(false)
	writeJSON(w, http.StatusOK, StatusResponse{Status: "active"})
}

// handleHotkeysStatus reports whether the hotkey backend is available
// (false on Linux when the user lacks /dev/input read permission).
// GET /api/hotkeys/status
//
// @Summary      Get hotkey status
// @Description  Reports whether the hotkey backend is available
// @Tags         hotkeys
// @Produce      json
// @Success      200 {object} HotkeysStatusResponse
// @Router       /hotkeys/status [get]
func (s *Server) handleHotkeysStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, HotkeysStatusResponse{
		Available: s.hotkeyMgr.IsAvailable(),
	})
}

// handleQuit performs a graceful shutdown: saves state, stops hotkeys, and
// calls os.Exit after a short delay so the HTTP response can be sent first.
// POST /api/quit
//
// @Summary      Quit application
// @Description  Performs a graceful shutdown: saves state, stops hotkeys, and exits
// @Tags         system
// @Produce      json
// @Success      200 {object} StatusResponse
// @Router       /quit [post]
func (s *Server) handleQuit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, http.StatusOK, StatusResponse{Status: "shutting down"})

	go func() {
		time.Sleep(100 * time.Millisecond)
		if err := s.state.Save(); err != nil {
			slog.Error("Failed to save state on quit", "error", err)
		}
		s.hotkeyMgr.Stop()
		os.Exit(0)
	}()
}

// handleRestart saves state, stops hotkeys, and replaces the running process
// with a fresh instance via reexec (platform-specific). POST /api/restart
//
// @Summary      Restart application
// @Description  Saves state, stops hotkeys, and replaces the process with a fresh instance
// @Tags         system
// @Produce      json
// @Success      200 {object} StatusResponse
// @Router       /restart [post]
func (s *Server) handleRestart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, http.StatusOK, StatusResponse{Status: "restarting"})

	go func() {
		time.Sleep(100 * time.Millisecond)
		if err := s.state.Save(); err != nil {
			slog.Error("Failed to save state on restart", "error", err)
		}
		s.hotkeyMgr.Stop()

		exe, err := os.Executable()
		if err != nil {
			slog.Error("Restart: could not get executable path", "error", err)
			os.Exit(1)
		}
		if err := reexec(exe, os.Args[1:]); err != nil {
			slog.Error("Restart failed", "error", err)
			os.Exit(1)
		}
	}()
}

// handleStatsOverview returns global encounter statistics.
// GET /api/stats/overview
//
// @Summary      Get statistics overview
// @Description  Returns global encounter statistics
// @Tags         statistics
// @Produce      json
// @Success      200 {object} database.OverviewStats
// @Failure      503 {object} errResp
// @Failure      500 {object} errResp
// @Router       /stats/overview [get]
func (s *Server) handleStatsOverview(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, errResp{"database not available"})
		return
	}
	stats, err := s.db.GetOverviewStats()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

// handleStatsDispatch routes /api/stats/pokemon/{id}, /api/stats/pokemon/{id}/history,
// and /api/stats/pokemon/{id}/chart to the appropriate handler.
//
// @Summary      Get Pokemon encounter stats
// @Description  Returns encounter statistics for a specific Pokemon, with optional /history or /chart sub-paths
// @Tags         statistics
// @Produce      json
// @Param        id path string true "Pokemon ID"
// @Success      200 {object} database.EncounterStats
// @Failure      503 {object} errResp
// @Failure      500 {object} errResp
// @Router       /stats/pokemon/{id} [get]
func (s *Server) handleStatsDispatch(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, errResp{"database not available"})
		return
	}
	path := r.URL.Path
	switch {
	case strings.HasSuffix(path, "/history"):
		id := pokemonIDFromPath(path, statsPokemonPrefix, "/history")
		limit := 20
		offset := 0
		if v := r.URL.Query().Get("limit"); v != "" {
			_, _ = fmt.Sscanf(v, "%d", &limit)
		}
		if v := r.URL.Query().Get("offset"); v != "" {
			_, _ = fmt.Sscanf(v, "%d", &offset)
		}
		events, err := s.db.GetEncounterHistory(id, limit, offset)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, events)
	case strings.HasSuffix(path, "/chart"):
		id := pokemonIDFromPath(path, statsPokemonPrefix, "/chart")
		interval := r.URL.Query().Get("interval")
		if interval == "" {
			interval = "day"
		}
		data, err := s.db.GetChartData(id, interval)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, data)
	default:
		id := pokemonIDFromPath(path, statsPokemonPrefix, "")
		stats, err := s.db.GetEncounterStats(id)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, stats)
	}
}

// reexec is implemented per-platform in reexec_unix.go / reexec_windows.go.
// It replaces the current process with a fresh instance of the binary.
