// pokeapi.go fetches natures, balls and abilities from the PokeAPI GraphQL
// endpoint.
package main

import (
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
			Named:       Named{Slug: b.Name, Names: namesOf(b.ItemNames)},
			Generations: gens,
		})
	}
	return balls, nil
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
