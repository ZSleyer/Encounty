// games_sync.go implements SyncGamesFromPokeAPI, which fetches the full
// version list from the PokéAPI and merges any new games or missing language
// translations into the on-disk games.json without overwriting existing data.
package server

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/zsleyer/encounty/backend/internal/database"
)

const pokeAPIBase = "https://pokeapi.co/api/v2"

// syncLangPrefix maps PokéAPI language codes → our language code + franchise prefix.
// The prefix is prepended to the short name the API returns (e.g. "Rot" → "Pokémon Rot").
var syncLangPrefix = map[string]struct {
	code   string
	prefix string
}{
	"ja-hrkt": {"ja", "ポケットモンスター "},
	"ko":      {"ko", "포켓몬스터 "},
	"zh-hant": {"zh-hant", "寶可夢 "},
	"zh-hans": {"zh-hans", "宝可梦 "},
	"fr":      {"fr", pokemonPrefix},
	"de":      {"de", pokemonPrefix},
	"es":      {"es", pokemonPrefix},
	"it":      {"it", pokemonPrefix},
	"en":      {"en", pokemonPrefix},
}

var syncGenNumber = map[string]int{
	"generation-i": 1, "generation-ii": 2, "generation-iii": 3,
	"generation-iv": 4, "generation-v": 5, "generation-vi": 6,
	"generation-vii": 7, "generation-viii": 8, "generation-ix": 9,
	"generation-x": 10,
}

// Default platform per generation (some version-groups override this).
var syncGenPlatform = map[int]string{
	1: "GB", 2: "GBC", 3: "GBA", 4: "NDS", 5: "NDS",
	6: "3DS", 7: "3DS", 8: "Switch", 9: "Switch", 10: "Switch 2",
}

// Version groups that use a different platform than their generation default.
var syncVGPlatform = map[string]string{
	"colosseum":                           "GameCube",
	"xd":                                  "GameCube",
	"lets-go-pikachu-lets-go-eevee":       "Switch",
	"sword-shield":                        "Switch",
	"brilliant-diamond-and-shining-pearl": "Switch",
	"legends-arceus":                      "Switch",
	"scarlet-violet":                      "Switch",
	"legends-za":                          "Switch 2",
}

// Versions to skip: DLCs, Japan-exclusive duplicates.
var syncSkip = map[string]bool{
	"the-isle-of-armor": true,
	"the-crown-tundra":  true,
	"the-teal-mask":     true,
	"the-indigo-disk":   true,
	"red-japan":         true,
	"green-japan":       true,
	"blue-japan":        true,
}

// GamesSyncResult reports additions/updates after a sync.
type GamesSyncResult struct {
	Added   int `json:"added"`
	Updated int `json:"updated"`
}

// --- PokéAPI response types --------------------------------------------------

type apiVersionList struct {
	Results []struct {
		Name string `json:"name"`
		URL  string `json:"url"`
	} `json:"results"`
}

type apiVersion struct {
	Names []struct {
		Language struct {
			Name string `json:"name"`
		} `json:"language"`
		Name string `json:"name"`
	} `json:"names"`
	VersionGroup struct {
		Name string `json:"name"`
	} `json:"version_group"`
}

type apiVersionGroup struct {
	Generation struct {
		Name string `json:"name"`
	} `json:"generation"`
}

// ----------------------------------------------------------------------------

func fetchAPIJSON(url string, v any) error {
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	return json.Unmarshal(body, v)
}

// vgInfo caches the generation number and platform for a version-group.
type vgInfo struct {
	gen      int
	platform string
}

// SyncGamesFromPokeAPI fetches all game versions from the PokéAPI and merges
// new or missing-language entries into the on-disk games.json.
func SyncGamesFromPokeAPI() (GamesSyncResult, error) {
	result := GamesSyncResult{}

	// 1. Load the current games (embedded + any external override) into a raw map.
	raw := make(map[string]rawGameEntry)
	for _, e := range loadGames() {
		raw[e.Key] = rawGameEntry{
			Names:      e.Names,
			Generation: e.Generation,
			Platform:   e.Platform,
		}
	}

	// 2. Fetch the full version list from PokéAPI.
	var vList apiVersionList
	if err := fetchAPIJSON(pokeAPIBase+"/version/?limit=200", &vList); err != nil {
		return result, fmt.Errorf("fetch version list: %w", err)
	}

	// 3. Process each version, resolving generation info and localised names.
	vgCache := map[string]vgInfo{}
	for _, v := range vList.Results {
		if syncSkip[v.Name] {
			continue
		}
		if err := processVersion(v.Name, v.URL, raw, vgCache, &result); err != nil {
			slog.Debug("SyncGames: skipping version", "name", v.Name, "error", err)
		}
	}

	if result.Added == 0 && result.Updated == 0 {
		slog.Info("SyncGames: everything up to date")
		return result, nil
	}

	// 4. Persist the merged data.
	if err := persistGames(raw); err != nil {
		return result, err
	}
	cachedGames = nil // invalidate in-memory cache
	slog.Info("SyncGames: sync complete", "added", result.Added, "updated", result.Updated)
	return result, nil
}

// processVersion fetches a single version from the PokéAPI and merges it into
// the raw game map, updating the result counters.
func processVersion(name, url string, raw map[string]rawGameEntry, vgCache map[string]vgInfo, result *GamesSyncResult) error {
	ourKey := "pokemon-" + name

	var detail apiVersion
	if err := fetchAPIJSON(url, &detail); err != nil {
		return err
	}
	time.Sleep(60 * time.Millisecond) // be polite to PokeAPI

	info := fetchGeneration(detail.VersionGroup.Name, vgCache)
	apiNames := buildLocalisedNames(detail)
	mergeGameEntry(raw, ourKey, apiNames, info, result)
	return nil
}

// fetchGeneration resolves the generation number and platform for a version-group,
// using vgCache to avoid redundant API calls.
func fetchGeneration(vgName string, vgCache map[string]vgInfo) vgInfo {
	if cached, ok := vgCache[vgName]; ok {
		return cached
	}
	var vg apiVersionGroup
	if err := fetchAPIJSON(pokeAPIBase+"/version-group/"+vgName+"/", &vg); err == nil {
		gen := syncGenNumber[vg.Generation.Name]
		platform := syncGenPlatform[gen]
		if ov, ok := syncVGPlatform[vgName]; ok {
			platform = ov
		}
		if platform == "" {
			platform = "Switch"
		}
		vgCache[vgName] = vgInfo{gen, platform}
	}
	time.Sleep(60 * time.Millisecond)
	return vgCache[vgName]
}

// franchisePrefixes lists known franchise brand prefixes used to decide whether
// to prepend the language-specific prefix to a game name.
var franchisePrefixes = []string{
	"Pokémon", "ポケットモンスター", "宝可梦", "寶可夢", "포켓몬스터",
}

// buildLocalisedNames extracts a language-code → localised-name map from API
// version data, prepending franchise prefixes where needed.
func buildLocalisedNames(detail apiVersion) map[string]string {
	names := make(map[string]string)
	for _, n := range detail.Names {
		lp, ok := syncLangPrefix[n.Language.Name]
		if !ok || n.Name == "" {
			continue
		}
		localName := n.Name
		needsPrefix := true
		for _, fp := range franchisePrefixes {
			if strings.HasPrefix(localName, fp) {
				needsPrefix = false
				break
			}
		}
		if needsPrefix {
			localName = lp.prefix + localName
		}
		names[lp.code] = localName
	}
	return names
}

// mergeGameEntry adds or updates a single game entry in the raw map, filling in
// missing language translations for existing entries or inserting new ones.
func mergeGameEntry(raw map[string]rawGameEntry, key string, apiNames map[string]string, info vgInfo, result *GamesSyncResult) {
	if existing, exists := raw[key]; exists {
		changed := false
		for lang, name := range apiNames {
			if _, has := existing.Names[lang]; !has {
				if existing.Names == nil {
					existing.Names = make(map[string]string)
				}
				existing.Names[lang] = name
				changed = true
			}
		}
		if changed {
			raw[key] = existing
			result.Updated++
		}
	} else {
		raw[key] = rawGameEntry{
			Names:      apiNames,
			Generation: info.gen,
			Platform:   info.platform,
		}
		result.Added++
		slog.Info("SyncGames: new game discovered", "key", key, "gen", info.gen, "platform", info.platform)
	}
}

// persistGames writes the merged game data to either the database or a JSON file.
func persistGames(raw map[string]rawGameEntry) error {
	if gamesDB != nil {
		rows := make([]database.GameRow, 0, len(raw))
		for key, v := range raw {
			namesJSON, err := json.Marshal(v.Names)
			if err != nil {
				continue
			}
			rows = append(rows, database.GameRow{
				Key:        key,
				NamesJSON:  namesJSON,
				Generation: v.Generation,
				Platform:   v.Platform,
			})
		}
		if err := gamesDB.SaveGames(rows); err != nil {
			return fmt.Errorf("save games to DB: %w", err)
		}
		return nil
	}
	outPath := gamesSyncSavePath()
	data, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal games: %w", err)
	}
	if err := os.WriteFile(outPath, data, 0644); err != nil {
		return fmt.Errorf("write %s: %w", outPath, err)
	}
	return nil
}

// gamesSyncSavePath returns the path where the synced games.json is written.
// It matches the highest-priority load path used by readGamesJSON.
func gamesSyncSavePath() string {
	if gamesConfigDir != "" {
		return filepath.Join(gamesConfigDir, gamesFilename)
	}
	if exePath, err := os.Executable(); err == nil {
		return filepath.Join(filepath.Dir(exePath), gamesFilename)
	}
	return gamesFilename
}
