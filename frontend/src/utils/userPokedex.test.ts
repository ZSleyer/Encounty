import { describe, expect, it } from "vitest";
import { DEFAULT_POKEDEX, formCategory, speciesInPokedex } from "./userPokedex";

describe("user Pokédex scopes", () => {
  it("starts with every species and form category enabled", () => {
    expect(speciesInPokedex({ id: 1025, canonical: "pecharunt" }, DEFAULT_POKEDEX, [])).toBe(true);
    expect(DEFAULT_POKEDEX.show_forms).toBe(true);
    expect(DEFAULT_POKEDEX.form_categories).toHaveLength(6);
  });

  it("combines generations with manual includes and excludes", () => {
    const dex = {
      ...DEFAULT_POKEDEX,
      generations: [1],
      include_species: [252],
      exclude_species: [25],
    };
    expect(speciesInPokedex({ id: 1, canonical: "bulbasaur" }, dex, [])).toBe(true);
    expect(speciesInPokedex({ id: 25, canonical: "pikachu" }, dex, [])).toBe(false);
    expect(speciesInPokedex({ id: 252, canonical: "treecko" }, dex, [])).toBe(true);
    expect(speciesInPokedex({ id: 253, canonical: "grovyle" }, dex, [])).toBe(false);
  });

  it("classifies supported form groups", () => {
    expect(formCategory({ canonical: "charizard-mega-x", sprite_id: 10034 })).toBe("mega");
    expect(formCategory({ canonical: "wooper-paldea", sprite_id: 10253 })).toBe("regional");
    expect(formCategory({ canonical: "pikachu-female", sprite_id: 25, gender: "female" })).toBe(
      "gender",
    );
  });

  it("maps every species id range to its generation", () => {
    const ranges = [
      [1, 151],
      [152, 251],
      [252, 386],
      [387, 493],
      [494, 649],
      [650, 721],
      [722, 809],
      [810, 905],
      [906, 1025],
    ] as const;
    const inGeneration = (id: number, generation: number) =>
      speciesInPokedex(
        { id, canonical: `species-${id}` },
        { ...DEFAULT_POKEDEX, generations: [generation] },
        [],
      );
    ranges.forEach(([first, last], index) => {
      const generation = index + 1;
      expect(inGeneration(first, generation)).toBe(true);
      expect(inGeneration(last, generation)).toBe(true);
      if (first > 1) expect(inGeneration(first - 1, generation)).toBe(false);
      // The newest generation has no upper bound yet, so its last id has no neighbour above.
      if (index < ranges.length - 1) expect(inGeneration(last + 1, generation)).toBe(false);
    });
    expect(inGeneration(9999, 9)).toBe(true);
  });

  it("uses exact game catalogues instead of generation ranges", () => {
    const dex = { ...DEFAULT_POKEDEX, target_games: ["pokemon-red"] };
    expect(
      speciesInPokedex({ id: 25, canonical: "pikachu", games: ["pokemon-red"] }, dex, []),
    ).toBe(true);
    expect(speciesInPokedex({ id: 151, canonical: "mew", games: [] }, dex, [])).toBe(false);
  });
});
