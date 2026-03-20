// api_ws.go — WebSocket action message handlers mirroring the REST API.
package server

import (
	"encoding/json"
	"log/slog"

	"github.com/zsleyer/encounty/backend/internal/state"
)

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
