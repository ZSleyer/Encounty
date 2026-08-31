import { describe, expect, it } from "vitest";
import type { Pokemon } from "../types";
import type { PokemonData } from "../components/pokemon/pokemonPicker";
import { buildDexIndex, type DexOverride } from "./dex";

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
    {
      id: 906,
      canonical: "sprigatito",
      names: { en: "Sprigatito" },
      forms: [{ canonical: "sprigatito-female", sprite_id: 906, gender: "female" }],
    },
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

  it("keeps a form catch off the default-form slot and lists it as a variant", () => {
    const index = buildDexIndex(
      pokedex(),
      [caught({ id: "c1", canonical_name: "vulpix-alola" })],
      "national",
      "",
    );

    const vulpix = index.entries.find((e) => e.id === 37);
    expect(vulpix?.catches.map((p) => p.id)).toEqual(["c1"]);
    expect(vulpix?.variants).toEqual(["vulpix-alola"]);
    expect(vulpix?.caught).toBe(false);
    expect(vulpix?.forms[0]).toMatchObject({ canonical: "vulpix-alola", caught: true, catchCount: 1 });
    expect(index.caught).toBe(0);
  });

  it("counts every visited evolution identity without merging form and base slots", () => {
    const evolved = caught({
      canonical_name: "bulbasaur",
      catch: { evolutions: [{ canonical_name: "vulpix-alola" }, { canonical_name: "sprigatito" }] },
    });
    const index = buildDexIndex(pokedex(), [evolved], "national", "");

    expect(index.entries.find((entry) => entry.id === 1)?.caught).toBe(true);
    const vulpix = index.entries.find((entry) => entry.id === 37);
    expect(vulpix?.caught).toBe(false);
    expect(vulpix?.forms[0].caught).toBe(true);
    expect(index.entries.find((entry) => entry.id === 906)?.caught).toBe(true);
  });

  it("counts an evolved catch only on its current stage in living dex mode", () => {
    const evolved = caught({
      canonical_name: "bulbasaur",
      catch: { evolutions: [{ canonical_name: "sprigatito" }] },
    });
    const index = buildDexIndex(pokedex(), [evolved], "national", "", undefined, [], true);

    const bulbasaur = index.entries.find((entry) => entry.id === 1);
    expect(bulbasaur?.caught).toBe(false);
    expect(bulbasaur?.seen).toBe(false);
    expect(index.entries.find((entry) => entry.id === 906)?.caught).toBe(true);
    expect(index.caught).toBe(1);
  });

  it("keeps the abandoned stages out of the variant list in living dex mode", () => {
    const evolved = caught({
      canonical_name: "vulpix-alola",
      catch: { evolutions: [{ canonical_name: "sprigatito" }] },
    });
    const index = buildDexIndex(pokedex(), [evolved], "national", "", undefined, [], true);

    expect(index.entries.find((entry) => entry.id === 37)?.variants).toEqual([]);
    expect(index.entries.find((entry) => entry.id === 906)?.variants).toEqual([]);
  });

  it("leaves the base species uncaught when the last stage is a form", () => {
    // Origin vulpix, ending on its Alolan form: the same rule that keeps an
    // Alola-only catch off the default slot applies to the evolution chain.
    const evolved = caught({
      canonical_name: "bulbasaur",
      catch: { evolutions: [{ canonical_name: "vulpix-alola" }] },
    });
    const index = buildDexIndex(pokedex(), [evolved], "national", "", undefined, [], true);

    const vulpix = index.entries.find((entry) => entry.id === 37);
    expect(vulpix?.caught).toBe(false);
    expect(vulpix?.forms[0].caught).toBe(true);
    expect(index.entries.find((entry) => entry.id === 1)?.caught).toBe(false);
  });

  it("projects a hand-entered catch and its evolution into every visited slot", () => {
    const index = buildDexIndex(pokedex(), [caught({
      id: "m1",
      canonical_name: "bulbasaur",
      entry_source: "manual",
      catch: { evolutions: [{ canonical_name: "vulpix-alola" }] },
    })], "national", "");

    expect(index.entries.find((entry) => entry.id === 1)?.caught).toBe(true);
    expect(index.entries.find((entry) => entry.id === 37)?.caught).toBe(false);
    expect(index.entries.find((entry) => entry.id === 37)?.forms[0].caught).toBe(true);
  });

  it("counts a hand-entered catch among the catches of its slot", () => {
    // The whole point of the merge: a hand-entered catch is an ordinary catch,
    // so it raises the catch count instead of only flipping the caught flag.
    const index = buildDexIndex(pokedex(), [
      caught({ id: "tracked", canonical_name: "vulpix" }),
      caught({ id: "manual", canonical_name: "vulpix", entry_source: "manual" }),
    ], "national", "");

    const vulpix = index.entries.find((entry) => entry.id === 37);
    expect(vulpix?.caught).toBe(true);
    expect(vulpix?.catches.map((entry) => entry.id).sort()).toEqual(["manual", "tracked"]);
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

  it("keeps a hand-entered catch without a game in every game view", () => {
    const manual = caught({ id: "manual", canonical_name: "vulpix", game: "", entry_source: "manual" });
    const tracked = caught({ id: "tracked", canonical_name: "bulbasaur", game: "" });
    const index = buildDexIndex(pokedex(), [manual, tracked], "game", "pokemon-scarlet", 9);

    expect(index.entries.find((entry) => entry.id === 37)?.caught).toBe(true);
    // A tracked hunt without a game stays unmatched, unchanged.
    expect(index.unmatched.map((entry) => entry.id)).toEqual(["tracked"]);
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

/** A manual override fixture; defaults to an unscoped, globally-caught row. */
function override(overrides: Partial<DexOverride> = {}): DexOverride {
  return {
    id: 1,
    speciesId: 906,
    formCanonical: "",
    gender: "",
    game: "",
    caught: true,
    seen: true,
    ...overrides,
  };
}

describe("overrides", () => {
  it("marks a slot caught from an override with no catches at all", () => {
    const index = buildDexIndex(pokedex(), [], "national", "", undefined, [
      override({ speciesId: 906 }),
    ]);

    const sprigatito = index.entries.find((e) => e.id === 906);
    expect(sprigatito?.caught).toBe(true);
    expect(sprigatito?.seen).toBe(true);
    expect(index.caught).toBe(1);
  });

  it("adds a form/gender-scoped override's canonical to variants like a real catch", () => {
    const index = buildDexIndex(pokedex(), [], "national", "", undefined, [
      override({ speciesId: 37, formCanonical: "vulpix-alola", gender: "female" }),
    ]);

    const vulpix = index.entries.find((e) => e.id === 37);
    expect(vulpix?.caught).toBe(false);
    expect(vulpix?.variants).toEqual(["vulpix-alola"]);
  });

  it("marks the female sprite variant from a base-form female override", () => {
    const index = buildDexIndex(pokedex(), [], "national", "", undefined, [
      override({ speciesId: 906, formCanonical: "", gender: "female" }),
    ]);

    expect(index.entries.find((e) => e.id === 906)?.forms).toEqual([
      { canonical: "sprigatito-female", caught: true, seen: true, catchCount: 0 },
    ]);
  });

  it("marks the female sprite variant from a base-form female catch", () => {
    const index = buildDexIndex(
      pokedex(),
      [caught({ canonical_name: "sprigatito", gender: "female" })],
      "national",
      "",
    );

    expect(index.entries.find((e) => e.id === 906)?.forms).toEqual([
      { canonical: "sprigatito-female", caught: true, seen: true, catchCount: 1 },
    ]);
  });

  it("counts a global override in national mode and in every per-game view", () => {
    const national = buildDexIndex(pokedex(), [], "national", "", undefined, [
      override({ speciesId: 906, game: "" }),
    ]);
    const gameView = buildDexIndex(pokedex(), [], "game", "pokemon-scarlet", 9, [
      override({ speciesId: 906, game: "" }),
    ]);

    expect(national.entries.find((e) => e.id === 906)?.caught).toBe(true);
    expect(gameView.entries.find((e) => e.id === 906)?.caught).toBe(true);
  });

  it("counts a game-scoped override in national mode and its own game view but not another game", () => {
    const scoped = [override({ speciesId: 906, game: "pokemon-scarlet" })];

    const national = buildDexIndex(pokedex(), [], "national", "", undefined, scoped);
    const ownGame = buildDexIndex(pokedex(), [], "game", "pokemon-scarlet", 9, scoped);
    const otherGame = buildDexIndex(pokedex(), [], "game", "pokemon-violet", 9, scoped);

    expect(national.entries.find((e) => e.id === 906)?.caught).toBe(true);
    expect(ownGame.entries.find((e) => e.id === 906)?.caught).toBe(true);
    expect(otherGame.entries.find((e) => e.id === 906)?.caught).toBe(false);
  });

  it("keeps caught implying seen even when only the caught override applies", () => {
    const index = buildDexIndex(pokedex(), [], "national", "", undefined, [
      override({ speciesId: 906, caught: true, seen: false }),
    ]);

    const sprigatito = index.entries.find((e) => e.id === 906);
    expect(sprigatito?.caught).toBe(true);
    expect(sprigatito?.seen).toBe(true);
  });

  it("does not exclude seen-only overrides from caught, but keeps them out of the caught count", () => {
    const index = buildDexIndex(pokedex(), [], "national", "", undefined, [
      override({ speciesId: 906, caught: false, seen: true }),
    ]);

    const sprigatito = index.entries.find((e) => e.id === 906);
    expect(sprigatito?.caught).toBe(false);
    expect(sprigatito?.seen).toBe(true);
    expect(index.caught).toBe(0);
  });

  it("treats an override with both flags false as a no-op", () => {
    const index = buildDexIndex(pokedex(), [], "national", "", undefined, [
      override({ speciesId: 906, caught: false, seen: false, formCanonical: "sprigatito-x" }),
    ]);

    const sprigatito = index.entries.find((e) => e.id === 906);
    expect(sprigatito?.caught).toBe(false);
    expect(sprigatito?.seen).toBe(false);
    expect(sprigatito?.variants).toEqual([]);
    expect(index.caught).toBe(0);
  });

  it("ignores an override for a species outside the current view", () => {
    const index = buildDexIndex(pokedex(), [], "national", "", undefined, [
      override({ speciesId: 9999 }),
    ]);

    expect(index.caught).toBe(0);
  });

  it("leaves an existing real catch's caught state alone when an override targets a different species", () => {
    const index = buildDexIndex(
      pokedex(),
      [caught({ id: "c1", canonical_name: "bulbasaur" })],
      "national",
      "",
      undefined,
      [override({ speciesId: 906 })],
    );

    expect(index.entries.find((e) => e.id === 1)?.caught).toBe(true);
    expect(index.entries.find((e) => e.id === 906)?.caught).toBe(true);
    expect(index.caught).toBe(2);
  });

  it("keeps a failed attempt out of the catch count while still listing it", () => {
    const index = buildDexIndex(
      pokedex(),
      [
        caught({ id: "c1", canonical_name: "bulbasaur" }),
        caught({ id: "c2", canonical_name: "bulbasaur", failed: true }),
      ],
      "national",
      "",
    );

    const bulbasaur = index.entries.find((e) => e.id === 1);
    expect(bulbasaur?.baseCatchCount).toBe(1);
    expect(bulbasaur?.catches).toHaveLength(2);
    expect(bulbasaur?.caught).toBe(true);
    expect(bulbasaur?.seen).toBe(true);
  });

  it("keeps a failed attempt out of a form's catch count", () => {
    const index = buildDexIndex(
      pokedex(),
      [
        caught({ id: "c1", canonical_name: "vulpix-alola" }),
        caught({ id: "c2", canonical_name: "vulpix-alola", failed: true }),
      ],
      "national",
      "",
    );

    const form = index.entries.find((e) => e.id === 37)?.forms[0];
    expect(form?.catchCount).toBe(1);
    expect(form?.caught).toBe(true);
    expect(form?.seen).toBe(true);
  });

  it("marks a species seen but not caught when every attempt on it failed", () => {
    const index = buildDexIndex(
      pokedex(),
      [caught({ id: "c1", canonical_name: "bulbasaur", failed: true })],
      "national",
      "",
    );

    const bulbasaur = index.entries.find((e) => e.id === 1);
    expect(bulbasaur?.baseCatchCount).toBe(0);
    expect(bulbasaur?.caught).toBe(false);
    expect(bulbasaur?.seen).toBe(true);
    expect(index.caught).toBe(0);
  });
});
