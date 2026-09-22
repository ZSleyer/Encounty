package server

import (
	"testing"

	"github.com/zsleyer/encounty/backend/internal/hotkeys"
)

// TestDedupKeepsSeparateTargetsApart verifies that two hunts carrying their own
// key can both be counted inside the deduplication window. Keying the window on
// the action name alone would have swallowed the second press.
func TestDedupKeepsSeparateTargetsApart(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	addTestPokemon(t, srv, "p2", "Charmander")

	srv.dispatchHotkeyAction(hotkeys.Action{Type: "increment", PokemonID: "p1"})
	srv.dispatchHotkeyAction(hotkeys.Action{Type: "increment", PokemonID: "p2"})

	for _, p := range srv.state.GetState().Pokemon {
		if p.Encounters != 1 {
			t.Errorf("%s encounters = %d, want 1", p.ID, p.Encounters)
		}
	}
}

// TestDedupCoalescesTheSameKeystroke verifies that one key press relayed twice,
// once with the active target already resolved and once without, still counts
// once. That is the macOS configuration the window exists for: the native event
// tap fills the target in, the Electron relay does not.
func TestDedupCoalescesTheSameKeystroke(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	srv.state.SetActive("p1")

	srv.dispatchHotkeyAction(hotkeys.Action{Type: "increment", PokemonID: "p1"})
	srv.dispatchHotkeyAction(hotkeys.Action{Type: "increment"})

	if got := srv.state.GetState().Pokemon[0].Encounters; got != 1 {
		t.Errorf("encounters = %d, want 1", got)
	}
}

// TestDedupResolvesTheActiveGroup verifies that a relayed action with no target
// reaches the active group. Before the target was resolved up front it fell
// through to the active Pokémon, which is empty by design while a group is
// active, so the press did nothing at all.
func TestDedupResolvesTheActiveGroup(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	g, err := srv.state.CreateGroup("Safari", "")
	if err != nil {
		t.Fatalf("CreateGroup: %v", err)
	}
	if !srv.state.SetPokemonGroup("p1", g.ID) {
		t.Fatal("SetPokemonGroup returned false")
	}
	srv.state.SetActiveGroup(g.ID)

	srv.dispatchHotkeyAction(hotkeys.Action{Type: "increment"})

	if got := srv.state.GetState().Pokemon[0].Encounters; got != 1 {
		t.Errorf("encounters = %d, want 1", got)
	}
}

// TestDedupKeepsNextTargetFree verifies that the cycle action is not pinned to
// the entry it happens to start on. Filling a target in would give the same
// keystroke relayed twice two deduplication keys and skip a hunt.
func TestDedupKeepsNextTargetFree(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	addTestPokemon(t, srv, "p2", "Charmander")
	addTestPokemon(t, srv, "p3", "Squirtle")
	srv.state.SetActive("p1")

	srv.dispatchHotkeyAction(hotkeys.Action{Type: "next", PokemonID: "p1"})
	srv.dispatchHotkeyAction(hotkeys.Action{Type: "next"})

	if got := srv.state.GetState().ActiveID; got != "p2" {
		t.Errorf("ActiveID = %q, want %q", got, "p2")
	}
}
