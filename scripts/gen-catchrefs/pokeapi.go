// pokeapi.go fetches natures, balls and abilities from the PokeAPI GraphQL
// endpoint.
package main

import (
	"fmt"
	"slices"
)

// statShort maps PokeAPI stat IDs to the short stat keys the UI uses.
var statShort = map[int]string{
	1: "hp",
	2: "atk",
	3: "def",
	4: "spa",
	5: "spd",
	6: "spe",
}

// ballCategories are the PokeAPI item categories that hold catchable balls.
// Together they cover all 38 Poke Balls.
var ballCategories = `["standard-balls","special-balls","apricorn-balls"]`

// legendsArceusBalls are the eleven balls that exist in Pokemon Legends:
// Arceus and nowhere else. PokeAPI reports them under generation 8 and 9, so
// the generation alone would offer them in a Sword, Shield, Scarlet or Violet
// picker, where "lagreat-ball" is even called "Superball" just like the
// regular "great-ball".
var legendsArceusBalls = []string{
	"lastrange-ball", "lapoke-ball", "lagreat-ball", "laultra-ball",
	"laheavy-ball", "laleaden-ball", "lagigaton-ball", "lafeather-ball",
	"lawing-ball", "lajet-ball", "laorigin-ball",
}

// legendsArceusGames are the game keys of Pokemon Legends: Arceus in
// backend/internal/gamesync/fallback_games.json. The game list carries the
// title under two keys, both have to be scoped.
var legendsArceusGames = []string{"pokemon-legends", "pokemon-legends-arceus"}

// fetchNatures returns the 25 natures with their localized names and the
// stats they raise and lower. The five neutral natures have neither.
func fetchNatures() ([]Nature, error) {
	var resp struct {
		Nature []struct {
			Name        string     `json:"name"`
			IncreasedID *int       `json:"increased_stat_id"`
			DecreasedID *int       `json:"decreased_stat_id"`
			NatureNames []langName `json:"naturenames"`
		} `json:"nature"`
	}
	q := `query{nature(order_by:{id:asc}){name increased_stat_id decreased_stat_id ` +
		`naturenames(where:{language:{name:{_in:` + langFilter() + `}}}){name language{name}}}}`
	if err := graphQL(q, &resp); err != nil {
		return nil, err
	}

	natures := make([]Nature, 0, len(resp.Nature))
	for _, n := range resp.Nature {
		nat := Nature{Named: Named{Slug: n.Name, Names: namesOf(n.NatureNames)}}
		if n.IncreasedID != nil {
			nat.Raises = statShort[*n.IncreasedID]
		}
		if n.DecreasedID != nil {
			nat.Lowers = statShort[*n.DecreasedID]
		}
		natures = append(natures, nat)
	}
	return natures, nil
}

// fetchBalls returns every Poke Ball with its localized names and the game
// generations it exists in. The generations come from itemgameindices, which
// is populated for all balls, so the UI can hide balls a hunt's game does not
// have.
func fetchBalls() ([]Ball, error) {
	var resp struct {
		Item []struct {
			Name      string `json:"name"`
			GameIndex []struct {
				GenerationID int `json:"generation_id"`
			} `json:"itemgameindices"`
			ItemNames []langName `json:"itemnames"`
		} `json:"item"`
	}
	q := `query{item(where:{itemcategory:{name:{_in:` + ballCategories + `}}},order_by:{id:asc}){` +
		`name itemgameindices{generation_id} ` +
		`itemnames(where:{language:{name:{_in:` + langFilter() + `}}}){name language{name}}}}`
	if err := graphQL(q, &resp); err != nil {
		return nil, err
	}

	balls := make([]Ball, 0, len(resp.Item))
	for _, b := range resp.Item {
		gens := make([]int, 0, len(b.GameIndex))
		for _, gi := range b.GameIndex {
			if !slices.Contains(gens, gi.GenerationID) {
				gens = append(gens, gi.GenerationID)
			}
		}
		slices.Sort(gens)
		balls = append(balls, Ball{
			// The names stay unfilled until the PKHeX pass ran, otherwise the
			// English fallback would be indistinguishable from a real name.
			Named:       Named{Slug: b.Name, Names: rawNamesOf(b.ItemNames)},
			Generations: gens,
		})
	}

	if err := scopeLegendsArceusBalls(balls); err != nil {
		return nil, err
	}
	if err := fillBallNamesFromPKHeX(balls); err != nil {
		return nil, err
	}
	for i := range balls {
		balls[i].Names = fillMissing(balls[i].Names)
	}
	return balls, nil
}

// scopeLegendsArceusBalls pins the Legends Arceus balls to their game keys.
// A missing slug means PokeAPI renamed the items, which would silently put the
// balls back into the Sword and Scarlet pickers, so it stops the generator.
func scopeLegendsArceusBalls(balls []Ball) error {
	found := 0
	for i := range balls {
		if slices.Contains(legendsArceusBalls, balls[i].Slug) {
			balls[i].Games = legendsArceusGames
			found++
		}
	}
	if found != len(legendsArceusBalls) {
		return fmt.Errorf("expected %d Legends Arceus balls, found %d",
			len(legendsArceusBalls), found)
	}
	return nil
}

// fillBallNamesFromPKHeX closes the translation gaps PokeAPI leaves on the
// Legends Arceus balls, which only carry an English and a French name there.
// PKHeX is consulted for the locales PokeAPI did not answer at all, a name it
// did supply is never overwritten.
func fillBallNamesFromPKHeX(balls []Ball) error {
	items, err := fetchItemNames()
	if err != nil {
		return fmt.Errorf("item names: %w", err)
	}

	filled := 0
	for i := range balls {
		entry, ok := items[balls[i].Names["en"]]
		if !ok {
			continue
		}
		for _, l := range langs {
			if balls[i].Names[l] != "" || len(entry[l]) == 0 {
				continue
			}
			if len(entry[l]) > 1 {
				return fmt.Errorf("ball %q has %d different %s names in PKHeX: %v",
					balls[i].Slug, len(entry[l]), l, entry[l])
			}
			balls[i].Names[l] = entry[l][0]
			filled++
		}
	}
	fmt.Printf("PKHeX filled %d missing ball names\n", filled)
	return nil
}

// fetchAbilities returns the flat global ability list with localized names.
// Newer abilities often only have an English name, those fall back to it.
func fetchAbilities() ([]Ability, error) {
	var resp struct {
		Ability []struct {
			Name         string     `json:"name"`
			AbilityNames []langName `json:"abilitynames"`
		} `json:"ability"`
	}
	q := `query{ability(order_by:{id:asc}){name ` +
		`abilitynames(where:{language:{name:{_in:` + langFilter() + `}}}){name language{name}}}}`
	if err := graphQL(q, &resp); err != nil {
		return nil, err
	}

	abilities := make([]Ability, 0, len(resp.Ability))
	for _, a := range resp.Ability {
		abilities = append(abilities, Ability{
			Named: Named{Slug: a.Name, Names: namesOf(a.AbilityNames)},
		})
	}
	return abilities, nil
}

// langFilter renders the UI locales as a GraphQL string list literal.
func langFilter() string {
	out := "["
	for i, l := range langs {
		if i > 0 {
			out += ","
		}
		out += `"` + l + `"`
	}
	return out + "]"
}
