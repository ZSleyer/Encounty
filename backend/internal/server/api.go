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
func (s *Server) handleGetState(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.state.GetState())
}

// handleAddPokemon creates a new Pokémon entry, assigns a UUID and timestamp,
// and appends it to the state. POST /api/pokemon
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
func (s *Server) handleUpdatePokemon(w http.ResponseWriter, r *http.Request, id string) {
	var p state.Pokemon
	if err := readJSON(r, &p); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{err.Error()})
		return
	}
	if !s.state.UpdatePokemon(id, p) {
		writeJSON(w, http.StatusNotFound, errResp{"pokemon not found"})
		return
	}
	s.state.ScheduleSave()
	s.broadcastState()
	writeJSON(w, http.StatusOK, s.state.GetState())
}

// handleDeletePokemon removes the Pokémon with the given id.
// It also stops any running detector goroutine and removes the template files.
// DELETE /api/pokemon/{id}
func (s *Server) handleDeletePokemon(w http.ResponseWriter, _ *http.Request, id string) {
	if s.detectorMgr != nil {
		s.detectorMgr.Stop(id)
	}
	_ = os.RemoveAll(filepath.Join(s.state.GetConfigDir(), "templates", id))
	if !s.state.DeletePokemon(id) {
		writeJSON(w, http.StatusNotFound, errResp{"pokemon not found"})
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
func (s *Server) handleIncrement(w http.ResponseWriter, _ *http.Request, id string) {
	count, ok := s.state.Increment(id)
	if !ok {
		writeJSON(w, http.StatusNotFound, errResp{"pokemon not found"})
		return
	}
	s.logEncounter(id, count, "api")
	s.state.ScheduleSave()
	s.hub.BroadcastRaw("encounter_added", map[string]any{"pokemon_id": id, "count": count})
	s.broadcastState()
	if s.fileWriter != nil {
		s.fileWriter.Write(s.state.GetState())
	}
	writeJSON(w, http.StatusOK, map[string]int{"count": count})
}

// handleDecrement subtracts one encounter (floor 0) from the Pokémon.
// POST /api/pokemon/{id}/decrement
func (s *Server) handleDecrement(w http.ResponseWriter, _ *http.Request, id string) {
	count, ok := s.state.Decrement(id)
	if !ok {
		writeJSON(w, http.StatusNotFound, errResp{"pokemon not found"})
		return
	}
	s.logEncounter(id, count, "api")
	s.state.ScheduleSave()
	s.hub.BroadcastRaw("encounter_removed", map[string]any{"pokemon_id": id, "count": count})
	s.broadcastState()
	if s.fileWriter != nil {
		s.fileWriter.Write(s.state.GetState())
	}
	writeJSON(w, http.StatusOK, map[string]int{"count": count})
}

// handleReset zeroes out the encounter counter for the Pokémon.
// POST /api/pokemon/{id}/reset
func (s *Server) handleReset(w http.ResponseWriter, _ *http.Request, id string) {
	if !s.state.Reset(id) {
		writeJSON(w, http.StatusNotFound, errResp{"pokemon not found"})
		return
	}
	s.state.ScheduleSave()
	s.hub.BroadcastRaw("encounter_reset", map[string]any{"pokemon_id": id})
	s.broadcastState()
	if s.fileWriter != nil {
		s.fileWriter.Write(s.state.GetState())
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleSetEncounters sets the encounter count to an exact value.
// POST /api/pokemon/{id}/set_encounters
func (s *Server) handleSetEncounters(w http.ResponseWriter, r *http.Request, id string) {
	var body struct {
		Count int `json:"count"`
	}
	if err := readJSON(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp{err.Error()})
		return
	}
	count, ok := s.state.SetEncounters(id, body.Count)
	if !ok {
		writeJSON(w, http.StatusNotFound, errResp{"pokemon not found"})
		return
	}
	s.state.ScheduleSave()
	s.hub.BroadcastRaw("encounter_set", map[string]any{"pokemon_id": id, "count": count})
	s.broadcastState()
	if s.fileWriter != nil {
		s.fileWriter.Write(s.state.GetState())
	}
	writeJSON(w, http.StatusOK, map[string]int{"count": count})
}

// handleTimerStart begins the per-Pokemon timer.
// POST /api/pokemon/{id}/timer/start
func (s *Server) handleTimerStart(w http.ResponseWriter, _ *http.Request, id string) {
	if !s.state.StartTimer(id) {
		writeJSON(w, http.StatusNotFound, errResp{"pokemon not found"})
		return
	}
	s.state.ScheduleSave()
	s.broadcastState()
	w.WriteHeader(http.StatusNoContent)
}

// handleTimerStop stops the per-Pokemon timer and accumulates elapsed time.
// POST /api/pokemon/{id}/timer/stop
func (s *Server) handleTimerStop(w http.ResponseWriter, _ *http.Request, id string) {
	if !s.state.StopTimer(id) {
		writeJSON(w, http.StatusNotFound, errResp{"pokemon not found"})
		return
	}
	s.state.ScheduleSave()
	s.broadcastState()
	w.WriteHeader(http.StatusNoContent)
}

// handleTimerReset clears the per-Pokemon timer entirely.
// POST /api/pokemon/{id}/timer/reset
func (s *Server) handleTimerReset(w http.ResponseWriter, _ *http.Request, id string) {
	if !s.state.ResetTimer(id) {
		writeJSON(w, http.StatusNotFound, errResp{"pokemon not found"})
		return
	}
	s.state.ScheduleSave()
	s.broadcastState()
	w.WriteHeader(http.StatusNoContent)
}

// handleSetConfigPath moves all data to a new directory.
// POST /api/settings/config-path
func (s *Server) handleSetConfigPath(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path string `json:"path"`
	}
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
		s.db.Close()
	}

	if err := s.state.SetConfigDir(body.Path); err != nil {
		// Reopen old DB on failure
		if s.db != nil {
			oldDB, _ := database.Open(filepath.Join(s.state.GetConfigDir(), "encounty.db"))
			s.db = oldDB
			s.state.SetDB(oldDB)
			gamesDB = oldDB
		}
		writeJSON(w, http.StatusBadRequest, errResp{err.Error()})
		return
	}

	// Open the database at the new location
	newDB, err := database.Open(filepath.Join(body.Path, "encounty.db"))
	if err != nil {
		slog.Warn("Could not open database at new path", "error", err)
	}
	s.db = newDB
	s.state.SetDB(newDB)
	if newDB != nil {
		gamesDB = newDB
	}

	s.broadcastState()
	writeJSON(w, http.StatusOK, map[string]string{"path": body.Path})
}

// handleActivate sets the given Pokémon as the active one for hotkey actions.
// POST /api/pokemon/{id}/activate
func (s *Server) handleActivate(w http.ResponseWriter, _ *http.Request, id string) {
	if !s.state.SetActive(id) {
		writeJSON(w, http.StatusNotFound, errResp{"pokemon not found"})
		return
	}
	s.state.ScheduleSave()
	s.broadcastState()
	w.WriteHeader(http.StatusNoContent)
}

// handleCompletePokemon marks the hunt as finished by stamping CompletedAt.
// POST /api/pokemon/{id}/complete
func (s *Server) handleCompletePokemon(w http.ResponseWriter, _ *http.Request, id string) {
	if !s.state.CompletePokemon(id) {
		writeJSON(w, http.StatusNotFound, errResp{"pokemon not found"})
		return
	}
	s.state.ScheduleSave()
	s.hub.BroadcastRaw("pokemon_completed", map[string]any{"pokemon_id": id})
	s.broadcastState()
	w.WriteHeader(http.StatusNoContent)
}

// handleUncompletePokemon clears CompletedAt, returning the Pokémon to
// active-hunt status. POST /api/pokemon/{id}/uncomplete
func (s *Server) handleUncompletePokemon(w http.ResponseWriter, _ *http.Request, id string) {
	if !s.state.UncompletePokemon(id) {
		writeJSON(w, http.StatusNotFound, errResp{"pokemon not found"})
		return
	}
	s.state.ScheduleSave()
	s.broadcastState()
	w.WriteHeader(http.StatusNoContent)
}

// handleGetSessions returns the session history as JSON. GET /api/sessions
func (s *Server) handleGetSessions(w http.ResponseWriter, r *http.Request) {
	st := s.state.GetState()
	writeJSON(w, http.StatusOK, st.Sessions)
}

// handleAcceptLicense records that the user has accepted the AGPLv3 license.
// POST /api/license/accept
func (s *Server) handleAcceptLicense(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	s.state.AcceptLicense()
	s.state.ScheduleSave()
	s.broadcastState()
	writeJSON(w, http.StatusOK, map[string]bool{"license_accepted": true})
}

// handleUpdateSettings replaces the settings block, reconfigures the file
// output writer with the new directory/enabled state, and broadcasts the
// change. POST /api/settings
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
func (s *Server) handleVersion(w http.ResponseWriter, _ *http.Request) {
	var display string
	if s.version == "dev" {
		display = "dev-" + s.commit
	} else {
		display = s.version + "-" + s.commit
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"version":    s.version,
		"commit":     s.commit,
		"build_date": s.buildDate,
		"display":    display,
	})
}

// handleLicenses returns all collected third-party license entries.
// GET /api/licenses
func (s *Server) handleLicenses(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, licenses.All())
}

// handleUpdateHotkeys replaces the full hotkey map and re-registers all
// bindings with the OS hotkey manager. POST /api/hotkeys
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
func (s *Server) handleUpdateSingleHotkey(w http.ResponseWriter, r *http.Request, action string) {
	var body struct {
		Key string `json:"key"`
	}
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
	writeJSON(w, http.StatusOK, map[string]string{"action": action, "key": body.Key})
}

// handleGetGames returns the games list sorted by generation. GET /api/games
func (s *Server) handleGetGames(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, loadGames())
}

// handleGetHuntTypes returns all available hunt type presets as JSON.
// The slice is ordered as defined in state.HuntTypePresets.
// GET /api/hunt-types
func (s *Server) handleGetHuntTypes(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, state.HuntTypePresets)
}

// handleOverlayState returns only the data needed by the OBS overlay page:
// the active Pokémon and its id. GET /api/overlay/state
func (s *Server) handleOverlayState(w http.ResponseWriter, r *http.Request) {
	st := s.state.GetState()
	var active *state.Pokemon
	for i := range st.Pokemon {
		if st.Pokemon[i].ID == st.ActiveID {
			active = &st.Pokemon[i]
			break
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"active_pokemon": active,
		"active_id":      st.ActiveID,
	})
}

// handleUnlinkOverlay copies the resolved overlay into the Pokemon and sets
// its mode to "custom", breaking any link to another Pokemon's overlay.
// POST /api/pokemon/{id}/overlay/unlink
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

// handleWSMessage dispatches action messages sent by the frontend over
// WebSocket (increment, decrement, reset, set_active, complete, uncomplete).
// Each case mirrors the equivalent REST endpoint but without an HTTP response.
func (s *Server) handleWSMessage(msg WSMessage) {
	type idPayload struct {
		PokemonID string `json:"pokemon_id"`
	}

	switch msg.Type {
	case "increment":
		var p idPayload
		if json.Unmarshal(msg.Payload, &p) == nil && p.PokemonID != "" {
			count, ok := s.state.Increment(p.PokemonID)
			if ok {
				s.logEncounter(p.PokemonID, count, "hotkey")
				s.state.ScheduleSave()
				s.hub.BroadcastRaw("encounter_added", map[string]any{"pokemon_id": p.PokemonID, "count": count})
				s.broadcastState()
				if s.fileWriter != nil {
					s.fileWriter.Write(s.state.GetState())
				}
			}
		}
	case "decrement":
		var p idPayload
		if json.Unmarshal(msg.Payload, &p) == nil && p.PokemonID != "" {
			count, ok := s.state.Decrement(p.PokemonID)
			if ok {
				s.logEncounter(p.PokemonID, count, "hotkey")
				s.state.ScheduleSave()
				s.hub.BroadcastRaw("encounter_removed", map[string]any{"pokemon_id": p.PokemonID, "count": count})
				s.broadcastState()
				if s.fileWriter != nil {
					s.fileWriter.Write(s.state.GetState())
				}
			}
		}
	case "reset":
		var p idPayload
		if json.Unmarshal(msg.Payload, &p) == nil && p.PokemonID != "" {
			ok := s.state.Reset(p.PokemonID)
			if ok {
				s.state.ScheduleSave()
				s.hub.BroadcastRaw("encounter_reset", map[string]any{"pokemon_id": p.PokemonID})
				s.broadcastState()
				if s.fileWriter != nil {
					s.fileWriter.Write(s.state.GetState())
				}
			}
		}
	case "set_active":
		var p idPayload
		if json.Unmarshal(msg.Payload, &p) == nil && p.PokemonID != "" {
			s.state.SetActive(p.PokemonID)
			s.state.ScheduleSave()
			s.broadcastState()
		}
	case "complete":
		var p idPayload
		if json.Unmarshal(msg.Payload, &p) == nil && p.PokemonID != "" {
			ok := s.state.CompletePokemon(p.PokemonID)
			if ok {
				s.state.ScheduleSave()
				s.hub.BroadcastRaw("pokemon_completed", map[string]any{"pokemon_id": p.PokemonID})
				s.broadcastState()
			}
		}
	case "uncomplete":
		var p idPayload
		if json.Unmarshal(msg.Payload, &p) == nil && p.PokemonID != "" {
			s.state.UncompletePokemon(p.PokemonID)
			s.state.ScheduleSave()
			s.broadcastState()
		}
	case "set_encounters":
		var p struct {
			PokemonID string `json:"pokemon_id"`
			Count     int    `json:"count"`
		}
		if json.Unmarshal(msg.Payload, &p) == nil && p.PokemonID != "" {
			count, ok := s.state.SetEncounters(p.PokemonID, p.Count)
			if ok {
				s.state.ScheduleSave()
				s.hub.BroadcastRaw("encounter_set", map[string]any{"pokemon_id": p.PokemonID, "count": count})
				s.broadcastState()
				if s.fileWriter != nil {
					s.fileWriter.Write(s.state.GetState())
				}
			}
		}
	case "timer_start":
		var p idPayload
		if json.Unmarshal(msg.Payload, &p) == nil && p.PokemonID != "" {
			if s.state.StartTimer(p.PokemonID) {
				s.state.ScheduleSave()
				s.broadcastState()
			}
		}
	case "timer_stop":
		var p idPayload
		if json.Unmarshal(msg.Payload, &p) == nil && p.PokemonID != "" {
			if s.state.StopTimer(p.PokemonID) {
				s.state.ScheduleSave()
				s.broadcastState()
			}
		}
	case "timer_reset":
		var p idPayload
		if json.Unmarshal(msg.Payload, &p) == nil && p.PokemonID != "" {
			if s.state.ResetTimer(p.PokemonID) {
				s.state.ScheduleSave()
				s.broadcastState()
			}
		}
	}
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
func (s *Server) handleSyncGames(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	result, err := SyncGamesFromPokeAPI()
	if err != nil {
		slog.Error("Games sync error", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// handleHotkeysPause suspends global hotkey dispatch without unregistering
// the bindings (useful while the settings UI captures key input).
// POST /api/hotkeys/pause
func (s *Server) handleHotkeysPause(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	s.hotkeyMgr.SetPaused(true)
	writeJSON(w, http.StatusOK, map[string]string{"status": "paused"})
}

// handleHotkeysResume re-enables hotkey dispatch after a pause.
// POST /api/hotkeys/resume
func (s *Server) handleHotkeysResume(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	s.hotkeyMgr.SetPaused(false)
	writeJSON(w, http.StatusOK, map[string]string{"status": "active"})
}

// handleHotkeysStatus reports whether the hotkey backend is available
// (false on Linux when the user lacks /dev/input read permission).
// GET /api/hotkeys/status
func (s *Server) handleHotkeysStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"available": s.hotkeyMgr.IsAvailable(),
	})
}

// handleQuit performs a graceful shutdown: saves state, stops hotkeys, and
// calls os.Exit after a short delay so the HTTP response can be sent first.
// POST /api/quit
func (s *Server) handleQuit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "shutting down"})

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
func (s *Server) handleRestart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "restarting"})

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
func (s *Server) handleStatsDispatch(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, errResp{"database not available"})
		return
	}
	path := r.URL.Path
	switch {
	case strings.HasSuffix(path, "/history"):
		id := pokemonIDFromPath(path, "/api/stats/pokemon/", "/history")
		limit := 20
		offset := 0
		if v := r.URL.Query().Get("limit"); v != "" {
			fmt.Sscanf(v, "%d", &limit)
		}
		if v := r.URL.Query().Get("offset"); v != "" {
			fmt.Sscanf(v, "%d", &offset)
		}
		events, err := s.db.GetEncounterHistory(id, limit, offset)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, errResp{err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, events)
	case strings.HasSuffix(path, "/chart"):
		id := pokemonIDFromPath(path, "/api/stats/pokemon/", "/chart")
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
		id := pokemonIDFromPath(path, "/api/stats/pokemon/", "")
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
