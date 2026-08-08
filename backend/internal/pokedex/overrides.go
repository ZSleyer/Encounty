// overrides.go implements manual Pokédex caught/seen overrides: user-entered
// flags that mark a species, form, gender, and/or game combination as caught
// or seen, independent of what encounter tracking already implies.
package pokedex

import (
	"github.com/zsleyer/encounty/backend/internal/database"
)

// Override is one manual Pokédex caught/seen override as exposed over the
// API. FormCanonical empty means the override applies at the species level
// (no form restriction); Gender empty means it is not gender-restricted;
// Game empty means it is global (counts everywhere, both national and every
// game view).
type Override struct {
	ID            int64  `json:"id"`
	SpeciesID     int    `json:"species_id"`
	FormCanonical string `json:"form_canonical,omitempty"`
	Gender        string `json:"gender,omitempty"`
	Game          string `json:"game,omitempty"`
	Caught        bool   `json:"caught"`
	Seen          bool   `json:"seen"`
	UpdatedAt     string `json:"updated_at"`
}

// OverrideStore abstracts database operations for manual Pokédex overrides.
// Method names match *database.DB exactly so it satisfies this interface
// automatically, mirroring PokedexStore above.
type OverrideStore interface {
	ListPokedexOverrides() ([]database.PokedexOverrideRow, error)
	UpsertPokedexOverride(row database.PokedexOverrideRow) (database.PokedexOverrideRow, bool, error)
}

// ListOverrides returns all manual Pokédex caught/seen overrides.
func ListOverrides(store OverrideStore) ([]Override, error) {
	rows, err := store.ListPokedexOverrides()
	if err != nil {
		return nil, err
	}
	overrides := make([]Override, 0, len(rows))
	for _, r := range rows {
		overrides = append(overrides, rowToOverride(r))
	}
	return overrides, nil
}

// SetOverride creates, updates, or deletes the manual override identified by
// (speciesID, formCanonical, gender, game). When both caught and seen are
// false the matching row is deleted instead of being stored with all-false
// flags; the second return value reports whether a deletion happened, in
// which case the returned Override is the zero value and should not be used.
func SetOverride(store OverrideStore, speciesID int, formCanonical, gender, game string, caught, seen bool) (Override, bool, error) {
	row, deleted, err := store.UpsertPokedexOverride(database.PokedexOverrideRow{
		SpeciesID:     speciesID,
		FormCanonical: formCanonical,
		Gender:        gender,
		Game:          game,
		Caught:        caught,
		Seen:          seen,
	})
	if err != nil {
		return Override{}, false, err
	}
	if deleted {
		return Override{}, true, nil
	}
	return rowToOverride(row), false, nil
}

// rowToOverride converts a database row into the public Override type.
func rowToOverride(r database.PokedexOverrideRow) Override {
	return Override{
		ID:            r.ID,
		SpeciesID:     r.SpeciesID,
		FormCanonical: r.FormCanonical,
		Gender:        r.Gender,
		Game:          r.Game,
		Caught:        r.Caught,
		Seen:          r.Seen,
		UpdatedAt:     r.UpdatedAt,
	}
}
