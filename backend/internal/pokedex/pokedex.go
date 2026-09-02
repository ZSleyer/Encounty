// Package pokedex loads the Pokédex from the database and provides PokeAPI
// synchronisation. A parsed slice is cached in memory after the first load;
// the cache is invalidated after each sync.
package pokedex

import (
	"encoding/json"
	"log/slog"
	"sync"

	"github.com/zsleyer/encounty/backend/internal/database"
)

// minSpeciesCount is the minimum number of species expected in a valid
// Pokédex. Below this threshold NeedsSync returns true.
const minSpeciesCount = 900

// Entry is one species record in the Pokédex.
// Forms holds alternate forms (regional variants, mega evolutions, etc.)
// that share the same species ID but have distinct canonical names and sprites.
type Entry struct {
	ID            int               `json:"id"`
	Canonical     string            `json:"canonical"`
	Names         map[string]string `json:"names,omitempty"`
	Forms         []Form            `json:"forms,omitempty"`
	GenderRate    int               `json:"gender_rate"`
	EvolvesFromID int               `json:"evolves_from_id,omitempty"`
	Games         []string          `json:"games,omitempty"`
}

// Form represents an alternate form of a Pokémon species.
// SpriteID is the numeric PokéAPI ID used to construct the sprite URL.
// SpriteSlug is the name-based sprite identifier for cosmetic forms that
// have no dedicated pokemon entry in PokéAPI (e.g. "201-b", "666-icy-snow");
// such forms carry SpriteID 0 and a non-empty SpriteSlug instead.
// Generations lists the generation IDs in which this form is available;
// an empty slice means "unknown/unconstrained" and the form is shown for
// any selected game.
// Gender restricts this form to a single gender's appearance: "male" or
// "female". Empty means the form's appearance does not depend on gender.
type Form struct {
	Canonical   string            `json:"canonical"`
	Names       map[string]string `json:"names,omitempty"`
	FormNames   map[string]string `json:"form_names,omitempty"`
	SpriteID    int               `json:"sprite_id"`
	SpriteSlug  string            `json:"sprite_slug,omitempty"`
	Generations []int             `json:"generations,omitempty"`
	Gender      string            `json:"gender,omitempty"`
}

// SyncResult carries aggregated statistics from a PokéAPI sync run.
type SyncResult struct {
	Total        int      `json:"total"`
	Added        int      `json:"added"`
	NamesUpdated int      `json:"namesUpdated"`
	New          []string `json:"new"`
}

// PokedexStore abstracts database operations for the Pokédex.
type PokedexStore interface {
	SavePokedex(species []database.PokedexSpeciesRow, forms []database.PokedexFormRow) error
	LoadPokedex() ([]database.PokedexSpeciesRow, []database.PokedexFormRow, error)
	HasPokedex() bool
	PokedexCount() int
}

var (
	cachedPokedex []Entry
	pokedexMu     sync.Mutex
)

// LoadPokedex returns the full Pokédex. It loads from the database on the
// first call and caches the result. Returns nil when the store is empty or
// unavailable, the caller should trigger a sync via InitAsync.
func LoadPokedex(store PokedexStore) []Entry {
	pokedexMu.Lock()
	defer pokedexMu.Unlock()

	if cachedPokedex != nil {
		return cachedPokedex
	}

	cachedPokedex = loadPokedexFromDB(store)
	return cachedPokedex
}

// InvalidateCache clears the in-memory Pokédex cache so the next call to
// LoadPokedex re-reads from the database.
func InvalidateCache() {
	pokedexMu.Lock()
	cachedPokedex = nil
	pokedexMu.Unlock()
}

// NeedsSync reports whether a full PokeAPI sync is required. This is true
// when the database contains no Pokédex data or fewer than minSpeciesCount
// species.
func NeedsSync(store PokedexStore) bool {
	if store == nil {
		return true
	}
	if !store.HasPokedex() {
		return true
	}
	return store.PokedexCount() < minSpeciesCount
}

// loadPokedexFromDB loads and converts Pokédex data from the database.
// Returns nil when the store is empty or unavailable.
func loadPokedexFromDB(store PokedexStore) []Entry {
	if store == nil || !store.HasPokedex() {
		return nil
	}
	species, forms, err := store.LoadPokedex()
	if err != nil {
		slog.Warn("Could not load Pokédex from DB", "error", err)
		return nil
	}
	if len(species) == 0 {
		return nil
	}
	return RowsToEntries(species, forms)
}

// RowsToEntries converts database species and form rows into the public
// Entry slice used by the API. Forms are attached to their parent species
// by matching SpeciesID to Entry.ID.
func RowsToEntries(species []database.PokedexSpeciesRow, forms []database.PokedexFormRow) []Entry {
	entries := make([]Entry, 0, len(species))
	idxByID := make(map[int]int, len(species))

	for _, s := range species {
		var names map[string]string
		if len(s.NamesJSON) > 0 {
			if err := json.Unmarshal(s.NamesJSON, &names); err != nil {
				slog.Debug("Pokédex: bad species names JSON", "id", s.ID, "error", err)
			}
		}
		idxByID[s.ID] = len(entries)
		entries = append(entries, Entry{
			ID:            s.ID,
			Canonical:     s.Canonical,
			Names:         names,
			GenderRate:    s.GenderRate,
			EvolvesFromID: s.EvolvesFromID,
			Games:         decodeStringSlice(s.GamesJSON),
		})
	}

	for _, f := range forms {
		idx, ok := idxByID[f.SpeciesID]
		if !ok {
			continue
		}
		var names map[string]string
		if len(f.NamesJSON) > 0 {
			if err := json.Unmarshal(f.NamesJSON, &names); err != nil {
				slog.Debug("Pokédex: bad form names JSON", "canonical", f.Canonical, "error", err)
			}
		}
		var formNames map[string]string
		if len(f.FormNamesJSON) > 0 {
			if err := json.Unmarshal(f.FormNamesJSON, &formNames); err != nil {
				slog.Debug("Pokédex: bad form form_names JSON", "canonical", f.Canonical, "error", err)
			}
		}
		var gens []int
		if len(f.GenerationsJSON) > 0 {
			if err := json.Unmarshal(f.GenerationsJSON, &gens); err != nil {
				slog.Debug("Pokédex: bad form generations JSON", "canonical", f.Canonical, "error", err)
			}
		}
		entries[idx].Forms = append(entries[idx].Forms, Form{
			Canonical:   f.Canonical,
			SpriteID:    f.SpriteID,
			SpriteSlug:  f.SpriteSlug,
			Names:       names,
			FormNames:   formNames,
			Generations: gens,
			Gender:      f.Gender,
		})
	}

	return entries
}

// EntriesToRows converts the public Entry slice back into database row types
// suitable for SavePokedex.
func EntriesToRows(entries []Entry) ([]database.PokedexSpeciesRow, []database.PokedexFormRow) {
	species := make([]database.PokedexSpeciesRow, 0, len(entries))
	var forms []database.PokedexFormRow

	for _, e := range entries {
		namesJSON, err := json.Marshal(e.Names)
		if err != nil {
			namesJSON = []byte("{}")
		}
		species = append(species, database.PokedexSpeciesRow{
			ID:            e.ID,
			Canonical:     e.Canonical,
			NamesJSON:     namesJSON,
			GenderRate:    e.GenderRate,
			EvolvesFromID: e.EvolvesFromID,
			GamesJSON:     jsonSlice(e.Games),
		})
		for _, f := range e.Forms {
			fNamesJSON, fErr := json.Marshal(f.Names)
			if fErr != nil || f.Names == nil {
				fNamesJSON = []byte("{}")
			}
			fFormNamesJSON, fnErr := json.Marshal(f.FormNames)
			if fnErr != nil || f.FormNames == nil {
				fFormNamesJSON = []byte("{}")
			}
			gensSrc := f.Generations
			if gensSrc == nil {
				gensSrc = []int{}
			}
			fGensJSON, gErr := json.Marshal(gensSrc)
			if gErr != nil {
				fGensJSON = []byte("[]")
			}
			forms = append(forms, database.PokedexFormRow{
				SpeciesID:       e.ID,
				Canonical:       f.Canonical,
				SpriteID:        f.SpriteID,
				SpriteSlug:      f.SpriteSlug,
				NamesJSON:       fNamesJSON,
				FormNamesJSON:   fFormNamesJSON,
				GenerationsJSON: fGensJSON,
				Gender:          f.Gender,
			})
		}
	}

	return species, forms
}

func decodeStringSlice(raw []byte) []string {
	var values []string
	_ = json.Unmarshal(raw, &values)
	return values
}

func jsonSlice(value []string) []byte {
	if value == nil {
		value = []string{}
	}
	b, _ := json.Marshal(value)
	return b
}
