// Package catchrefs serves the reference lists a hunter picks from when
// recording a catch: natures, balls, abilities, ribbons, marks and met
// locations.
//
// The data is embedded at build time from two generated JSON files. It only
// changes when a new game ships, so there is no runtime sync, no database
// table and no cache invalidation. Regenerate with:
//
//	cd scripts/gen-catchrefs && go run .
package catchrefs

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"slices"
	"sync"
)

//go:embed catchrefs.json
var refsJSON []byte

//go:embed locations.json
var locationsJSON []byte

// Named is the common shape of every reference entry: a stable slug that is
// written into user data plus one display name per UI locale (de, en, fr, es,
// ja). Every entry carries all five, missing translations fall back to the
// English name at generation time.
type Named struct {
	Slug  string            `json:"slug"`
	Names map[string]string `json:"names"`
}

// Nature is a single nature. Raises and Lowers hold the short stat keys
// ("atk", "spa", ...) and are empty for the five neutral natures.
type Nature struct {
	Named
	Raises string `json:"raises,omitempty"`
	Lowers string `json:"lowers,omitempty"`
}

// Ball is a single Poke Ball. Generations lists the game generations the ball
// exists in so the UI can hide balls a hunt's game does not have. Games is set
// only where the generation is too coarse, see AvailableIn.
type Ball struct {
	Named
	Generations []int    `json:"generations"`
	Games       []string `json:"games,omitempty"`
}

// AvailableIn reports whether the ball can be obtained in the given game.
// Games wins over Generations because the upstream item indices report the
// Legends Arceus balls for generation 8 and 9 although they exist in exactly
// one game. The catch dialog mirrors this rule when it builds its ball picker.
func (b Ball) AvailableIn(gameKey string, generation int) bool {
	if len(b.Games) > 0 {
		return slices.Contains(b.Games, gameKey)
	}
	return slices.Contains(b.Generations, generation)
}

// Ability is a single ability. The list is flat and global.
type Ability struct {
	Named
}

// Ribbon is a single ribbon. Gen and Category are zero when the upstream
// dataset had no matching entry, mostly for contest ribbons.
type Ribbon struct {
	Named
	Gen      int    `json:"gen,omitempty"`
	Category string `json:"category,omitempty"`
}

// Mark is a single mark. Gen is zero when the upstream dataset had no
// matching entry.
type Mark struct {
	Named
	Gen int `json:"gen,omitempty"`
}

// Refs bundles every reference list except the locations, which are keyed by
// game and therefore live in their own file.
type Refs struct {
	Natures   []Nature  `json:"natures"`
	Balls     []Ball    `json:"balls"`
	Abilities []Ability `json:"abilities"`
	Ribbons   []Ribbon  `json:"ribbons"`
	Marks     []Mark    `json:"marks"`
}

// Location is a single met location. The slug is the PKHeX location group
// plus the 1-based line index of the name inside the group's table.
type Location struct {
	Slug  string            `json:"slug"`
	Names map[string]string `json:"names"`
}

// locationData is the payload of the embedded locations file.
type locationData struct {
	Groups      map[string][]Location `json:"groups"`
	GameToGroup map[string]string     `json:"gameToGroup"`
}

var (
	parseOnce sync.Once
	refs      Refs
	locations locationData
)

// load parses both embedded files exactly once. The files are generated and
// checked in, so a parse failure is a broken build rather than a runtime
// condition a caller could handle.
func load() {
	parseOnce.Do(func() {
		if err := json.Unmarshal(refsJSON, &refs); err != nil {
			panic(fmt.Sprintf("catchrefs: catchrefs.json is malformed: %v", err))
		}
		if err := json.Unmarshal(locationsJSON, &locations); err != nil {
			panic(fmt.Sprintf("catchrefs: locations.json is malformed: %v", err))
		}
	})
}

// All returns the parsed reference lists. It is named All rather than Refs
// because a function cannot share its name with the Refs type. The returned
// slices are shared, callers must not modify them.
func All() Refs {
	load()
	return refs
}

// LocationsFor returns the PKHeX location group covering the given game key
// and its met locations. Unknown game keys and games without a location table
// (Gen 1, unreleased titles) yield an empty group name and an empty, non-nil
// slice so the JSON response never contains null.
func LocationsFor(gameKey string) (group string, locs []Location) {
	load()
	group = locations.GameToGroup[gameKey]
	locs = locations.Groups[group]
	if locs == nil {
		locs = []Location{}
	}
	return group, locs
}

// RefsJSON returns the raw embedded reference document so an HTTP handler can
// write it straight through instead of re-marshaling on every request. The
// returned bytes back the embedded file and must not be modified.
func RefsJSON() []byte { return refsJSON }
