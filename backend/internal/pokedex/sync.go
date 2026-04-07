// sync.go fetches species, forms, and localized names from PokéAPI and merges
// them into an existing Pokédex slice.
package pokedex

import (
	"fmt"
	"log/slog"
	"strconv"
	"strings"

	"github.com/zsleyer/encounty/backend/internal/httputil"
)

const (
	// pokeAPIGraphQL is the PokéAPI GraphQL v1beta2 endpoint.
	pokeAPIGraphQL = "https://graphql.pokeapi.co/v1beta2"

	// langJaHrkt is the PokéAPI language code for Japanese Katakana.
	langJaHrkt = "ja-Hrkt"
)

// pokeAPILangMap maps PokéAPI language codes to the shorter keys used in
// the local Pokédex Names maps. It is shared by species and form translation
// helpers.
var pokeAPILangMap = map[string]string{
	langJaHrkt: "ja",
	"ja":       "ja",
	"ko":       "ko",
	"zh-Hant":  "zh-hant",
	"zh-Hans":  "zh-hans",
	"fr":       "fr",
	"de":       "de",
	"es":       "es",
	"it":       "it",
	"en":       "en",
}

// ProgressFn reports sync progress. step describes the current phase
// (e.g. "species", "forms", "names", "form_names") and detail provides
// optional extra information.
type ProgressFn func(step string, detail string)

// SyncFromPokeAPI downloads the latest species, forms, and localized names
// from PokéAPI and merges them into the given current slice. It returns
// sync statistics and the updated slice. When progress is non-nil it is
// called at the start of each phase.
func SyncFromPokeAPI(current []Entry, progress ProgressFn) (SyncResult, []Entry, error) {
	// Build index of existing canonical names.
	existing := make(map[string]bool, len(current))
	for _, e := range current {
		existing[e.Canonical] = true
	}

	// Fetch and merge new base species from the REST API.
	callProgress(progress, "species", "")
	added, err := fetchAndMergeNewSpecies(&current, existing)
	if err != nil {
		return SyncResult{}, nil, err
	}

	// Fetch and merge alternate forms via GraphQL.
	callProgress(progress, "forms", "")
	formAdded, err := fetchAndMergeForms(&current)
	if err != nil {
		slog.Warn("Pokédex sync: forms fetch failed, continuing", "error", err)
	} else {
		added = append(added, formAdded...)
	}

	// Fetch and apply localized species names via GraphQL.
	callProgress(progress, "names", "")
	namesUpdated, err := fetchAndApplySpeciesNames(&current)
	if err != nil {
		slog.Warn("Pokédex sync: species names fetch failed, continuing", "error", err)
	}

	// Fetch and apply localized form names via GraphQL.
	callProgress(progress, "form_names", "")
	formNamesUpdated, err := fetchAndApplyFormNames(&current)
	if err != nil {
		slog.Warn("Pokédex sync: form names fetch failed, continuing", "error", err)
	} else {
		namesUpdated += formNamesUpdated
	}

	result := SyncResult{
		Total:        len(current),
		Added:        len(added),
		NamesUpdated: namesUpdated,
		New:          added,
	}
	return result, current, nil
}

// callProgress invokes the progress callback if it is non-nil.
func callProgress(fn ProgressFn, step, detail string) {
	if fn != nil {
		fn(step, detail)
	}
}

// fetchAndMergeNewSpecies fetches the full Pokémon list from PokéAPI's REST
// endpoint and appends any base-species entries (IDs 1–2000) that are not
// already present in current. It returns the canonical names that were added.
func fetchAndMergeNewSpecies(current *[]Entry, existing map[string]bool) ([]string, error) {
	type pokeAPIEntry struct {
		Name string `json:"name"`
		URL  string `json:"url"`
	}
	type pokeAPIList struct {
		Count   int            `json:"count"`
		Results []pokeAPIEntry `json:"results"`
	}

	var apiList pokeAPIList
	if err := httputil.GetJSON("https://pokeapi.co/api/v2/pokemon?limit=10000", &apiList); err != nil {
		return nil, fmt.Errorf("PokeAPI unavailable: %w", err)
	}

	var added []string
	for _, entry := range apiList.Results {
		if existing[entry.Name] {
			continue
		}
		id := extractPokeAPIID(entry.URL)
		if id <= 0 || id > 2000 {
			continue // skip forms and invalid entries
		}
		*current = append(*current, Entry{
			ID:        id,
			Canonical: entry.Name,
		})
		added = append(added, entry.Name)
		existing[entry.Name] = true
	}
	return added, nil
}

// extractPokeAPIID extracts the numeric ID from a PokéAPI resource URL
// such as "https://pokeapi.co/api/v2/pokemon/25/".
func extractPokeAPIID(url string) int {
	parts := strings.Split(strings.TrimSuffix(url, "/"), "/")
	if len(parts) == 0 {
		return 0
	}
	id, _ := strconv.Atoi(parts[len(parts)-1])
	return id
}

// formGenRow is one entry from pokemonformgenerations: a generation ID
// that the parent pokemonform is available in.
type formGenRow struct {
	GenerationID int `json:"generation_id"`
}

// formVGRow holds the versiongroup of a pokemonform, used as a fallback
// for forms that have no pokemonformgenerations entries.
type formVGRow struct {
	GenerationID int `json:"generation_id"`
}

// pokemonFormRow is a single pokemonform record returned by the GraphQL
// query in fetchAndMergeForms. Each variant pokemon may have one or more
// such forms.
type pokemonFormRow struct {
	VersionGroup           formVGRow    `json:"versiongroup"`
	PokemonFormGenerations []formGenRow `json:"pokemonformgenerations"`
}

// fetchAndMergeForms fetches alternate Pokémon forms (ID > 10000) from the
// PokéAPI GraphQL endpoint and appends new forms to the matching species in
// current. Existing forms have their generations list refreshed so older
// installations pick up the newly added field. Returns canonical names of
// newly added forms.
func fetchAndMergeForms(current *[]Entry) ([]string, error) {
	q := `{"query":"query{pokemon(where:{id:{_gt:10000}}){id name pokemon_species_id pokemonforms{versiongroup{generation_id} pokemonformgenerations{generation_id}}}}"}`

	var glForms struct {
		Data struct {
			Pokemon []struct {
				ID           int              `json:"id"`
				Name         string           `json:"name"`
				SpeciesID    int              `json:"pokemon_species_id"`
				PokemonForms []pokemonFormRow `json:"pokemonforms"`
			} `json:"pokemon"`
		} `json:"data"`
	}
	if err := httputil.PostJSON(pokeAPIGraphQL, strings.NewReader(q), &glForms); err != nil {
		return nil, fmt.Errorf("fetch forms: %w", err)
	}

	specIndex := make(map[int]int, len(*current))
	for i := range *current {
		specIndex[(*current)[i].ID] = i
	}

	var added []string
	for _, f := range glForms.Data.Pokemon {
		i, ok := specIndex[f.SpeciesID]
		if !ok {
			continue
		}
		gens := collectFormGenerations(f.PokemonForms)
		existingIdx := -1
		for j, existingForm := range (*current)[i].Forms {
			if existingForm.Canonical == f.Name {
				existingIdx = j
				break
			}
		}
		if existingIdx >= 0 {
			(*current)[i].Forms[existingIdx].Generations = gens
			(*current)[i].Forms[existingIdx].SpriteID = f.ID
			continue
		}
		(*current)[i].Forms = append((*current)[i].Forms, Form{
			Canonical:   f.Name,
			SpriteID:    f.ID,
			Generations: gens,
		})
		added = append(added, f.Name)
	}
	return added, nil
}

// collectFormGenerations extracts the unique sorted list of generation IDs
// in which a form is available. It prefers the per-form generation table
// (pokemonformgenerations); when that is empty it falls back to the version
// group's introduction generation, ensuring every form carries at least one
// generation hint.
func collectFormGenerations(forms []pokemonFormRow) []int {
	seen := make(map[int]bool)
	for _, pf := range forms {
		for _, g := range pf.PokemonFormGenerations {
			if g.GenerationID > 0 {
				seen[g.GenerationID] = true
			}
		}
	}
	if len(seen) == 0 {
		for _, pf := range forms {
			if pf.VersionGroup.GenerationID > 0 {
				seen[pf.VersionGroup.GenerationID] = true
			}
		}
	}
	if len(seen) == 0 {
		return nil
	}
	out := make([]int, 0, len(seen))
	for g := range seen {
		out = append(out, g)
	}
	// Insertion sort — list is tiny (≤10).
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j-1] > out[j]; j-- {
			out[j-1], out[j] = out[j], out[j-1]
		}
	}
	return out
}

// fetchAndApplySpeciesNames fetches localized species names from the PokéAPI
// GraphQL endpoint and applies them to the entries in current. It returns the
// number of individual name values that changed.
func fetchAndApplySpeciesNames(current *[]Entry) (int, error) {
	q := `{"query":"query{pokemonspeciesname(where:{language:{name:{_in:[\"ja-Hrkt\",\"ko\",\"zh-Hant\",\"fr\",\"de\",\"es\",\"it\",\"en\",\"ja\",\"zh-Hans\"]}}}){name pokemon_species_id language{name}}}"}`

	var glResp struct {
		Data struct {
			Names []speciesNameRow `json:"pokemonspeciesname"`
		} `json:"data"`
	}
	if err := httputil.PostJSON(pokeAPIGraphQL, strings.NewReader(q), &glResp); err != nil {
		return 0, fmt.Errorf("fetch species names: %w", err)
	}

	namesMap := buildSpeciesTranslationMap(glResp.Data.Names)

	// Apply translations to the loaded array.
	var namesUpdated int
	for i := range *current {
		fetchedNames, ok := namesMap[(*current)[i].ID]
		if !ok {
			continue
		}
		if (*current)[i].Names == nil {
			(*current)[i].Names = make(map[string]string)
		}
		for l, n := range fetchedNames {
			if (*current)[i].Names[l] != n {
				namesUpdated++
			}
			(*current)[i].Names[l] = n
		}
	}
	return namesUpdated, nil
}

// speciesNameRow is a single row from the PokéAPI species-name GraphQL query.
type speciesNameRow struct {
	Name      string `json:"name"`
	SpeciesID int    `json:"pokemon_species_id"`
	Language  struct {
		Name string `json:"name"`
	} `json:"language"`
}

// buildSpeciesTranslationMap converts raw species-name rows into a
// map[speciesID]map[langKey]localizedName, applying language code
// normalization and the Kanji-over-Katakana preference for Japanese.
func buildSpeciesTranslationMap(rows []speciesNameRow) map[int]map[string]string {
	namesMap := make(map[int]map[string]string)
	for _, n := range rows {
		l, ok := pokeAPILangMap[n.Language.Name]
		if !ok || n.Name == "" {
			continue
		}
		if namesMap[n.SpeciesID] == nil {
			namesMap[n.SpeciesID] = make(map[string]string)
		}
		if shouldSkipJaKatakana(l, n.Language.Name, namesMap[n.SpeciesID]) {
			continue
		}
		namesMap[n.SpeciesID][l] = n.Name
	}
	return namesMap
}

// shouldSkipJaKatakana returns true when a Katakana "ja-Hrkt" entry should
// be skipped because a Kanji "ja" translation already exists.
func shouldSkipJaKatakana(langKey, apiLang string, existing map[string]string) bool {
	return langKey == "ja" && apiLang == langJaHrkt && existing["ja"] != ""
}

// fetchAndApplyFormNames fetches localized form names from the PokéAPI GraphQL
// endpoint and applies them to the form entries in current. It returns the
// number of individual name values that changed.
func fetchAndApplyFormNames(current *[]Entry) (int, error) {
	q := `{"query":"query{pokemonformname(where:{language:{name:{_in:[\"ja-Hrkt\",\"ko\",\"zh-Hant\",\"fr\",\"de\",\"es\",\"it\",\"en\",\"ja\",\"zh-Hans\"]}}}){pokemonform{name} language{name} pokemon_name name}}"}`

	var glResp struct {
		Data struct {
			Names []formNameRow `json:"pokemonformname"`
		} `json:"data"`
	}
	if err := httputil.PostJSON(pokeAPIGraphQL, strings.NewReader(q), &glResp); err != nil {
		return 0, fmt.Errorf("fetch form names: %w", err)
	}

	formNamesMap := buildFormTranslationMap(glResp.Data.Names)
	return applyFormTranslations(current, formNamesMap), nil
}

// applyFormTranslations merges the fetched form name translations into the
// current entries, returning the number of individual name values that changed.
func applyFormTranslations(current *[]Entry, formNamesMap map[string]map[string]string) int {
	var namesUpdated int
	for i := range *current {
		for j := range (*current)[i].Forms {
			names, ok := formNamesMap[(*current)[i].Forms[j].Canonical]
			if !ok {
				continue
			}
			namesUpdated += mergeFormNames(&(*current)[i].Forms[j], names)
		}
	}
	return namesUpdated
}

// mergeFormNames copies all entries from names into the form's Names map,
// initializing it if nil. Returns the number of values that actually changed.
func mergeFormNames(form *Form, names map[string]string) int {
	var changed int
	if form.Names == nil {
		form.Names = make(map[string]string)
	}
	for lang, val := range names {
		if form.Names[lang] != val {
			changed++
		}
		form.Names[lang] = val
	}
	return changed
}

// formNameRow is a single row from the PokéAPI form-name GraphQL query.
type formNameRow struct {
	Form struct {
		Name string `json:"name"`
	} `json:"pokemonform"`
	Language struct {
		Name string `json:"name"`
	} `json:"language"`
	PokemonName string `json:"pokemon_name"`
	Name        string `json:"name"`
}

// buildFormTranslationMap converts raw form-name rows into a
// map[formCanonical]map[langKey]localizedName, applying language code
// normalization and the Kanji-over-Katakana preference for Japanese.
func buildFormTranslationMap(rows []formNameRow) map[string]map[string]string {
	formNamesMap := make(map[string]map[string]string)
	for _, n := range rows {
		l, ok := pokeAPILangMap[n.Language.Name]
		formNameKey := n.Form.Name
		if !ok || formNameKey == "" {
			continue
		}

		// Either pokemon_name or name contains the fully qualified localized
		// string for the form in most cases (e.g. pokemon_name: "Alolan Sandshrew").
		// Fall back on just name ("Alolan Form") if pokemon_name is empty.
		val := n.PokemonName
		if val == "" {
			val = n.Name
		}
		if val == "" {
			continue
		}

		if formNamesMap[formNameKey] == nil {
			formNamesMap[formNameKey] = make(map[string]string)
		}
		if shouldSkipJaKatakana(l, n.Language.Name, formNamesMap[formNameKey]) {
			continue
		}
		formNamesMap[formNameKey][l] = val
	}
	return formNamesMap
}
