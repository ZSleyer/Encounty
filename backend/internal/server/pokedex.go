// pokedex.go serves pokemon.json (the Pokédex) and handles on-demand syncs
// from PokéAPI. The JSON file is read from the config dir if present, falling
// back to the source tree or the embedded frontend dist in production builds.
package server

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

// PokedexEntry is one species record in pokemon.json.
// Forms holds alternate forms (regional variants, mega evolutions, etc.)
// that share the same species ID but have distinct canonical names and sprites.
type PokedexEntry struct {
	ID        int               `json:"id"`
	Canonical string            `json:"canonical"`
	Names     map[string]string `json:"names,omitempty"`
	Forms     []PokemonForm     `json:"forms,omitempty"`
}

// PokemonForm represents an alternate form of a Pokémon species.
// SpriteID is the numeric PokéAPI ID used to construct the sprite URL.
type PokemonForm struct {
	Canonical string            `json:"canonical"`
	Names     map[string]string `json:"names,omitempty"`
	SpriteID  int               `json:"sprite_id"`
}

// handleGetPokedex serves the pokemon list (configDir first, then embedded, then source).
func (s *Server) handleGetPokedex(w http.ResponseWriter, _ *http.Request) {
	data, err := s.readPokedexJSON()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp{"could not load pokedex: " + err.Error()})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	_, _ = w.Write(data)
}

// handleSyncPokemon downloads the latest pokemon list from PokeAPI and saves it to configDir.
func (s *Server) handleSyncPokemon(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	// Load current pokedex
	currentData, err := s.readPokedexJSON()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp{"could not load current pokedex: " + err.Error()})
		return
	}

	var current []PokedexEntry
	if err := json.Unmarshal(currentData, &current); err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp{"could not parse current pokedex: " + err.Error()})
		return
	}

	// Build index of existing canonical names
	existing := make(map[string]bool, len(current))
	for _, e := range current {
		existing[e.Canonical] = true
	}

	// Fetch from PokeAPI
	type pokeAPIEntry struct {
		Name string `json:"name"`
		URL  string `json:"url"`
	}
	type pokeAPIList struct {
		Count   int            `json:"count"`
		Results []pokeAPIEntry `json:"results"`
	}

	resp, err := http.Get("https://pokeapi.co/api/v2/pokemon?limit=10000") //nolint:noctx
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, errResp{"PokeAPI unavailable: " + err.Error()})
		return
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp{"failed to read response: " + err.Error()})
		return
	}

	var apiList pokeAPIList
	if err := json.Unmarshal(body, &apiList); err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp{"failed to parse PokeAPI response: " + err.Error()})
		return
	}

	// Extract numeric ID from PokeAPI URL like ".../pokemon/1/"
	extractID := func(url string) int {
		parts := strings.Split(strings.TrimSuffix(url, "/"), "/")
		if len(parts) == 0 {
			return 0
		}
		id, _ := strconv.Atoi(parts[len(parts)-1])
		return id
	}

	// Find new base-species Pokémon (IDs 1–2000; forms have IDs > 10000)
	var added []string
	for _, entry := range apiList.Results {
		if existing[entry.Name] {
			continue
		}
		id := extractID(entry.URL)
		if id <= 0 || id > 2000 {
			continue // skip forms and invalid entries
		}
		current = append(current, PokedexEntry{
			ID:        id,
			Canonical: entry.Name,
		})
		added = append(added, entry.Name)
		existing[entry.Name] = true
	}

	// Fetch all form data (id > 10000)
	qNewForms := `{"query":"query{pokemon_v2_pokemon(where:{id:{_gt:10000}}){id name pokemon_species_id}}"}`
	respForms, errForms := http.Post("https://beta.pokeapi.co/graphql/v1beta", "application/json", strings.NewReader(qNewForms))
	if errForms == nil {
		defer func() { _ = respForms.Body.Close() }()
		var glForms struct {
			Data struct {
				Pokemon []struct {
					ID        int    `json:"id"`
					Name      string `json:"name"`
					SpeciesID int    `json:"pokemon_species_id"`
				} `json:"pokemon_v2_pokemon"`
			} `json:"data"`
		}
		if json.NewDecoder(respForms.Body).Decode(&glForms) == nil {
			specIndex := make(map[int]int)
			for i := range current {
				specIndex[current[i].ID] = i
			}
			for _, f := range glForms.Data.Pokemon {
				// Filter out garbage/superfluous forms
				if strings.Contains(f.Name, "-gmax") || strings.Contains(f.Name, "-totem") || strings.Contains(f.Name, "-cap") || strings.Contains(f.Name, "-starter") || strings.Contains(f.Name, "cosplay") || strings.Contains(f.Name, "battle-bond") || strings.HasSuffix(f.Name, "-star") {
					continue
				}
				if i, ok := specIndex[f.SpeciesID]; ok {
					hasForm := false
					for _, existingForm := range current[i].Forms {
						if existingForm.Canonical == f.Name {
							hasForm = true
							break
						}
					}
					if !hasForm {
						current[i].Forms = append(current[i].Forms, PokemonForm{
							Canonical: f.Name,
							SpriteID:  f.ID,
						})
						added = append(added, f.Name)
					}
				}
			}
		}
	}

	// Fetch localized names via GraphQL for all species in one go.
	q := `{"query":"query{pokemon_v2_pokemonspeciesname(where:{pokemon_v2_language:{name:{_in:[\"ja-Hrkt\",\"ko\",\"zh-Hant\",\"fr\",\"de\",\"es\",\"it\",\"en\",\"ja\",\"zh-Hans\"]}}}){name pokemon_species_id pokemon_v2_language{name}}}"}`
	respGL, errGL := http.Post("https://beta.pokeapi.co/graphql/v1beta", "application/json", strings.NewReader(q))
	var namesUpdated int
	if errGL == nil {
		defer func() { _ = respGL.Body.Close() }()
		var glResp struct {
			Data struct {
				Names []struct {
					Name      string `json:"name"`
					SpeciesID int    `json:"pokemon_species_id"`
					Language  struct {
						Name string `json:"name"`
					} `json:"pokemon_v2_language"`
				} `json:"pokemon_v2_pokemonspeciesname"`
			} `json:"data"`
		}
		if json.NewDecoder(respGL.Body).Decode(&glResp) == nil {
			namesMap := make(map[int]map[string]string)
			langMap := map[string]string{
				"ja-Hrkt": "ja",
				"ja":      "ja",
				"ko":      "ko",
				"zh-Hant": "zh-hant",
				"zh-Hans": "zh-hans",
				"fr":      "fr",
				"de":      "de",
				"es":      "es",
				"it":      "it",
				"en":      "en",
			}
			for _, n := range glResp.Data.Names {
				l, ok := langMap[n.Language.Name]
				if !ok || n.Name == "" {
					continue
				}
				if namesMap[n.SpeciesID] == nil {
					namesMap[n.SpeciesID] = make(map[string]string)
				}
				// Prefer Kanji "ja" over Katakana "ja-Hrkt" if both exist.
				if l == "ja" && n.Language.Name == "ja-Hrkt" && namesMap[n.SpeciesID]["ja"] != "" {
					continue
				}
				namesMap[n.SpeciesID][l] = n.Name
			}

			// Apply translations to the loaded array
			for i := range current {
				if fetchedNames, ok := namesMap[current[i].ID]; ok {
					if current[i].Names == nil {
						current[i].Names = make(map[string]string)
					}
					for l, n := range fetchedNames {
						if current[i].Names[l] != n {
							namesUpdated++
						}
						current[i].Names[l] = n
					}
				}
			}
		}
	}

	// Fetch localized form names via GraphQL
	qForms := `{"query":"query{pokemon_v2_pokemonformname(where:{pokemon_v2_language:{name:{_in:[\"ja-Hrkt\",\"ko\",\"zh-Hant\",\"fr\",\"de\",\"es\",\"it\",\"en\",\"ja\",\"zh-Hans\"]}}}){pokemon_v2_pokemonform{name} pokemon_v2_language{name} pokemon_name name}}"}`
	respGLForms, errGLForms := http.Post("https://beta.pokeapi.co/graphql/v1beta", "application/json", strings.NewReader(qForms))
	if errGLForms == nil {
		defer func() { _ = respGLForms.Body.Close() }()
		var glRespForms struct {
			Data struct {
				Names []struct {
					Form struct {
						Name string `json:"name"`
					} `json:"pokemon_v2_pokemonform"`
					Language struct {
						Name string `json:"name"`
					} `json:"pokemon_v2_language"`
					PokemonName string `json:"pokemon_name"`
					Name        string `json:"name"`
				} `json:"pokemon_v2_pokemonformname"`
			} `json:"data"`
		}
		if json.NewDecoder(respGLForms.Body).Decode(&glRespForms) == nil {
			formNamesMap := make(map[string]map[string]string)
			langMap := map[string]string{
				"ja-Hrkt": "ja",
				"ja":      "ja",
				"ko":      "ko",
				"zh-Hant": "zh-hant",
				"zh-Hans": "zh-hans",
				"fr":      "fr",
				"de":      "de",
				"es":      "es",
				"it":      "it",
				"en":      "en",
			}
			for _, n := range glRespForms.Data.Names {
				l, ok := langMap[n.Language.Name]
				formNameKey := n.Form.Name
				if !ok || formNameKey == "" {
					continue
				}

				// Either pokemon_name or name contains the fully qualified localized string for the form in most cases,
				// (e.g. pokemon_name: "Alolan Sandshrew"). Fall back on just `name` ("Alolan Form") if pokemon_name is empty.
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
				// Prefer Kanji "ja" over Katakana "ja-Hrkt" if both exist.
				if l == "ja" && n.Language.Name == "ja-Hrkt" && formNamesMap[formNameKey]["ja"] != "" {
					continue
				}
				formNamesMap[formNameKey][l] = val
			}

			// Apply form translations to the loaded array
			for i := range current {
				for j := range current[i].Forms {
					canonical := current[i].Forms[j].Canonical
					if fetchedNames, ok := formNamesMap[canonical]; ok {
						if current[i].Forms[j].Names == nil {
							current[i].Forms[j].Names = make(map[string]string)
						}
						// Carry over base name and format manually if the GraphQL provided only a qualifier ("Alolan Form") instead of "Alolan Sandshrew".
						// We'll just dump whatever GraphQL gives us since it handles formats nicely for DE/FR/EN etc.
						for l, nVal := range fetchedNames {
							if current[i].Forms[j].Names[l] != nVal {
								namesUpdated++
							}
							current[i].Forms[j].Names[l] = nVal
						}
					}
				}
			}
		}
	}

	// Save updated pokedex to configDir
	updatedData, err := json.Marshal(current)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp{"failed to marshal: " + err.Error()})
		return
	}

	configDir := s.state.GetConfigDir()
	if err := os.MkdirAll(configDir, 0755); err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp{"failed to create config dir: " + err.Error()})
		return
	}
	destPath := filepath.Join(configDir, "pokemon.json")
	if err := os.WriteFile(destPath, updatedData, 0644); err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp{"failed to save: " + err.Error()})
		return
	}

	slog.Info("Pokedex sync complete", "added", len(added), "names_updated", namesUpdated)
	writeJSON(w, http.StatusOK, map[string]any{
		"total":        len(current),
		"added":        len(added),
		"namesUpdated": namesUpdated,
		"new":          added,
	})
}

// readPokedexJSON reads the pokedex JSON: configDir > source dir > embedded FS > cwd.
func (s *Server) readPokedexJSON() ([]byte, error) {
	// 1. configDir (user-synced version)
	configDir := s.state.GetConfigDir()
	if data, err := os.ReadFile(filepath.Join(configDir, "pokemon.json")); err == nil {
		return data, nil
	}

	// 2. Source directory (dev mode via runtime.Caller)
	_, file, _, ok := runtime.Caller(0)
	if ok {
		p := filepath.Join(filepath.Dir(file), "..", "..", "frontend", "public", "pokemon.json")
		if data, err := os.ReadFile(p); err == nil {
			return data, nil
		}
	}

	// 3. Embedded frontend FS
	if s.frontendFS != nil {
		f, err := s.frontendFS.Open("frontend/dist/pokemon.json")
		if err == nil {
			defer func() { _ = f.Close() }()
			return io.ReadAll(f)
		}
	}

	// 4. Working directory fallback
	if data, err := os.ReadFile("frontend/public/pokemon.json"); err == nil {
		return data, nil
	}

	return nil, fmt.Errorf("pokemon.json not found in any location")
}
