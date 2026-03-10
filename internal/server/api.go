// api.go implements the REST API handlers registered by server.go.
// Each handler follows a consistent pattern: parse input, call the state
// manager, schedule a debounced save, broadcast the new state, and respond.
// WebSocket action messages are also routed here via handleWSMessage.
package server

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/zsleyer/encounty/internal/state"
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
		display = "dev-" + s.buildDate + "-" + s.commit
	} else {
		display = s.version + "-" + s.buildDate + "-" + s.commit
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"version":    s.version,
		"commit":     s.commit,
		"build_date": s.buildDate,
		"display":    display,
	})
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
		log.Printf("hotkeys: UpdateAllBindings: %v", err)
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
		log.Printf("games sync error: %v", err)
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
			log.Printf("Save error on quit: %v", err)
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
			log.Printf("Save error on restart: %v", err)
		}
		s.hotkeyMgr.Stop()

		exe, err := os.Executable()
		if err != nil {
			log.Printf("Restart: could not get executable path: %v", err)
			os.Exit(1)
		}
		if err := reexec(exe, os.Args[1:]); err != nil {
			log.Printf("Restart failed: %v", err)
			os.Exit(1)
		}
	}()
}

// reexec is implemented per-platform in reexec_unix.go / reexec_windows.go.
// It replaces the current process with a fresh instance of the binary.
