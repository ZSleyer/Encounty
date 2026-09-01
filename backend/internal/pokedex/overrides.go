// overrides.go implements manual Pokédex caught/seen overrides: user-entered
// flags that mark a species, form, gender, and/or game combination as caught
// or seen, independent of what encounter tracking already implies. An
// override may optionally carry the same catch metadata recorded for a real
// hunt (location, ball, level, nature, ability, mark, individual values,
// ribbons).
package pokedex

import (
	"encoding/json"

	"github.com/zsleyer/encounty/backend/internal/database"
	"github.com/zsleyer/encounty/backend/internal/state"
)

// emptyMetaJSON is the JSON encoding of "no metadata recorded", stored in
// pokedex_overrides.meta_json for an override that carries no catch details.
const emptyMetaJSON = "{}"

// Override is one manual Pokédex caught/seen override as exposed over the
// API. FormCanonical empty means the override applies at the species level
// (no form restriction); Gender empty means it is not gender-restricted;
// Game empty means it is global (counts everywhere, both national and every
// game view). Meta is nil when no catch metadata was recorded for the
// override.
type Override struct {
	ID            int64            `json:"id"`
	PokedexID     string           `json:"pokedex_id"`
	SpeciesID     int              `json:"species_id"`
	FormCanonical string           `json:"form_canonical,omitempty"`
	Gender        string           `json:"gender,omitempty"`
	Game          string           `json:"game,omitempty"`
	Caught        bool             `json:"caught"`
	Seen          bool             `json:"seen"`
	Meta          *state.CatchMeta `json:"meta,omitempty"`
	UpdatedAt     string           `json:"updated_at"`
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

// SetOverrideForPokedex writes a manual caught/seen override for one species
// in one Pokédex. It reports the stored override and whether a row was
// actually written.
func SetOverrideForPokedex(store OverrideStore, pokedexID string, id int64, speciesID int, formCanonical, gender, game string, caught, seen bool, meta *state.CatchMeta) (Override, bool, error) {
	metaJSON, err := resolveMetaJSON(store, pokedexID, id, speciesID, formCanonical, gender, game, caught, seen, meta)
	if err != nil {
		return Override{}, false, err
	}
	row, deleted, err := store.UpsertPokedexOverride(database.PokedexOverrideRow{
		ID:            id,
		PokedexID:     pokedexID,
		SpeciesID:     speciesID,
		FormCanonical: formCanonical,
		Gender:        gender,
		Game:          game,
		Caught:        caught,
		Seen:          seen,
		MetaJSON:      metaJSON,
	})
	if err != nil {
		return Override{}, false, err
	}
	if deleted {
		return Override{}, true, nil
	}
	return rowToOverride(row), false, nil
}

// resolveMetaJSON computes the meta_json value SetOverride should persist. A
// deleting request (both caught and seen false) never needs metadata, so it
// short-circuits without touching the store. A non-nil meta is marshaled
// directly, overwriting whatever was stored before. A nil meta means the
// request omitted metadata, so the previously stored value for this override
// key is looked up and carried forward unchanged; an override that does not
// exist yet has nothing to preserve and starts at emptyMetaJSON.
func resolveMetaJSON(store OverrideStore, pokedexID string, id int64, speciesID int, formCanonical, gender, game string, caught, seen bool, meta *state.CatchMeta) (string, error) {
	if !caught && !seen {
		return "", nil
	}
	if meta != nil {
		return marshalMeta(meta), nil
	}
	rows, err := store.ListPokedexOverrides()
	if err != nil {
		return "", err
	}
	for _, r := range rows {
		if r.PokedexID == pokedexID && ((id != 0 && r.ID == id) || (id == 0 && r.SpeciesID == speciesID && r.FormCanonical == formCanonical && r.Gender == gender && r.Game == game)) {
			return r.MetaJSON, nil
		}
	}
	return emptyMetaJSON, nil
}

// marshalMeta encodes catch metadata into the string stored in
// pokedex_overrides.meta_json, using emptyMetaJSON for "nothing recorded". A
// value that cannot be encoded is dropped rather than failing the request.
func marshalMeta(meta *state.CatchMeta) string {
	if meta.IsEmpty() {
		return emptyMetaJSON
	}
	raw, err := json.Marshal(meta)
	if err != nil {
		return emptyMetaJSON
	}
	return string(raw)
}

// unmarshalMeta decodes the JSON blob stored in pokedex_overrides.meta_json.
// An empty or "{}" column, an unreadable one, or one that decodes to an
// all-empty CatchMeta all mean "nothing recorded" and return nil, mirroring
// how pokemon.catch_meta is handled for real catches.
func unmarshalMeta(raw string) *state.CatchMeta {
	if raw == "" || raw == emptyMetaJSON {
		return nil
	}
	var meta state.CatchMeta
	if err := json.Unmarshal([]byte(raw), &meta); err != nil {
		return nil
	}
	if meta.Ribbons == nil {
		meta.Ribbons = []string{}
	}
	if meta.IsEmpty() {
		return nil
	}
	return &meta
}

// rowToOverride converts a database row into the public Override type.
func rowToOverride(r database.PokedexOverrideRow) Override {
	if r.PokedexID == "" {
		r.PokedexID = "default"
	}
	return Override{
		ID:            r.ID,
		PokedexID:     r.PokedexID,
		SpeciesID:     r.SpeciesID,
		FormCanonical: r.FormCanonical,
		Gender:        r.Gender,
		Game:          r.Game,
		Caught:        r.Caught,
		Seen:          r.Seen,
		Meta:          unmarshalMeta(r.MetaJSON),
		UpdatedAt:     r.UpdatedAt,
	}
}
