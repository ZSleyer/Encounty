// catchrefs_test.go guards the generated reference data against silent drift.
// The generator is run by hand, so these tests are the only thing standing
// between a bad regeneration and shipped data.
package catchrefs

import (
	"encoding/json"
	"os"
	"testing"
)

// uiLangs are the locales every entry must carry a name for.
var uiLangs = []string{"de", "en", "fr", "es", "ja"}

// namedByKind returns every reference entry grouped by kind so the generic
// checks below can run over all of them.
func namedByKind(t *testing.T) map[string][]Named {
	t.Helper()
	refs := All()

	byKind := map[string][]Named{}
	for _, n := range refs.Natures {
		byKind["natures"] = append(byKind["natures"], n.Named)
	}
	for _, b := range refs.Balls {
		byKind["balls"] = append(byKind["balls"], b.Named)
	}
	for _, a := range refs.Abilities {
		byKind["abilities"] = append(byKind["abilities"], a.Named)
	}
	for _, r := range refs.Ribbons {
		byKind["ribbons"] = append(byKind["ribbons"], r.Named)
	}
	for _, m := range refs.Marks {
		byKind["marks"] = append(byKind["marks"], m.Named)
	}
	for group, locs := range locations.Groups {
		for _, l := range locs {
			byKind["locations/"+group] = append(byKind["locations/"+group], Named(l))
		}
	}
	return byKind
}

// TestRefsParse verifies that both embedded documents parse and that every
// list is populated.
func TestRefsParse(t *testing.T) {
	refs := All()
	counts := map[string]int{
		"natures":   len(refs.Natures),
		"balls":     len(refs.Balls),
		"abilities": len(refs.Abilities),
		"ribbons":   len(refs.Ribbons),
		"marks":     len(refs.Marks),
	}
	for kind, n := range counts {
		if n == 0 {
			t.Errorf("%s is empty", kind)
		}
	}
	if len(refs.Natures) != 25 {
		t.Errorf("expected 25 natures, got %d", len(refs.Natures))
	}
	if len(locations.Groups) == 0 {
		t.Fatal("no location groups parsed")
	}
}

// TestEveryEntryHasAllFiveLanguages checks that no entry would render a blank
// label in any UI locale.
func TestEveryEntryHasAllFiveLanguages(t *testing.T) {
	for kind, entries := range namedByKind(t) {
		for _, e := range entries {
			for _, lang := range uiLangs {
				if e.Names[lang] == "" {
					t.Errorf("%s: %q has no %s name", kind, e.Slug, lang)
				}
			}
		}
	}
}

// TestSlugsAreUniquePerKind verifies that slugs, which land in user data, do
// not collide within their own list.
func TestSlugsAreUniquePerKind(t *testing.T) {
	for kind, entries := range namedByKind(t) {
		seen := make(map[string]bool, len(entries))
		for _, e := range entries {
			if e.Slug == "" {
				t.Errorf("%s: entry with empty slug", kind)
				continue
			}
			if seen[e.Slug] {
				t.Errorf("%s: duplicate slug %q", kind, e.Slug)
			}
			seen[e.Slug] = true
		}
	}
}

// TestEveryGameKeyMapsToALocationGroup verifies that no game from the game
// list is missing from gameToGroup. A missing key would silently return no
// locations instead of failing loudly here.
func TestEveryGameKeyMapsToALocationGroup(t *testing.T) {
	raw, err := os.ReadFile("../gamesync/fallback_games.json")
	if err != nil {
		t.Fatalf("read fallback_games.json: %v", err)
	}
	var games map[string]json.RawMessage
	if err := json.Unmarshal(raw, &games); err != nil {
		t.Fatalf("parse fallback_games.json: %v", err)
	}
	if len(games) == 0 {
		t.Fatal("fallback_games.json is empty")
	}

	load()
	for key := range games {
		group, ok := locations.GameToGroup[key]
		if !ok {
			t.Errorf("game %q is missing from gameToGroup", key)
			continue
		}
		if group == "" {
			continue // Deliberately unmapped, e.g. Gen 1 or unreleased titles.
		}
		if _, ok := locations.Groups[group]; !ok {
			t.Errorf("game %q maps to unknown location group %q", key, group)
		}
	}
}

// TestLocationsForUnknownGameReturnsEmpty verifies that an unknown game key
// yields an empty but non-nil slice so the JSON response never carries null.
func TestLocationsForUnknownGameReturnsEmpty(t *testing.T) {
	group, locs := LocationsFor("pokemon-does-not-exist")
	if group != "" {
		t.Errorf("expected empty group, got %q", group)
	}
	if locs == nil {
		t.Fatal("expected an empty slice, got nil")
	}
	if len(locs) != 0 {
		t.Errorf("expected no locations, got %d", len(locs))
	}

	data, err := json.Marshal(locs)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(data) != "[]" {
		t.Errorf("expected [], got %s", data)
	}
}

// TestKnownLocationExists is the canary for the line-indexed PKHeX parsing.
// The Gen 3 German table has "Route 101" on line 17, so the slug rsefrlg-17
// must still carry it. If this breaks, the whole location index shifted.
func TestKnownLocationExists(t *testing.T) {
	group, locs := LocationsFor("pokemon-ruby")
	if group != "rsefrlg" {
		t.Fatalf("expected group rsefrlg, got %q", group)
	}
	for _, l := range locs {
		if l.Slug == "rsefrlg-17" {
			if l.Names["de"] != "Route 101" {
				t.Fatalf("rsefrlg-17 German name is %q, expected \"Route 101\"", l.Names["de"])
			}
			return
		}
	}
	t.Fatal("rsefrlg-17 not found")
}

// TestRawJSONMatchesParsedData verifies that the raw byte accessors expose the
// same documents the parsed API serves.
func TestRawJSONMatchesParsedData(t *testing.T) {
	var raw Refs
	if err := json.Unmarshal(RefsJSON(), &raw); err != nil {
		t.Fatalf("RefsJSON is not valid: %v", err)
	}
	if len(raw.Abilities) != len(All().Abilities) {
		t.Errorf("RefsJSON has %d abilities, All() has %d", len(raw.Abilities), len(All().Abilities))
	}
	if !json.Valid(LocationsJSON()) {
		t.Error("LocationsJSON is not valid JSON")
	}
}
