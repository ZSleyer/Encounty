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

  it("uses exact game catalogues instead of generation ranges", () => {
    const dex = { ...DEFAULT_POKEDEX, target_games: ["pokemon-red"] };
    expect(
      speciesInPokedex({ id: 25, canonical: "pikachu", games: ["pokemon-red"] }, dex, []),
    ).toBe(true);
    expect(speciesInPokedex({ id: 151, canonical: "mew", games: [] }, dex, [])).toBe(false);
  });
});
