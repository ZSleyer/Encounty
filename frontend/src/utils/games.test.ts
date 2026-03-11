import { describe, it, expect } from "vitest";
import { getGameName, ALL_LANGUAGES } from "./games";
import type { GameEntry } from "../types";

function makeGame(names: Record<string, string>, key = "pokemon-red"): GameEntry {
  return { key, names, generation: 1, platform: "gb" };
}

describe("getGameName", () => {
  it("returns exact language match", () => {
    const game = makeGame({ de: "Pokémon Rot", en: "Pokémon Red" });
    expect(getGameName(game, ["de"])).toBe("Pokémon Rot");
  });

  it("tries languages in priority order", () => {
    const game = makeGame({ fr: "Pokémon Rouge", en: "Pokémon Red" });
    // de is not available, should skip to en
    expect(getGameName(game, ["de", "en"])).toBe("Pokémon Red");
  });

  it("uses fallback chain: es-es falls back to es", () => {
    const game = makeGame({ es: "Pokémon Rojo" });
    expect(getGameName(game, ["es-es"])).toBe("Pokémon Rojo");
  });

  it("uses fallback chain: es-419 falls back to es", () => {
    const game = makeGame({ es: "Pokémon Rojo" });
    expect(getGameName(game, ["es-419"])).toBe("Pokémon Rojo");
  });

  it("uses fallback chain: pt-br falls back to pt", () => {
    const game = makeGame({ pt: "Pokémon Vermelho" });
    expect(getGameName(game, ["pt-br"])).toBe("Pokémon Vermelho");
  });

  it("uses fallback chain: zh-hant falls back to zh-hans", () => {
    const game = makeGame({ "zh-hans": "宝可梦 红" });
    expect(getGameName(game, ["zh-hant"])).toBe("宝可梦 红");
  });

  it("prefers exact match over fallback", () => {
    const game = makeGame({ "es-es": "Español España", es: "Español genérico" });
    expect(getGameName(game, ["es-es"])).toBe("Español España");
  });

  it("falls back to English when no language matches", () => {
    const game = makeGame({ en: "Pokémon Red", ja: "ポケモン赤" });
    expect(getGameName(game, ["ko"])).toBe("Pokémon Red");
  });

  it("falls back to first available name when no English either", () => {
    const game = makeGame({ ja: "ポケモン赤" });
    expect(getGameName(game, ["ko"])).toBe("ポケモン赤");
  });

  it("falls back to key when names object is empty", () => {
    const game = makeGame({}, "pokemon-mystery");
    expect(getGameName(game, ["en"])).toBe("pokemon-mystery");
  });

  it("handles empty languages array by falling back to English", () => {
    const game = makeGame({ en: "Pokémon Red" });
    expect(getGameName(game, [])).toBe("Pokémon Red");
  });
});

describe("ALL_LANGUAGES", () => {
  it("has 11 language entries", () => {
    expect(ALL_LANGUAGES).toHaveLength(11);
  });

  it("every entry has code, label, and flag", () => {
    for (const lang of ALL_LANGUAGES) {
      expect(lang.code).toBeTruthy();
      expect(lang.label).toBeTruthy();
      expect(lang.flag).toBeTruthy();
    }
  });

  it("contains all expected language codes", () => {
    const codes = ALL_LANGUAGES.map((l) => l.code);
    expect(codes).toContain("de");
    expect(codes).toContain("en");
    expect(codes).toContain("ja");
    expect(codes).toContain("zh-hans");
    expect(codes).toContain("zh-hant");
  });

  it("has unique codes", () => {
    const codes = ALL_LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
