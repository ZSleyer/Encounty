// api.go holds the server-level helpers shared by the WebSocket and HTTP
// paths: the state broadcast and the encounter log.
package server

// broadcastState serialises the current AppState and sends a "state_update"
// message to every connected WebSocket client.
func (s *Server) broadcastState() {
	// ponytail: phase entries are ordinary Pokemon rows, so every state_update
	// carries all of them and the payload grows linearly with the phase count.
	// Fine for the few hundred phases a hunt realistically reaches; if a payload
	// ever becomes a problem, send phase entries as a separate paged endpoint
	// and keep only the derived totals in the state broadcast.
	st := s.state.GetState()
	s.hub.BroadcastRaw("state_update", st)
}

// logEncounter writes an encounter event to the database.
// It resolves the Pokemon name and computes the delta from the configured step.
// sign must be +1 for increments or -1 for decrements.
func (s *Server) logEncounter(pokemonID string, countAfter int, sign int, source string) {
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
	_ = s.db.LogEncounter(pokemonID, name, step*sign, countAfter, source)
}
