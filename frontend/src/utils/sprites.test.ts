import { describe, it, expect } from "vitest";
import {
  getSpriteUrl,
  isSpriteStyleAvailable,
  bestAvailableStyle,
  SPRITE_STYLES,
} from "./sprites";

const POKEAPI_BASE =
  "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";
const SHOWDOWN_BASE = "https://play.pokemonshowdown.com/sprites";
const POKESPRITE_BASE =
  "https://raw.githubusercontent.com/msikma/pokesprite/master/pokemon-gen8";

describe("getSpriteUrl", () => {
  describe("animated style", () => {
    it("returns shiny Showdown GIF when shiny", () => {
      const url = getSpriteUrl(25, "pokemon-red", "shiny", "animated", "pikachu");
      expect(url).toBe(`${SHOWDOWN_BASE}/ani-shiny/pikachu.gif`);
    });

    it("returns normal Showdown GIF when not shiny", () => {
      const url = getSpriteUrl(25, "pokemon-red", "normal", "animated", "pikachu");
      expect(url).toBe(`${SHOWDOWN_BASE}/ani/pikachu.gif`);
    });

    it("falls back to numeric ID when no canonical name given", () => {
      const url = getSpriteUrl(25, "pokemon-red", "shiny", "animated");
      expect(url).toBe(`${SHOWDOWN_BASE}/ani-shiny/25.gif`);
    });
  });

  describe("3d style", () => {
    it("returns shiny Home 3D URL", () => {
      const url = getSpriteUrl(6, "pokemon-red", "shiny", "3d");
      expect(url).toBe(`${POKEAPI_BASE}/other/home/shiny/6.png`);
    });

    it("returns normal Home 3D URL", () => {
      const url = getSpriteUrl(6, "pokemon-red", "normal", "3d");
      expect(url).toBe(`${POKEAPI_BASE}/other/home/6.png`);
    });
  });

  describe("artwork style", () => {
    it("returns shiny official artwork URL", () => {
      const url = getSpriteUrl(1, "pokemon-red", "shiny", "artwork");
      expect(url).toBe(`${POKEAPI_BASE}/other/official-artwork/shiny/1.png`);
    });

    it("returns normal official artwork URL", () => {
      const url = getSpriteUrl(1, "pokemon-red", "normal", "artwork");
      expect(url).toBe(`${POKEAPI_BASE}/other/official-artwork/1.png`);
    });
  });

  describe("box style (legacy fallback) — Gen 1", () => {
    it("returns Gen 1 red/blue sprite (ignores shiny flag)", () => {
      const url = getSpriteUrl(25, "pokemon-red", "shiny", "box");
      expect(url).toBe(
        `${POKEAPI_BASE}/versions/generation-i/red-blue/transparent/25.png`,
      );
    });

    it("returns Gen 1 yellow sprite", () => {
      const url = getSpriteUrl(25, "pokemon-yellow", "shiny", "box");
      expect(url).toBe(
        `${POKEAPI_BASE}/versions/generation-i/yellow/transparent/25.png`,
      );
    });

    it("does not match firered as Gen 1 red", () => {
      const url = getSpriteUrl(25, "pokemon-firered", "shiny", "box");
      expect(url).toContain("generation-iii/firered-leafgreen");
    });
  });

  describe("box style (legacy fallback) — Gen 2", () => {
    it("returns crystal sprite with shiny subfolder", () => {
      const url = getSpriteUrl(25, "pokemon-crystal", "shiny", "box");
      expect(url).toBe(
        `${POKEAPI_BASE}/versions/generation-ii/crystal/transparent/shiny/25.png`,
      );
    });

    it("returns gold sprite (normal)", () => {
      const url = getSpriteUrl(25, "pokemon-gold", "normal", "box");
      expect(url).toBe(
        `${POKEAPI_BASE}/versions/generation-ii/gold/transparent/25.png`,
      );
    });

    it("does not match heartgold as Gen 2 gold", () => {
      const url = getSpriteUrl(25, "pokemon-heartgold", "shiny", "box");
      expect(url).toContain("generation-iv/heartgold-soulsilver");
    });

    it("returns silver sprite (normal)", () => {
      const url = getSpriteUrl(25, "pokemon-silver", "normal", "box");
      expect(url).toBe(
        `${POKEAPI_BASE}/versions/generation-ii/silver/transparent/25.png`,
      );
    });

    it("returns silver sprite (shiny)", () => {
      const url = getSpriteUrl(25, "pokemon-silver", "shiny", "box");
      expect(url).toBe(
        `${POKEAPI_BASE}/versions/generation-ii/silver/transparent/shiny/25.png`,
      );
    });

    it("does not match soulsilver as Gen 2 silver", () => {
      const url = getSpriteUrl(25, "pokemon-soulsilver", "shiny", "box");
      expect(url).toContain("generation-iv/heartgold-soulsilver");
    });
  });

  describe("box style (legacy fallback) — Gen 3", () => {
    it("returns emerald sprite", () => {
      const url = getSpriteUrl(25, "pokemon-emerald", "shiny", "box");
      expect(url).toBe(
        `${POKEAPI_BASE}/versions/generation-iii/emerald/shiny/25.png`,
      );
    });

    it("returns firered/leafgreen sprite", () => {
      const url = getSpriteUrl(25, "pokemon-leafgreen", "normal", "box");
      expect(url).toBe(
        `${POKEAPI_BASE}/versions/generation-iii/firered-leafgreen/25.png`,
      );
    });

    it("returns ruby-sapphire sprite for ruby", () => {
      const url = getSpriteUrl(25, "pokemon-ruby", "shiny", "box");
      expect(url).toBe(
        `${POKEAPI_BASE}/versions/generation-iii/ruby-sapphire/shiny/25.png`,
      );
    });

    it("does not match omega-ruby as Gen 3 ruby", () => {
      const url = getSpriteUrl(25, "pokemon-omega-ruby", "shiny", "box");
      // Should fall through to Gen 6+ default (Showdown dex)
      expect(url).toContain(SHOWDOWN_BASE);
    });

    it("returns sapphire sprite (normal)", () => {
      const url = getSpriteUrl(25, "pokemon-sapphire", "normal", "box");
      expect(url).toBe(
        `${POKEAPI_BASE}/versions/generation-iii/ruby-sapphire/25.png`,
      );
    });

    it("returns sapphire sprite (shiny)", () => {
      const url = getSpriteUrl(25, "pokemon-sapphire", "shiny", "box");
      expect(url).toBe(
        `${POKEAPI_BASE}/versions/generation-iii/ruby-sapphire/shiny/25.png`,
      );
    });

    it("does not match alpha-sapphire as Gen 3 sapphire", () => {
      const url = getSpriteUrl(25, "pokemon-alpha-sapphire", "shiny", "box");
      expect(url).toContain(SHOWDOWN_BASE);
    });
  });

  describe("box style (legacy fallback) — Gen 4", () => {
    it("returns diamond-pearl sprite", () => {
      const url = getSpriteUrl(25, "pokemon-diamond", "shiny", "box");
      expect(url).toBe(
        `${POKEAPI_BASE}/versions/generation-iv/diamond-pearl/shiny/25.png`,
      );
    });

    it("returns platinum sprite", () => {
      const url = getSpriteUrl(25, "pokemon-platinum", "normal", "box");
      expect(url).toBe(
        `${POKEAPI_BASE}/versions/generation-iv/platinum/25.png`,
      );
    });

    it("returns heartgold-soulsilver sprite", () => {
      const url = getSpriteUrl(25, "pokemon-soulsilver", "shiny", "box");
      expect(url).toBe(
        `${POKEAPI_BASE}/versions/generation-iv/heartgold-soulsilver/shiny/25.png`,
      );
    });

    it("handles BDSP — shiny uses pokesprite box sprite", () => {
      const url = getSpriteUrl(25, "pokemon-brilliant-diamond", "shiny", "box", "pikachu");
      expect(url).toBe(`${POKESPRITE_BASE}/shiny/pikachu.png`);
    });

    it("handles BDSP — normal uses Gen VIII path", () => {
      const url = getSpriteUrl(25, "pokemon-brilliant-diamond", "normal", "box");
      expect(url).toBe(
        `${POKEAPI_BASE}/versions/generation-viii/brilliant-diamond-shining-pearl/25.png`,
      );
    });
  });

  describe("box style (legacy fallback) — Gen 5", () => {
    it("returns animated black-white sprite (gif)", () => {
      const url = getSpriteUrl(25, "pokemon-black", "shiny", "box");
      expect(url).toBe(
        `${POKEAPI_BASE}/versions/generation-v/black-white/animated/shiny/25.gif`,
      );
    });
  });

  describe("box style — Gen 6+ uses pokesprite", () => {
    it("returns pokesprite box sprite for gen6+ games (shiny)", () => {
      const url = getSpriteUrl(25, "pokemon-x", "shiny", "box", "pikachu");
      expect(url).toBe(`${POKESPRITE_BASE}/shiny/pikachu.png`);
    });

    it("returns pokesprite box sprite for gen6+ games (normal)", () => {
      const url = getSpriteUrl(25, "pokemon-x", "normal", "box", "pikachu");
      expect(url).toBe(`${POKESPRITE_BASE}/regular/pikachu.png`);
    });
  });

  describe("regional forms", () => {
    it("resolves Alolan Vulpix to correct PokeAPI ID via canonical name", () => {
      const url = getSpriteUrl(37, "pokemon-sun", "shiny", "3d", "vulpix-alola");
      expect(url).toBe(`${POKEAPI_BASE}/other/home/shiny/10103.png`);
    });

    it("resolves Galarian Ponyta ID", () => {
      const url = getSpriteUrl(77, "pokemon-sword", "normal", "artwork", "ponyta-galar");
      expect(url).toBe(`${POKEAPI_BASE}/other/official-artwork/10162.png`);
    });

    it("box style uses pokesprite for regional forms (shiny)", () => {
      const url = getSpriteUrl(37, "pokemon-red", "shiny", "box", "vulpix-alola");
      expect(url).toBe(`${POKESPRITE_BASE}/shiny/vulpix-alola.png`);
    });

    it("box style uses pokesprite for regional forms (normal)", () => {
      const url = getSpriteUrl(37, "pokemon-red", "normal", "box", "vulpix-alola");
      expect(url).toBe(`${POKESPRITE_BASE}/regular/vulpix-alola.png`);
    });
  });
});

describe("isSpriteStyleAvailable", () => {
  it("returns true for box in Gen 1-8", () => {
    for (const gen of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(isSpriteStyleAvailable("box", gen)).toBe(true);
    }
    expect(isSpriteStyleAvailable("box", 9)).toBe(false);
  });

  it("returns true for animated/3d/artwork for any generation", () => {
    for (const style of ["animated", "3d", "artwork"] as const) {
      expect(isSpriteStyleAvailable(style, 1)).toBe(true);
      expect(isSpriteStyleAvailable(style, 9)).toBe(true);
    }
  });

  it("returns true for all styles when generation is null or undefined", () => {
    for (const style of ["box", "animated", "3d", "artwork"] as const) {
      expect(isSpriteStyleAvailable(style, null)).toBe(true);
      expect(isSpriteStyleAvailable(style, undefined)).toBe(true);
    }
  });

  it("returns false for an unknown style", () => {
    expect(isSpriteStyleAvailable("unknown" as never, 1)).toBe(false);
  });
});

describe("bestAvailableStyle", () => {
  it("returns the preferred style when available", () => {
    expect(bestAvailableStyle("box", 3)).toBe("box");
    expect(bestAvailableStyle("animated", 9)).toBe("animated");
  });

  it("returns box for any generation since box is always available", () => {
    expect(bestAvailableStyle("box", 6)).toBe("box");
  });

  it("returns preferred for null generation", () => {
    expect(bestAvailableStyle("box", null)).toBe("box");
  });
});

describe("SPRITE_STYLES", () => {
  it("has exactly 5 entries", () => {
    expect(SPRITE_STYLES).toHaveLength(5);
  });

  it("contains all expected keys", () => {
    const keys = SPRITE_STYLES.map((s) => s.key);
    expect(keys).toEqual(["box", "animated", "3d", "artwork", "classic"]);
  });
});
