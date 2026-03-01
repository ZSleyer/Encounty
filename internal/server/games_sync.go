package server

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
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
	"fr":      {"fr", "Pokémon "},
	"de":      {"de", "Pokémon "},
	"es":      {"es", "Pokémon "},
	"it":      {"it", "Pokémon "},
	"en":      {"en", "Pokémon "},
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
	"lets-go-pikachu-lets-go-eevee":       "Switch",
	"sword-shield":                        "Switch",
	"brilliant-diamond-and-shining-pearl": "Switch",
	"legends-arceus":                      "Switch",
	"scarlet-violet":                      "Switch",
	"legends-za":                          "Switch 2",
}

// Versions to skip: DLCs, GameCube spinoffs, Japan-exclusive duplicates.
var syncSkip = map[string]bool{
	"colosseum":         true,
	"xd":                true,
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
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	return json.Unmarshal(body, v)
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

	// Version-group cache (generation + platform).
	type vgInfo struct {
		gen      int
		platform string
	}
	vgCache := map[string]vgInfo{}

	for _, v := range vList.Results {
		if syncSkip[v.Name] {
			continue
		}
		ourKey := "pokemon-" + v.Name

		// Fetch version detail (names + version-group reference).
		var detail apiVersion
		if err := fetchAPIJSON(v.URL, &detail); err != nil {
			log.Printf("SyncGames: skip %q: %v", v.Name, err)
			continue
		}
		time.Sleep(60 * time.Millisecond) // be polite to PokeAPI

		// Resolve version-group → generation + platform (cached).
		vgName := detail.VersionGroup.Name
		if _, ok := vgCache[vgName]; !ok {
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
		}
		info := vgCache[vgName]

		// Build localised name map from API data.
		apiNames := make(map[string]string)
		for _, n := range detail.Names {
			lp, ok := syncLangPrefix[n.Language.Name]
			if !ok || n.Name == "" {
				continue
			}
			name := n.Name
			// Only add the prefix when the name doesn't already start with a
			// known franchise brand (some newer entries include it already).
			franchisePrefixes := []string{
				"Pokémon", "ポケットモンスター", "宝可梦", "寶可夢", "포켓몬스터",
			}
			needsPrefix := true
			for _, fp := range franchisePrefixes {
				if strings.HasPrefix(name, fp) {
					needsPrefix = false
					break
				}
			}
			if needsPrefix {
				name = lp.prefix + name
			}
			apiNames[lp.code] = name
		}

		if existing, exists := raw[ourKey]; exists {
			// Existing game – only fill in missing language entries.
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
				raw[ourKey] = existing
				result.Updated++
			}
		} else {
			// Brand-new game not yet in our list.
			raw[ourKey] = rawGameEntry{
				Names:      apiNames,
				Generation: info.gen,
				Platform:   info.platform,
			}
			result.Added++
			log.Printf("SyncGames: new game %q (gen %d, %s)", ourKey, info.gen, info.platform)
		}
	}

	if result.Added == 0 && result.Updated == 0 {
		log.Printf("SyncGames: everything up to date")
		return result, nil
	}

	// 3. Persist the merged data next to the binary (highest-priority load path).
	outPath := gamesSyncSavePath()
	data, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return result, fmt.Errorf("marshal games: %w", err)
	}
	if err := os.WriteFile(outPath, data, 0644); err != nil {
		return result, fmt.Errorf("write %s: %w", outPath, err)
	}
	cachedGames = nil // invalidate in-memory cache
	log.Printf("SyncGames: added=%d updated=%d → %s", result.Added, result.Updated, outPath)
	return result, nil
}

// gamesSyncSavePath returns the path where the synced games.json is written.
// It matches the highest-priority load path used by readGamesJSON.
func gamesSyncSavePath() string {
	if exePath, err := os.Executable(); err == nil {
		return filepath.Join(filepath.Dir(exePath), "games.json")
	}
	return "games.json"
}
