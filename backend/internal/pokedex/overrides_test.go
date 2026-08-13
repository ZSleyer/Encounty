// overrides_test.go tests manual Pokédex caught/seen overrides, including the
// optional catch metadata carried alongside them.
package pokedex

import (
	"testing"

	"github.com/zsleyer/encounty/backend/internal/database"
	"github.com/zsleyer/encounty/backend/internal/state"
)

// mockOverrideStore is an in-memory OverrideStore for testing, mirroring the
// upsert/delete/conflict semantics of *database.DB.
type mockOverrideStore struct {
	rows   []database.PokedexOverrideRow
	nextID int64
	err    error
}

func (m *mockOverrideStore) ListPokedexOverrides() ([]database.PokedexOverrideRow, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.rows, nil
}

func (m *mockOverrideStore) UpsertPokedexOverride(row database.PokedexOverrideRow) (database.PokedexOverrideRow, bool, error) {
	if m.err != nil {
		return database.PokedexOverrideRow{}, false, m.err
	}
	if !row.Caught && !row.Seen {
		out := m.rows[:0]
		for _, r := range m.rows {
			if r.SpeciesID == row.SpeciesID && r.FormCanonical == row.FormCanonical &&
				r.Gender == row.Gender && r.Game == row.Game {
				continue
			}
			out = append(out, r)
		}
		m.rows = out
		return database.PokedexOverrideRow{}, true, nil
	}
	for i, r := range m.rows {
		if r.SpeciesID == row.SpeciesID && r.FormCanonical == row.FormCanonical &&
			r.Gender == row.Gender && r.Game == row.Game {
			m.rows[i].Caught = row.Caught
			m.rows[i].Seen = row.Seen
			m.rows[i].MetaJSON = row.MetaJSON
			m.rows[i].UpdatedAt = "updated"
			return m.rows[i], false, nil
		}
	}
	m.nextID++
	row.ID = m.nextID
	row.CreatedAt = "created"
	row.UpdatedAt = "created"
	m.rows = append(m.rows, row)
	return row, false, nil
}

// intPtr returns a pointer to v, for building *state.CatchMeta literals.
func intPtr(v int) *int { return &v }

// --- SetOverride: metadata ------------------------------------------------------

// TestSetOverrideWithMetaStoresIt verifies that a non-nil meta is validated,
// marshaled, and reflected on the returned Override.
func TestSetOverrideWithMetaStoresIt(t *testing.T) {
	store := &mockOverrideStore{}
	meta := &state.CatchMeta{Location: "Route 1", Level: intPtr(5), Ribbons: []string{"champion"}}

	got, deleted, err := SetOverride(store, 0, 25, "", "", "", true, true, meta)
	if err != nil {
		t.Fatalf("SetOverride: %v", err)
	}
	if deleted {
		t.Fatal("deleted = true, want false")
	}
	if got.Meta == nil {
		t.Fatal("Meta = nil, want the stored metadata")
	}
	if got.Meta.Location != "Route 1" || got.Meta.Level == nil || *got.Meta.Level != 5 {
		t.Errorf("Meta = %+v, want Location=Route 1 Level=5", got.Meta)
	}
	if len(store.rows) != 1 || store.rows[0].MetaJSON == "" || store.rows[0].MetaJSON == emptyMetaJSON {
		t.Errorf("stored MetaJSON = %q, want a non-empty encoded blob", store.rows[0].MetaJSON)
	}
}

// TestSetOverrideNilMetaOnFreshRowDefaultsEmpty verifies that a first-time
// override created without mentioning meta at all starts with no metadata,
// since there is nothing previously stored to preserve.
func TestSetOverrideNilMetaOnFreshRowDefaultsEmpty(t *testing.T) {
	store := &mockOverrideStore{}

	got, _, err := SetOverride(store, 0, 1, "", "", "", true, false, nil)
	if err != nil {
		t.Fatalf("SetOverride: %v", err)
	}
	if got.Meta != nil {
		t.Errorf("Meta = %+v, want nil for a fresh override with no meta", got.Meta)
	}
	if store.rows[0].MetaJSON != emptyMetaJSON {
		t.Errorf("stored MetaJSON = %q, want %q", store.rows[0].MetaJSON, emptyMetaJSON)
	}
}

// TestSetOverrideNilMetaPreservesExisting verifies the toggle-only PUT
// semantics: calling SetOverride with meta=nil (i.e. the request omitted the
// "meta" key) after metadata was already stored must not wipe it, only
// caught/seen change.
func TestSetOverrideNilMetaPreservesExisting(t *testing.T) {
	store := &mockOverrideStore{}
	meta := &state.CatchMeta{Location: "Route 1"}

	if _, _, err := SetOverride(store, 0, 1, "", "", "", true, false, meta); err != nil {
		t.Fatalf("initial SetOverride: %v", err)
	}

	got, deleted, err := SetOverride(store, 0, 1, "", "", "", true, true, nil)
	if err != nil {
		t.Fatalf("toggle-only SetOverride: %v", err)
	}
	if deleted {
		t.Fatal("deleted = true, want false")
	}
	if !got.Seen {
		t.Error("Seen = false, want true after the toggle")
	}
	if got.Meta == nil || got.Meta.Location != "Route 1" {
		t.Errorf("Meta = %+v, want the previously stored Location=Route 1 preserved", got.Meta)
	}
}

// TestSetOverrideExplicitEmptyMetaClears verifies that an explicit, non-nil
// but all-empty *state.CatchMeta{} (what "meta": {} decodes to) clears
// previously stored metadata, distinguishing it from an omitted "meta" key.
func TestSetOverrideExplicitEmptyMetaClears(t *testing.T) {
	store := &mockOverrideStore{}
	meta := &state.CatchMeta{Location: "Route 1"}

	if _, _, err := SetOverride(store, 0, 1, "", "", "", true, false, meta); err != nil {
		t.Fatalf("initial SetOverride: %v", err)
	}

	got, _, err := SetOverride(store, 0, 1, "", "", "", true, false, &state.CatchMeta{})
	if err != nil {
		t.Fatalf("clearing SetOverride: %v", err)
	}
	if got.Meta != nil {
		t.Errorf("Meta = %+v, want nil after an explicit empty meta", got.Meta)
	}
	if store.rows[0].MetaJSON != emptyMetaJSON {
		t.Errorf("stored MetaJSON = %q, want %q after clearing", store.rows[0].MetaJSON, emptyMetaJSON)
	}
}

// TestSetOverrideDeletePathSkipsMetaLookup verifies that a request deleting
// the override (both caught and seen false) does not need to resolve
// metadata: it must not fail even when the store's ListPokedexOverrides
// would error, since a delete never consults it.
func TestSetOverrideDeletePathSkipsMetaLookup(t *testing.T) {
	store := &mockOverrideStore{rows: []database.PokedexOverrideRow{
		{SpeciesID: 1, Caught: true, MetaJSON: `{"location":"Route 1"}`},
	}}

	_, deleted, err := SetOverride(store, 0, 1, "", "", "", false, false, nil)
	if err != nil {
		t.Fatalf("SetOverride: %v", err)
	}
	if !deleted {
		t.Fatal("deleted = false, want true")
	}
}

// --- ListOverrides: metadata decoding --------------------------------------------

// TestListOverridesDecodesMeta verifies that ListOverrides decodes a stored
// meta_json blob into the Meta field.
func TestListOverridesDecodesMeta(t *testing.T) {
	store := &mockOverrideStore{rows: []database.PokedexOverrideRow{
		{ID: 1, SpeciesID: 25, Caught: true, MetaJSON: `{"location":"Route 1","ribbons":["champion"]}`},
	}}

	got, err := ListOverrides(store)
	if err != nil {
		t.Fatalf("ListOverrides: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("len(got) = %d, want 1", len(got))
	}
	if got[0].Meta == nil || got[0].Meta.Location != "Route 1" {
		t.Errorf("Meta = %+v, want Location=Route 1", got[0].Meta)
	}
	if len(got[0].Meta.Ribbons) != 1 || got[0].Meta.Ribbons[0] != "champion" {
		t.Errorf("Meta.Ribbons = %v, want [champion]", got[0].Meta.Ribbons)
	}
}

// TestListOverridesEmptyOrUnreadableMetaIsNil verifies that "", "{}", and
// unparseable meta_json all decode to a nil Meta, mirroring how
// pokemon.catch_meta treats an empty or unreadable blob.
func TestListOverridesEmptyOrUnreadableMetaIsNil(t *testing.T) {
	store := &mockOverrideStore{rows: []database.PokedexOverrideRow{
		{ID: 1, SpeciesID: 1, Caught: true, MetaJSON: ""},
		{ID: 2, SpeciesID: 2, Caught: true, MetaJSON: "{}"},
		{ID: 3, SpeciesID: 3, Caught: true, MetaJSON: "not json"},
		{ID: 4, SpeciesID: 4, Caught: true, MetaJSON: `{"nature":""}`},
	}}

	got, err := ListOverrides(store)
	if err != nil {
		t.Fatalf("ListOverrides: %v", err)
	}
	for _, o := range got {
		if o.Meta != nil {
			t.Errorf("species %d: Meta = %+v, want nil", o.SpeciesID, o.Meta)
		}
	}
}
