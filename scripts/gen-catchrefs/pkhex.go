// pkhex.go fetches item, ribbon, mark and location names from the PKHeX
// resource files and enriches ribbons and marks with the pokepc dataset.
package main

import (
	"fmt"
	"regexp"
	"slices"
	"strings"
	"unicode"
)

const (
	// pkhexRaw is the raw file root of the PKHeX repository.
	pkhexRaw = "https://raw.githubusercontent.com/kwsch/PKHeX/master/PKHeX.Core/Resources/text/"

	// pkhexAPI is the GitHub contents API for the PKHeX location directory,
	// used to enumerate the group names instead of guessing them.
	pkhexAPI = "https://api.github.com/repos/kwsch/PKHeX/contents/PKHeX.Core/Resources/text/locations/"

	// pokepcRaw is the raw file root of the pokepc dataset.
	pokepcRaw = "https://raw.githubusercontent.com/pokepc/dataset/main/data/"
)

// --- Items ---

// itemNames maps an English item name to the distinct translations PKHeX
// carries for it, keyed by UI locale. A name can sit on more than one line
// because several games ship their own copy of an item, so the values are
// collected as a set and the caller decides what an ambiguous hit means.
type itemNames map[string]map[string][]string

// fetchItemNames downloads the PKHeX master item table for every UI locale and
// indexes the translations by English name. The language files are line
// aligned, line N is the same item in all of them, which is the only join key
// available since the tables carry no item IDs.
func fetchItemNames() (itemNames, error) {
	lines := make(map[string][]string, len(langs))
	for _, l := range langs {
		text, err := getText(pkhexRaw + "items/text_Items_" + l + ".txt")
		if err != nil {
			return nil, err
		}
		lines[l] = trimmedLines(text)
	}

	// A shifted or truncated file would silently mistranslate every item below
	// the shift, so a length mismatch has to stop the generator.
	for _, l := range langs {
		if len(lines[l]) != len(lines["en"]) {
			return nil, fmt.Errorf("item table %s has %d lines, en has %d",
				l, len(lines[l]), len(lines["en"]))
		}
	}

	index := make(itemNames, len(lines["en"]))
	for i, en := range lines["en"] {
		if en == "" {
			continue
		}
		entry, ok := index[en]
		if !ok {
			entry = make(map[string][]string, len(langs))
			index[en] = entry
		}
		for _, l := range langs {
			if v := lines[l][i]; v != "" && !slices.Contains(entry[l], v) {
				entry[l] = append(entry[l], v)
			}
		}
	}
	return index, nil
}

// trimmedLines splits a PKHeX text resource into trimmed lines and drops the
// trailing empty ones, which differ per file depending on the final newline.
func trimmedLines(text string) []string {
	out := strings.Split(text, "\n")
	for i := range out {
		out[i] = strings.TrimSpace(out[i])
	}
	for len(out) > 0 && out[len(out)-1] == "" {
		out = out[:len(out)-1]
	}
	return out
}

// --- Ribbons and marks ---

// markKeyPrefix marks a PKHeX ribbon key as a mark rather than a ribbon.
const markKeyPrefix = "RibbonMark"

// fetchRibbonsAndMarks downloads the PKHeX ribbon name tables for all UI
// locales and splits them into ribbons and marks. Generation and category
// come from the pokepc dataset, matched on the normalized English name.
func fetchRibbonsAndMarks() ([]Ribbon, []Mark, error) {
	byLang := make(map[string]map[string]string, len(langs))
	var order []string
	for _, l := range langs {
		text, err := getText(pkhexRaw + "other/" + l + "/text_Ribbons_" + l + ".txt")
		if err != nil {
			return nil, nil, err
		}
		table := make(map[string]string)
		for _, line := range strings.Split(text, "\n") {
			line = strings.TrimRight(line, "\r")
			key, value, ok := strings.Cut(line, "\t")
			if !ok || key == "" {
				continue
			}
			value = strings.TrimSpace(value)
			if value == "" {
				continue
			}
			table[key] = value
			if l == "en" {
				order = append(order, key)
			}
		}
		byLang[l] = table
	}

	pokepcRibbons, err := fetchPokepc("ribbons.json")
	if err != nil {
		return nil, nil, err
	}
	pokepcMarks, err := fetchPokepc("marks.json")
	if err != nil {
		return nil, nil, err
	}

	var ribbons []Ribbon
	var marks []Mark
	ribbonMisses, markMisses := 0, 0
	for _, key := range order {
		names := make(map[string]string, len(langs))
		for _, l := range langs {
			names[l] = byLang[l][key]
		}
		named := Named{Slug: ribbonSlug(key), Names: fillMissing(names)}
		norm := normalizeName(names["en"])

		if strings.HasPrefix(key, markKeyPrefix) {
			mark := Mark{Named: named}
			if e, ok := pokepcMarks[norm]; ok {
				mark.Gen = e.Gen
			} else {
				markMisses++
			}
			marks = append(marks, mark)
			continue
		}

		ribbon := Ribbon{Named: named}
		if e, ok := pokepcRibbons[norm]; ok {
			ribbon.Gen = e.Gen
			ribbon.Category = e.Category
		} else {
			ribbonMisses++
		}
		ribbons = append(ribbons, ribbon)
	}

	fmt.Printf("pokepc match: ribbons %d/%d, marks %d/%d\n",
		len(ribbons)-ribbonMisses, len(ribbons), len(marks)-markMisses, len(marks))
	return ribbons, marks, nil
}

// pokepcEntry is the subset of a pokepc dataset record we care about.
type pokepcEntry struct {
	Name     string `json:"name"`
	Gen      int    `json:"gen"`
	Category string `json:"category"`
}

// fetchPokepc downloads a pokepc dataset file and indexes it by normalized
// English name.
func fetchPokepc(file string) (map[string]pokepcEntry, error) {
	var list []pokepcEntry
	if err := getJSON(pokepcRaw+file, &list); err != nil {
		return nil, err
	}
	index := make(map[string]pokepcEntry, len(list))
	for _, e := range list {
		index[normalizeName(e.Name)] = e
	}
	return index, nil
}

// normalizeName reduces a display name to a comparable key: parenthesized
// qualifiers are dropped, everything but letters and digits is stripped and a
// trailing "Ribbon" or "Mark" word is removed. That lines PKHeX's
// "Kalos Champion" up with pokepc's "Kalos Champion Ribbon".
func normalizeName(s string) string {
	if i := strings.IndexByte(s, '('); i >= 0 {
		s = s[:i]
	}
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	out := b.String()
	out = strings.TrimSuffix(out, "ribbon")
	out = strings.TrimSuffix(out, "mark")
	return out
}

// ribbonSlug turns a PKHeX resource key into the stable slug that lands in
// user data. The "Ribbon" prefix is dropped, the rest is kebab-cased and
// ribbons get the prefix back:
//
//	RibbonChampionKalos -> ribbon-champion-kalos
//	RibbonMarkMightiest -> mark-mightiest
//	RibbonG3CoolSuper   -> ribbon-g3-cool-super
//
// These slugs are written into saved hunts, so the scheme must never change.
func ribbonSlug(key string) string {
	rest := strings.TrimPrefix(key, "Ribbon")
	kebab := kebabCase(rest)
	if strings.HasPrefix(key, markKeyPrefix) {
		return kebab
	}
	return "ribbon-" + kebab
}

// kebabCase converts a PascalCase identifier to lowercase words joined by
// hyphens. A hyphen is inserted before every uppercase letter that starts a
// new word, so "G3CoolSuper" becomes "g3-cool-super".
func kebabCase(s string) string {
	runes := []rune(s)
	var b strings.Builder
	for i, r := range runes {
		if i > 0 && unicode.IsUpper(r) {
			prevIsUpper := unicode.IsUpper(runes[i-1])
			nextIsLower := i+1 < len(runes) && unicode.IsLower(runes[i+1])
			if !prevIsUpper || nextIsLower {
				b.WriteByte('-')
			}
		}
		b.WriteRune(unicode.ToLower(r))
	}
	return b.String()
}

// --- Locations ---

// locationGenDirs are the PKHeX location directories. PKHeX has no gen1
// directory because Red, Blue and Yellow store no met location.
var locationGenDirs = []string{
	"gen2", "gen3", "gen4", "gen5", "gen6",
	"gen7", "gen8", "gen8a", "gen8b", "gen9", "gen9a",
}

// bankZeroFile matches the English file of a group's 00000 bank, which holds
// the real map locations. The 2000/3000/30000/40000/50000/60000 banks hold
// "from an Egg", "a link trade partner" and similar pseudo locations that no
// hunter types in, so they are skipped.
var bankZeroFile = regexp.MustCompile(`^text_(.+)_00000_en\.txt$`)

// fetchLocationGroups enumerates the PKHeX location groups via the GitHub
// contents API and downloads the 00000 bank of every group in all UI locales.
func fetchLocationGroups() (map[string][]Location, error) {
	groups := make(map[string][]Location)
	for _, gen := range locationGenDirs {
		var files []struct {
			Name string `json:"name"`
		}
		if err := getJSON(pkhexAPI+gen, &files); err != nil {
			return nil, fmt.Errorf("list %s: %w", gen, err)
		}
		for _, f := range files {
			m := bankZeroFile.FindStringSubmatch(f.Name)
			if m == nil {
				continue
			}
			locs, err := fetchLocationGroup(gen, m[1])
			if err != nil {
				return nil, err
			}
			groups[m[1]] = locs
		}
	}
	return groups, nil
}

// fetchLocationGroup downloads one group's 00000 bank in every UI locale.
// The files are line indexed with no keys, so the slug is the group name plus
// the 1-based line number, for example "rsefrlg-17" for Route 101. Lines that
// carry no letter or digit are PKHeX placeholders ("", "-", "------", "???")
// and are skipped.
func fetchLocationGroup(gen, group string) ([]Location, error) {
	lines := make(map[string][]string, len(langs))
	for _, l := range langs {
		text, err := getText(fmt.Sprintf("%slocations/%s/text_%s_00000_%s.txt", pkhexRaw, gen, group, l))
		if err != nil {
			return nil, fmt.Errorf("%s/%s/%s: %w", gen, group, l, err)
		}
		lines[l] = strings.Split(text, "\n")
	}

	var locs []Location
	for i, en := range lines["en"] {
		en = strings.TrimSpace(strings.TrimRight(en, "\r"))
		if isPlaceholder(en) {
			continue
		}
		names := make(map[string]string, len(langs))
		for _, l := range langs {
			if i < len(lines[l]) {
				v := strings.TrimSpace(strings.TrimRight(lines[l][i], "\r"))
				if !isPlaceholder(v) {
					names[l] = v
				}
			}
		}
		names["en"] = en
		locs = append(locs, Location{
			Slug:  fmt.Sprintf("%s-%d", group, i+1),
			Names: fillMissing(names),
		})
	}
	return locs, nil
}

// isPlaceholder reports whether a location line carries no readable name.
func isPlaceholder(s string) bool {
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return false
		}
	}
	return true
}
