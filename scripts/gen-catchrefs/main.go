// main.go generates the catch reference data that the backend embeds:
// natures, balls, abilities, ribbons, marks and met locations.
//
// Run it by hand whenever a new game ships, it is deliberately not part of
// the build:
//
//	cd scripts/gen-catchrefs && go run .
//
// Output goes to backend/internal/catchrefs/catchrefs.json and
// backend/internal/catchrefs/locations.json, both minified.
//
// Sources:
//   - PokeAPI GraphQL v1beta2 (natures, balls, abilities)
//   - PKHeX, GPL-3.0, https://github.com/kwsch/PKHeX (ribbon, mark and
//     location names)
//   - pokepc/dataset, MIT, https://github.com/pokepc/dataset (ribbon and
//     mark generation and category)
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
)

// langs are the five UI locales the generated lists carry. The Pokedex holds
// nine languages, but these entries are pure UI labels and the extra four
// would only inflate the binary.
var langs = []string{"de", "en", "fr", "es", "ja"}

// Named is the common shape of every reference entry: a stable slug plus one
// display name per UI locale.
type Named struct {
	Slug  string            `json:"slug"`
	Names map[string]string `json:"names"`
}

// Nature is a single nature with the stats it raises and lowers. Neutral
// natures carry neither.
type Nature struct {
	Named
	Raises string `json:"raises,omitempty"`
	Lowers string `json:"lowers,omitempty"`
}

// Ball is a single Poke Ball with the game generations it exists in.
type Ball struct {
	Named
	Generations []int `json:"generations"`
}

// Ability is a single ability. The list is flat and global, abilities are not
// tied to a generation here.
type Ability struct {
	Named
}

// Ribbon is a single ribbon. Gen and Category are omitted when the pokepc
// dataset has no matching entry.
type Ribbon struct {
	Named
	Gen      int    `json:"gen,omitempty"`
	Category string `json:"category,omitempty"`
}

// Mark is a single mark. Gen is omitted when the pokepc dataset has no
// matching entry.
type Mark struct {
	Named
	Gen int `json:"gen,omitempty"`
}

// Refs is the payload of catchrefs.json.
type Refs struct {
	Natures   []Nature  `json:"natures"`
	Balls     []Ball    `json:"balls"`
	Abilities []Ability `json:"abilities"`
	Ribbons   []Ribbon  `json:"ribbons"`
	Marks     []Mark    `json:"marks"`
}

// Location is a single met location inside a PKHeX location group.
type Location struct {
	Slug  string            `json:"slug"`
	Names map[string]string `json:"names"`
}

// Locations is the payload of locations.json.
type Locations struct {
	Groups      map[string][]Location `json:"groups"`
	GameToGroup map[string]string     `json:"gameToGroup"`
}

func main() {
	out := flag.String("out", "../../backend/internal/catchrefs", "output directory")
	flag.Parse()

	if err := run(*out); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

// run fetches every source, builds both payloads and writes them to dir.
func run(dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	natures, err := fetchNatures()
	if err != nil {
		return fmt.Errorf("natures: %w", err)
	}
	balls, err := fetchBalls()
	if err != nil {
		return fmt.Errorf("balls: %w", err)
	}
	abilities, err := fetchAbilities()
	if err != nil {
		return fmt.Errorf("abilities: %w", err)
	}
	ribbons, marks, err := fetchRibbonsAndMarks()
	if err != nil {
		return fmt.Errorf("ribbons: %w", err)
	}
	groups, err := fetchLocationGroups()
	if err != nil {
		return fmt.Errorf("locations: %w", err)
	}

	if err := writeJSON(filepath.Join(dir, "catchrefs.json"), Refs{
		Natures:   natures,
		Balls:     balls,
		Abilities: abilities,
		Ribbons:   ribbons,
		Marks:     marks,
	}); err != nil {
		return err
	}
	if err := writeJSON(filepath.Join(dir, "locations.json"), Locations{
		Groups:      groups,
		GameToGroup: gameToGroup,
	}); err != nil {
		return err
	}

	total := 0
	for _, locs := range groups {
		total += len(locs)
	}
	fmt.Printf("natures=%d balls=%d abilities=%d ribbons=%d marks=%d groups=%d locations=%d\n",
		len(natures), len(balls), len(abilities), len(ribbons), len(marks), len(groups), total)
	reportSize(filepath.Join(dir, "catchrefs.json"))
	reportSize(filepath.Join(dir, "locations.json"))
	return nil
}

// writeJSON marshals v as minified JSON without HTML escaping and writes it
// to path.
func writeJSON(path string, v any) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()

	enc := json.NewEncoder(f)
	enc.SetEscapeHTML(false)
	return enc.Encode(v)
}

// reportSize prints the byte size of a written file.
func reportSize(path string) {
	info, err := os.Stat(path)
	if err != nil {
		fmt.Fprintf(os.Stderr, "stat %s: %v\n", path, err)
		return
	}
	fmt.Printf("%s: %d bytes\n", filepath.Base(path), info.Size())
}

// fillMissing replaces empty language entries with the English name so the UI
// never has to render a blank label.
func fillMissing(names map[string]string) map[string]string {
	en := names["en"]
	for _, l := range langs {
		if names[l] == "" {
			names[l] = en
		}
	}
	return names
}
