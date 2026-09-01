// hotkeys.go turns global hotkey actions into state mutations and the
// WebSocket events that tell the frontend what happened, including the
// deduplication guard and the hunt-toggle readiness gate.

package server

import (
	"time"

	"github.com/zsleyer/encounty/backend/internal/hotkeys"
	"github.com/zsleyer/encounty/backend/internal/state"
)

// handleHotkeyIncrement processes the "increment" hotkey action for the given Pokémon.
func (s *Server) handleHotkeyIncrement(id string) {
	count, ok := s.state.Increment(id)
	if !ok {
		return
	}
	s.logEncounter(id, count, 1, "hotkey")
	s.state.ScheduleSave()
	s.hub.BroadcastRaw("encounter_added", map[string]any{"pokemon_id": id, "count": count})
	s.broadcastState()
}

// clearEncounterHistory deletes the logged encounter events of the hunt with
// the given id, unless the hunt has phase entries. The events of all earlier
// phases stay attached to the hunt, so on a phased hunt this deletion would not
// drop the few events of the running phase but the whole chart. Shared by every
// path that zeroes a counter (WebSocket decrement and reset, hotkey decrement).
func (s *Server) clearEncounterHistory(id string) {
	if s.db == nil || s.state.HasPhaseChildren(id) {
		return
	}
	_ = s.db.DeleteEncounterEvents(id)
}

// handleHotkeyDecrement processes the "decrement" hotkey action for the given Pokémon.
func (s *Server) handleHotkeyDecrement(id string) {
	count, ok := s.state.Decrement(id)
	if !ok {
		return
	}
	s.logEncounter(id, count, -1, "hotkey")
	if count == 0 {
		s.clearEncounterHistory(id)
	}
	s.state.ScheduleSave()
	s.hub.BroadcastRaw("encounter_removed", map[string]any{"pokemon_id": id, "count": count})
	s.broadcastState()
}

// handleHotkeyGroupIncrement increments all Pokémon in the group and broadcasts.
func (s *Server) handleHotkeyGroupIncrement(groupID string) {
	s.state.IncrementGroup(groupID)
	s.state.ScheduleSave()
	s.broadcastState()
}

// handleHotkeyGroupDecrement decrements all Pokémon in the group and broadcasts.
func (s *Server) handleHotkeyGroupDecrement(groupID string) {
	s.state.DecrementGroup(groupID)
	s.state.ScheduleSave()
	s.broadcastState()
}

// processHotkeyActions consumes the hotkey action channel and translates each
// action into the appropriate state mutation + broadcast. For "reset" the
// frontend is asked to confirm instead of acting immediately, to avoid
// accidental data loss when the reset hotkey is pressed unintentionally.
func (s *Server) processHotkeyActions(ch <-chan hotkeys.Action) {
	for action := range ch {
		s.dispatchHotkeyAction(action)
	}
}

// acceptHotkey returns true when the given hotkey action has not fired
// within the deduplication window. Used to coalesce near-simultaneous
// duplicate dispatches from layered key-capture sources.
func (s *Server) acceptHotkey(action string) bool {
	s.hotkeyDedupMu.Lock()
	defer s.hotkeyDedupMu.Unlock()
	now := time.Now()
	if last, ok := s.hotkeyLastAt[action]; ok && now.Sub(last) < hotkeyDedupWindow {
		return false
	}
	s.hotkeyLastAt[action] = now
	return true
}

// dispatchHotkeyAction routes a single hotkey action to the appropriate handler.
func (s *Server) dispatchHotkeyAction(action hotkeys.Action) {
	// Drop rapid duplicate dispatches so two parallel sources (native
	// CGEventTap + Electron globalShortcut in some dev configurations)
	// cannot double-fire a single keystroke.
	if !s.acceptHotkey(action.Type) {
		return
	}

	// Group hotkey: apply to all members of the active group.
	if action.GroupID != "" {
		switch action.Type {
		case "increment":
			s.handleHotkeyGroupIncrement(action.GroupID)
		case "decrement":
			s.handleHotkeyGroupDecrement(action.GroupID)
		case "reset":
			s.hub.BroadcastRaw("request_group_reset_confirm", map[string]any{"group_id": action.GroupID})
		}
		return
	}

	id := action.PokemonID
	if id == "" {
		if active := s.state.GetActivePokemon(); active != nil {
			id = active.ID
		}
	}
	switch action.Type {
	case "increment":
		if id != "" {
			s.handleHotkeyIncrement(id)
		}
	case "decrement":
		if id != "" {
			s.handleHotkeyDecrement(id)
		}
	case "reset":
		if id != "" {
			s.hub.BroadcastRaw("request_reset_confirm", map[string]any{"pokemon_id": id})
		}
	case "next":
		s.handleHotkeyNext()
	case "hunt_toggle":
		if id != "" {
			s.handleHotkeyHuntToggle(id)
		}
	}
}

// handleHotkeyHuntToggle toggles the hunt state (timer + detector) for the
// given Pokémon. Before starting, the backend gates on detector readiness
// (templates configured). The source check stays in the frontend because
// the backend has no visibility into browser capture streams, so if the
// source is missing the frontend will still roll back, but the common
// no-templates case is blocked here before any timer flips.
func (s *Server) handleHotkeyHuntToggle(id string) {
	snapshot := s.state.GetState()
	var pokemon *state.Pokemon
	for i := range snapshot.Pokemon {
		if snapshot.Pokemon[i].ID == id {
			pokemon = &snapshot.Pokemon[i]
			break
		}
	}
	if pokemon == nil {
		return
	}
	timerRunning := pokemon.TimerStartedAt != nil
	detectorRunning := s.isDetecting(id)
	huntRunning := timerRunning || detectorRunning

	if huntRunning {
		// Stop path: fold the timer if it is running (no-op otherwise) and
		// broadcast a stop event so the frontend tears down its detection
		// loop even when the timer was never the active half of the hunt.
		if timerRunning {
			s.state.ToggleHunt(id)
			s.state.ScheduleSave()
			s.broadcastState()
		}
		s.hub.BroadcastRaw("hunt_stop_requested", map[string]any{
			"pokemon_id": id,
		})
		return
	}

	// Start path: enforce detector readiness when required.
	if huntModeNeedsDetector(pokemon.HuntMode, pokemon.DetectorConfig) {
		if !detectorHasEnabledTemplate(pokemon.DetectorConfig) {
			s.hub.BroadcastRaw("hunt_start_rejected", map[string]any{
				"pokemon_id": id,
				"reason":     "no_templates",
			})
			return
		}
		if !s.isCapturing(id) {
			s.hub.BroadcastRaw("hunt_start_rejected", map[string]any{
				"pokemon_id": id,
				"reason":     "no_source",
			})
			return
		}
	}

	running, huntMode, ok := s.state.ToggleHunt(id)
	if !ok {
		return
	}
	s.state.ScheduleSave()
	s.broadcastState()
	if running {
		s.hub.BroadcastRaw("hunt_start_requested", map[string]any{
			"pokemon_id": id,
			"hunt_mode":  huntMode,
		})
	} else {
		// Defensive: state reported "not running" after a toggle, mirror as
		// a stop so the frontend stays in sync.
		s.hub.BroadcastRaw("hunt_stop_requested", map[string]any{
			"pokemon_id": id,
		})
	}
}

// huntModeNeedsDetector reports whether the configured hunt mode requires
// auto-detection to run. "detector" always does; "both" does when a
// DetectorConfig exists (opt-in), otherwise it collapses to timer-only.
func huntModeNeedsDetector(mode string, cfg *state.DetectorConfig) bool {
	if mode == "detector" {
		return true
	}
	if mode == "both" || mode == "" {
		return cfg != nil
	}
	return false
}

// detectorHasEnabledTemplate reports whether at least one template on the
// config is marked enabled. A nil config or empty template list returns
// false. Template.Enabled == nil is treated as enabled for backward
// compatibility with older snapshots.
func detectorHasEnabledTemplate(cfg *state.DetectorConfig) bool {
	if cfg == nil {
		return false
	}
	for _, tmpl := range cfg.Templates {
		if tmpl.Enabled == nil || *tmpl.Enabled {
			return true
		}
	}
	return false
}

// DispatchHotkeyAction injects a hotkey action from an external source.
func (s *Server) DispatchHotkeyAction(actionType, pokemonID string) {
	s.dispatchHotkeyAction(hotkeys.Action{Type: actionType, PokemonID: pokemonID})
}

// handleHotkeyNext advances to the next Pokémon in the list.
func (s *Server) handleHotkeyNext() {
	s.state.NextPokemon()
	s.state.ScheduleSave()
	s.broadcastState()
}
