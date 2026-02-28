package hotkeys

// Action represents a hotkey-triggered action.
type Action struct {
	Type      string // "increment" | "decrement" | "reset" | "next"
	PokemonID string
}
