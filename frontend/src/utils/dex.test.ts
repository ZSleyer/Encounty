import { describe, expect, it } from "vitest";
import type { Pokemon } from "../types";
import type { PokemonData } from "../components/pokemon/pokemonPicker";
import { buildDexIndex } from "./dex";

/** Three-species pokedex with one regional form on Vulpix. */
function pokedex(): PokemonData[] {
  return [
    { id: 1, canonical: "bulbasaur", names: { en: "Bulbasaur", de: "Bisasam" } },
    {
      id: 37,
      canonical: "vulpix",
      names: { en: "Vulpix", de: "Vulpix" },
      forms: [{ canonical: "vulpix-alola", sprite_id: 10103 }],
    },
    { id: 906, canonical: "sprigatito", names: { en: "Sprigatito" } },
  ];
}

/** Dense 1025-species pokedex; only the ids matter for the generation caps. */
function fullPokedex(): PokemonData[] {
  return Array.from({ length: 1025 }, (_, i) => ({
    id: i + 1,
    canonical: `species-${i + 1}`,
    names: { en: `Species ${i + 1}` },
  }));
}

function pokemon(overrides: Partial<Pokemon> = {}): Pokemon {
  return {
    id: "p1",
    name: "Bisasam",
    canonical_name: "bulbasaur",
    sprite_url: "",
    sprite_type: "shiny",
    encounters: 0,
    is_active: false,
    created_at: "2026-01-01T00:00:00Z",
    language: "en",
    game: "pokemon-scarlet",
    overlay_mode: "default",
    ...overrides,
  };
}

/** A completed catch, which is the only kind the index counts. */
function caught(overrides: Partial<Pokemon> = {}): Pokemon {
  return pokemon({ completed_at: "2026-02-01T00:00:00Z", ...overrides });
}

describe("buildDexIndex", () => {
  it("renders one slot per species regardless of catches", () => {
    const index = buildDexIndex(pokedex(), [], "national", "");

    expect(index.entries).toHaveLength(3);
    expect(index.entries.map((e) => e.id)).toEqual([1, 37, 906]);
    expect(index.total).toBe(3);
    expect(index.caught).toBe(0);
    expect(index.unmatched).toEqual([]);
  });

  it("derives the generation from the dex number", () => {
    const index = buildDexIndex(pokedex(), [], "national", "");

    expect(index.entries.map((e) => e.generation)).toEqual([1, 1, 9]);
  });

  it("resolves a form catch onto its species slot and lists it as a variant", () => {
    const index = buildDexIndex(
      pokedex(),
      [caught({ id: "c1", canonical_name: "vulpix-alola" })],
      "national",
      "",
    );

    const vulpix = index.entries.find((e) => e.id === 37);
    expect(vulpix?.catches.map((p) => p.id)).toEqual(["c1"]);
    expect(vulpix?.variants).toEqual(["vulpix-alola"]);
    expect(index.caught).toBe(1);
  });

  it("keeps the default form out of the variant list", () => {
    const index = buildDexIndex(
      pokedex(),
      [caught({ id: "c1", canonical_name: "vulpix" })],
      "national",
      "",
    );

    expect(index.entries.find((e) => e.id === 37)?.variants).toEqual([]);
  });

  it("collapses several catches onto one slot, newest completion first", () => {
    const index = buildDexIndex(
      pokedex(),
      [
        caught({ id: "old", canonical_name: "vulpix", completed_at: "2026-01-01T00:00:00Z" }),
        caught({ id: "new", canonical_name: "vulpix-alola", completed_at: "2026-03-01T00:00:00Z" }),
        caught({ id: "mid", canonical_name: "vulpix", completed_at: "2026-02-01T00:00:00Z" }),
      ],
      "national",
      "",
    );

    const vulpix = index.entries.find((e) => e.id === 37);
    expect(vulpix?.catches.map((p) => p.id)).toEqual(["new", "mid", "old"]);
    // One slot, one caught species, no matter how many catches sit on it.
    expect(index.caught).toBe(1);
  });

  it("counts finished phase children", () => {
    const index = buildDexIndex(
      pokedex(),
      [
        pokemon({ id: "hunt", canonical_name: "sprigatito" }),
        caught({ id: "phase1", canonical_name: "vulpix", phase_of: "hunt", phase_number: 1 }),
      ],
      "national",
      "",
    );

    expect(index.entries.find((e) => e.id === 37)?.catches.map((p) => p.id)).toEqual(["phase1"]);
    expect(index.caught).toBe(1);
  });

  it("ignores active hunts", () => {
    const index = buildDexIndex(
      pokedex(),
      [pokemon({ id: "running", canonical_name: "bulbasaur", is_active: true })],
      "national",
      "",
    );

    expect(index.caught).toBe(0);
    expect(index.entries.every((e) => e.catches.length === 0)).toBe(true);
    expect(index.unmatched).toEqual([]);
  });

  it("filters by game while still rendering every slot the cap allows", () => {
    const index = buildDexIndex(
      pokedex(),
      [
        caught({ id: "scarlet", canonical_name: "bulbasaur", game: "pokemon-scarlet" }),
        caught({ id: "violet", canonical_name: "vulpix", game: "pokemon-violet" }),
      ],
      "game",
      "pokemon-scarlet",
      9,
    );

    expect(index.entries).toHaveLength(3);
    expect(index.total).toBe(3);
    expect(index.caught).toBe(1);
    expect(index.entries.find((e) => e.id === 1)?.catches.map((p) => p.id)).toEqual(["scarlet"]);
    expect(index.entries.find((e) => e.id === 37)?.catches).toEqual([]);
    expect(index.unmatched).toEqual([]);
  });

  it("puts an unresolvable canonical into unmatched instead of throwing", () => {
    const stray = caught({ id: "stray", canonical_name: "missingno" });
    const index = buildDexIndex(pokedex(), [stray], "national", "");

    expect(index.unmatched).toEqual([stray]);
    expect(index.caught).toBe(0);
  });

  it("puts a catch without a game into unmatched in game mode", () => {
    const gameless = caught({ id: "gameless", canonical_name: "bulbasaur", game: "" });
    const index = buildDexIndex(pokedex(), [gameless], "game", "pokemon-scarlet");

    expect(index.unmatched).toEqual([gameless]);
    expect(index.caught).toBe(0);
  });

  it("keeps a catch without a game in national mode", () => {
    const gameless = caught({ id: "gameless", canonical_name: "bulbasaur", game: "" });
    const index = buildDexIndex(pokedex(), [gameless], "national", "");

    expect(index.unmatched).toEqual([]);
    expect(index.caught).toBe(1);
  });

  it("resolves species that are missing from a partially synced pokedex", () => {
    // Gap in the middle: slot 906 must stay reachable even though 2..905
    // were never synced.
    const index = buildDexIndex(
      pokedex(),
      [caught({ id: "c1", canonical_name: "sprigatito" })],
      "national",
      "",
    );

    expect(index.entries.find((e) => e.id === 906)?.catches.map((p) => p.id)).toEqual(["c1"]);
  });

  it("caps game mode at the National Dex of the game's generation", () => {
    const gen1 = buildDexIndex(fullPokedex(), [], "game", "pokemon-red", 1);
    const gen3 = buildDexIndex(fullPokedex(), [], "game", "pokemon-ruby", 3);

    expect(gen1.entries).toHaveLength(151);
    expect(gen1.total).toBe(151);
    expect(gen1.entries[gen1.entries.length - 1].id).toBe(151);
    expect(gen3.entries).toHaveLength(386);
    expect(gen3.total).toBe(386);
  });

  it("renders the full dex for the newest generation", () => {
    const index = buildDexIndex(fullPokedex(), [], "game", "pokemon-scarlet", 9);

    expect(index.entries).toHaveLength(1025);
    expect(index.total).toBe(1025);
  });

  it("falls back to the full dex for a generation without a known cap", () => {
    const index = buildDexIndex(fullPokedex(), [], "game", "pokemon-winds", 10);

    expect(index.entries).toHaveLength(1025);
    expect(index.total).toBe(1025);
  });

  it("ignores the generation in national mode", () => {
    const index = buildDexIndex(fullPokedex(), [], "national", "pokemon-red", 1);

    expect(index.entries).toHaveLength(1025);
    expect(index.total).toBe(1025);
  });

  it("moves a catch above the cap into unmatched instead of dropping it", () => {
    // A gen 5 species carried into a gen 1 game, which trades and transfers
    // make possible in the archive.
    const transferred = caught({
      id: "transferred",
      canonical_name: "species-649",
      game: "pokemon-red",
    });
    const index = buildDexIndex(fullPokedex(), [transferred], "game", "pokemon-red", 1);

    expect(index.unmatched).toEqual([transferred]);
    expect(index.caught).toBe(0);
    expect(index.total).toBe(151);
  });

  it("leaves both inputs untouched", () => {
    const dex = pokedex();
    const entries = [
      caught({ id: "b", completed_at: "2026-01-01T00:00:00Z" }),
      caught({ id: "a", completed_at: "2026-03-01T00:00:00Z" }),
    ];
    const dexSnapshot = structuredClone(dex);
    const entriesSnapshot = structuredClone(entries);

    buildDexIndex(dex, entries, "national", "");

    expect(dex).toEqual(dexSnapshot);
    expect(entries).toEqual(entriesSnapshot);
  });
});
