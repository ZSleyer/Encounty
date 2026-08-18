// catchmeta_test.go covers SetCatchMeta: the guards around an unknown id, the
// ribbon normalization it shares with tags, and the rule that an ordinary edit
// of a Pokémon never touches the recorded catch details.
package state

import "testing"

// newCatchManager returns a manager holding one Pokémon named by id.
func newCatchManager(t *testing.T, id string) *Manager {
	t.Helper()
	m := NewManager(t.TempDir())
	m.AddPokemon(Pokemon{ID: id, Name: "Karpador", CanonicalName: "magikarp"})
	return m
}

// catchMetaOf returns the recorded metadata of the Pokémon with the given id.
func catchMetaOf(t *testing.T, m *Manager, id string) *CatchMeta {
	t.Helper()
	for _, p := range m.GetState().Pokemon {
		if p.ID == id {
			return p.Catch
		}
	}
	t.Fatalf("pokemon %q missing from state", id)
	return nil
}

// TestSetCatchMetaOnMissingPokemon verifies that recording metadata for an
// unknown id is refused instead of silently creating an entry.
func TestSetCatchMetaOnMissingPokemon(t *testing.T) {
	m := newCatchManager(t, "pk1")

	if m.SetCatchMeta("nope", &CatchMeta{Nature: "adamant"}, "", "", nil) {
		t.Error("SetCatchMeta on an unknown id = true, want false")
	}
	if got := catchMetaOf(t, m, "pk1"); got != nil {
		t.Errorf("pk1 Catch = %+v, want nil", got)
	}
}

// TestSetCatchMetaNormalizesRibbons verifies that ribbons go through the same
// trimming and deduplication as tags, and that metadata carrying nothing but
// blank ribbons clears the record instead of storing an empty one.
func TestSetCatchMetaNormalizesRibbons(t *testing.T) {
	m := newCatchManager(t, "pk1")

	if !m.SetCatchMeta("pk1", &CatchMeta{
		Nature:  "adamant",
		Ribbons: []string{" effort-ribbon ", "effort-ribbon", "", "  ", "champion-ribbon"},
	}, " Sparky ", "", nil) {
		t.Fatal("SetCatchMeta = false, want true")
	}
	got := catchMetaOf(t, m, "pk1")
	if got == nil {
		t.Fatal("Catch = nil, want the recorded metadata")
	}
	if nickname := m.GetState().Pokemon[0].Nickname; nickname != "Sparky" {
		t.Errorf("Nickname = %q, want Sparky", nickname)
	}
	want := []string{"effort-ribbon", "champion-ribbon"}
	if len(got.Ribbons) != len(want) {
		t.Fatalf("Ribbons = %v, want %v", got.Ribbons, want)
	}
	for i := range want {
		if got.Ribbons[i] != want[i] {
			t.Errorf("Ribbons[%d] = %q, want %q", i, got.Ribbons[i], want[i])
		}
	}

	// Nothing but blank ribbons is nothing at all.
	if !m.SetCatchMeta("pk1", &CatchMeta{Ribbons: []string{" ", ""}}, "", "", nil) {
		t.Fatal("SetCatchMeta = false, want true")
	}
	if got := catchMetaOf(t, m, "pk1"); got != nil {
		t.Errorf("Catch = %+v, want nil after clearing", got)
	}
}

// TestUpdatePokemonDoesNotTouchCatchMeta verifies that an edit form which never
// loaded the catch details cannot wipe them, and that a payload carrying its
// own details cannot write them either.
func TestUpdatePokemonDoesNotTouchCatchMeta(t *testing.T) {
	m := newCatchManager(t, "pk1")
	level := 42
	if !m.SetCatchMeta("pk1", &CatchMeta{Nature: "adamant", Level: &level}, "", "", nil) {
		t.Fatal("SetCatchMeta = false, want true")
	}

	if !m.UpdatePokemon("pk1", Pokemon{
		Name:  "Garados",
		Catch: &CatchMeta{Nature: "timid"},
	}) {
		t.Fatal("UpdatePokemon = false, want true")
	}

	got := catchMetaOf(t, m, "pk1")
	if got == nil {
		t.Fatal("Catch = nil, an unrelated edit dropped the recorded metadata")
	}
	if got.Nature != "adamant" {
		t.Errorf("Nature = %q, want %q", got.Nature, "adamant")
	}
	if got.Level == nil || *got.Level != 42 {
		t.Errorf("Level = %v, want 42", got.Level)
	}
}
