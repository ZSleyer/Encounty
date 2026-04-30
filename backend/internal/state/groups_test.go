// groups_test.go covers the organisational grouping and tagging features:
// CreateGroup / UpdateGroup / DeleteGroup, SetPokemonGroup / SetPokemonTags,
// tag normalisation, and JSON serialisation of empty Tags slices.
package state

import (
	"encoding/json"
	"strings"
	"testing"
)

// TestCreateGroupAssignsIDAndSortOrder verifies that CreateGroup trims the
// name, generates an id, and appends the group at the end of the sort order.
func TestCreateGroupAssignsIDAndSortOrder(t *testing.T) {
	m := NewManager(t.TempDir())

	g1, err := m.CreateGroup("  Legendaries  ", "#ff0000")
	if err != nil {
		t.Fatalf("CreateGroup first: %v", err)
	}
	if g1.Name != "Legendaries" {
		t.Errorf("Name = %q, want trimmed %q", g1.Name, "Legendaries")
	}
	if g1.ID == "" {
		t.Error("ID should be populated")
	}
	if g1.SortOrder != 0 {
		t.Errorf("SortOrder = %d, want 0 for first group", g1.SortOrder)
	}

	g2, err := m.CreateGroup("Shinies", "")
	if err != nil {
		t.Fatalf("CreateGroup second: %v", err)
	}
	if g2.SortOrder != 1 {
		t.Errorf("SortOrder = %d, want 1 for second group", g2.SortOrder)
	}
}

// TestCreateGroupEmptyNameRejected verifies that empty or whitespace-only
// names produce an error instead of silently creating an unnamed group.
func TestCreateGroupEmptyNameRejected(t *testing.T) {
	m := NewManager(t.TempDir())
	if _, err := m.CreateGroup("", ""); err == nil {
		t.Error("expected error for empty name")
	}
	if _, err := m.CreateGroup("   ", ""); err == nil {
		t.Error("expected error for whitespace-only name")
	}
	if got := m.ListGroups(); len(got) != 0 {
		t.Errorf("ListGroups len = %d, want 0 (no group should have been added)", len(got))
	}
}

// TestUpdateGroupPartialPatch verifies that UpdateGroup only touches the
// fields present in the patch and leaves the rest untouched.
func TestUpdateGroupPartialPatch(t *testing.T) {
	m := NewManager(t.TempDir())
	g, err := m.CreateGroup("Alpha", "#111111")
	if err != nil {
		t.Fatalf("CreateGroup: %v", err)
	}

	newName := "Beta"
	updated, err := m.UpdateGroup(g.ID, GroupPatch{Name: &newName})
	if err != nil {
		t.Fatalf("UpdateGroup: %v", err)
	}
	if updated.Name != "Beta" {
		t.Errorf("Name = %q, want %q", updated.Name, "Beta")
	}
	if updated.Color != "#111111" {
		t.Errorf("Color = %q, want unchanged %q", updated.Color, "#111111")
	}

	collapsed := true
	updated, err = m.UpdateGroup(g.ID, GroupPatch{Collapsed: &collapsed})
	if err != nil {
		t.Fatalf("UpdateGroup collapsed: %v", err)
	}
	if !updated.Collapsed {
		t.Error("Collapsed should be true after patch")
	}
	if updated.Name != "Beta" {
		t.Errorf("Name = %q, want unchanged %q", updated.Name, "Beta")
	}
}

// TestUpdateGroupEmptyNameRejected verifies that UpdateGroup refuses to set
// an empty name via patch.
func TestUpdateGroupEmptyNameRejected(t *testing.T) {
	m := NewManager(t.TempDir())
	g, _ := m.CreateGroup("Alpha", "")

	empty := "   "
	if _, err := m.UpdateGroup(g.ID, GroupPatch{Name: &empty}); err == nil {
		t.Error("expected error for empty name patch")
	}
	after := m.ListGroups()[0]
	if after.Name != "Alpha" {
		t.Errorf("Name = %q, want unchanged %q", after.Name, "Alpha")
	}
}

// TestUpdateGroupNotFound verifies that UpdateGroup returns an error for an
// unknown id.
func TestUpdateGroupNotFound(t *testing.T) {
	m := NewManager(t.TempDir())
	if _, err := m.UpdateGroup("nope", GroupPatch{}); err == nil {
		t.Error("expected error for unknown group id")
	}
}

// TestDeleteGroupClearsPokemonMembership verifies that removing a group also
// resets Pokemon.GroupID on any Pokémon that referenced it.
func TestDeleteGroupClearsPokemonMembership(t *testing.T) {
	m := NewManager(t.TempDir())
	g, _ := m.CreateGroup("Hunts", "")
	m.AddPokemon(makePokemon("p1", "Pikachu"))
	if !m.SetPokemonGroup("p1", g.ID) {
		t.Fatal("SetPokemonGroup returned false")
	}

	if !m.DeleteGroup(g.ID) {
		t.Fatal("DeleteGroup returned false")
	}

	st := m.GetState()
	if st.Pokemon[0].GroupID != "" {
		t.Errorf("Pokemon.GroupID = %q, want cleared after DeleteGroup", st.Pokemon[0].GroupID)
	}
	if len(st.Groups) != 0 {
		t.Errorf("Groups len = %d, want 0", len(st.Groups))
	}
}

// TestDeleteGroupNotFound verifies that DeleteGroup reports false for an
// unknown id and leaves state intact.
func TestDeleteGroupNotFound(t *testing.T) {
	m := NewManager(t.TempDir())
	if m.DeleteGroup("nope") {
		t.Error("DeleteGroup returned true for unknown id")
	}
}

// TestSetPokemonGroupValidatesExistence verifies that SetPokemonGroup refuses
// a non-empty group id that does not map to a real group.
func TestSetPokemonGroupValidatesExistence(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))

	if m.SetPokemonGroup("p1", "nonexistent") {
		t.Error("SetPokemonGroup should return false for unknown group id")
	}
	if got := m.GetState().Pokemon[0].GroupID; got != "" {
		t.Errorf("GroupID = %q, want empty (assignment should not have succeeded)", got)
	}
}

// TestSetPokemonGroupClearsAssignment verifies that passing an empty string
// removes the Pokémon's group assignment.
func TestSetPokemonGroupClearsAssignment(t *testing.T) {
	m := NewManager(t.TempDir())
	g, _ := m.CreateGroup("G", "")
	m.AddPokemon(makePokemon("p1", "Pikachu"))
	m.SetPokemonGroup("p1", g.ID)

	if !m.SetPokemonGroup("p1", "") {
		t.Fatal("SetPokemonGroup with empty id should succeed")
	}
	if got := m.GetState().Pokemon[0].GroupID; got != "" {
		t.Errorf("GroupID = %q, want empty", got)
	}
}

// TestSetPokemonGroupUnknownPokemon verifies that SetPokemonGroup returns
// false when the target Pokémon does not exist.
func TestSetPokemonGroupUnknownPokemon(t *testing.T) {
	m := NewManager(t.TempDir())
	if m.SetPokemonGroup("missing", "") {
		t.Error("SetPokemonGroup should return false for unknown Pokémon id")
	}
}

// TestSetPokemonTagsTrimAndDedupe verifies that the tag list is trimmed,
// empty tags are dropped, and duplicates are removed while preserving the
// first-seen order.
func TestSetPokemonTagsTrimAndDedupe(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))

	if !m.SetPokemonTags("p1", []string{"  favorite ", "", "legendary", "favorite", "  "}) {
		t.Fatal("SetPokemonTags returned false")
	}

	got := m.GetState().Pokemon[0].Tags
	want := []string{"favorite", "legendary"}
	if !equalStrings(got, want) {
		t.Errorf("Tags = %v, want %v", got, want)
	}
}

// TestSetPokemonTagsEmptySlice verifies that passing an empty (non-nil)
// slice clears all tags but keeps Tags a non-nil slice.
func TestSetPokemonTagsEmptySlice(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))
	m.SetPokemonTags("p1", []string{"a", "b"})

	if !m.SetPokemonTags("p1", []string{}) {
		t.Fatal("SetPokemonTags with empty slice returned false")
	}
	tags := m.GetState().Pokemon[0].Tags
	if tags == nil {
		t.Fatal("Tags should be non-nil empty slice, got nil")
	}
	if len(tags) != 0 {
		t.Errorf("Tags len = %d, want 0", len(tags))
	}
}

// TestTagsSerializeAsEmptyArray verifies that a freshly added Pokémon
// marshals its Tags field as [] and never as null, since the frontend relies
// on this for filter UI rendering.
func TestTagsSerializeAsEmptyArray(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))

	p := m.GetState().Pokemon[0]
	raw, err := json.Marshal(p)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	if !strings.Contains(string(raw), `"tags":[]`) {
		t.Errorf("expected tags:[] in JSON, got: %s", string(raw))
	}
}

// TestApplyBasicFieldsTagsPatch verifies that UpdatePokemon applies a tag
// update through applyBasicFields and normalises the new tags.
func TestApplyBasicFieldsTagsPatch(t *testing.T) {
	m := NewManager(t.TempDir())
	m.AddPokemon(makePokemon("p1", "Pikachu"))
	m.SetPokemonTags("p1", []string{"one"})

	ok := m.UpdatePokemon("p1", Pokemon{
		Name: "Pikachu",
		Tags: []string{"two", "two", " three "},
	})
	if !ok {
		t.Fatal("UpdatePokemon returned false")
	}
	got := m.GetState().Pokemon[0].Tags
	want := []string{"two", "three"}
	if !equalStrings(got, want) {
		t.Errorf("Tags = %v, want %v", got, want)
	}
}

// TestApplyBasicFieldsGroupIDPatch verifies that UpdatePokemon assigns a
// valid GroupID via the standard update path.
func TestApplyBasicFieldsGroupIDPatch(t *testing.T) {
	m := NewManager(t.TempDir())
	g, _ := m.CreateGroup("G", "")
	m.AddPokemon(makePokemon("p1", "Pikachu"))

	ok := m.UpdatePokemon("p1", Pokemon{
		Name:    "Pikachu",
		GroupID: g.ID,
	})
	if !ok {
		t.Fatal("UpdatePokemon returned false")
	}
	if got := m.GetState().Pokemon[0].GroupID; got != g.ID {
		t.Errorf("GroupID = %q, want %q", got, g.ID)
	}
}

// equalStrings reports whether two string slices contain the same elements in
// the same order.
func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
