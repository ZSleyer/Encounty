import { describe, it, expect } from "vitest";
import {
  NON_PHASING_METHODS,
  getAvailableHuntMethods,
  isPhasingMethod,
} from "./huntTypes";
import { GAME_GROUPS } from "./gameGroups";
import de from "../locales/de.json";

describe("hunt method localization", () => {
  it("every offered method has a label in the reference locale", () => {
    const seen = new Set<string>();
    const missing = new Set<string>();
    for (const group of GAME_GROUPS) {
      for (const gameKey of group.gameKeys) {
        for (const { key } of getAvailableHuntMethods(gameKey)) {
          seen.add(key);
          if (!(`huntType.${key}` in de)) missing.add(key);
        }
      }
    }
    expect([...missing]).toEqual([]);
    // Guard against the loop silently covering nothing.
    expect(seen.size).toBeGreaterThan(50);
  });
});

describe("getAvailableHuntMethods", () => {
  it("returns only universal methods when game key is null", () => {
    const keys = getAvailableHuntMethods(null).map((m) => m.key);
    expect(keys).toEqual(["encounter", "soft_reset"]);
  });

  it("returns only universal methods when game key is undefined", () => {
    const keys = getAvailableHuntMethods(undefined).map((m) => m.key);
    expect(keys).toEqual(["encounter", "soft_reset"]);
  });

  it("gen 1 includes fishing but excludes encounter, safari_zone and masuda", () => {
    const keys = getAvailableHuntMethods("pokemon-red").map((m) => m.key);
    expect(keys).toContain("soft_reset");
    expect(keys).toContain("fishing");
    expect(keys).not.toContain("encounter");
    expect(keys).not.toContain("safari_zone");
    expect(keys).not.toContain("masuda");
  });

  it("gen 4 DPPt includes masuda and radar", () => {
    const keys = getAvailableHuntMethods("pokemon-diamond").map((m) => m.key);
    expect(keys).toContain("masuda");
    expect(keys).toContain("radar");
    expect(keys).toContain("honey_tree");
  });

  it("gen 4 HGSS includes headbutt but not radar", () => {
    const keys = getAvailableHuntMethods("pokemon-heartgold").map((m) => m.key);
    expect(keys).toContain("headbutt");
    expect(keys).not.toContain("radar");
  });

  it("gen 6 XY includes horde, chain_fishing, friend_safari but not dexnav", () => {
    const keys = getAvailableHuntMethods("pokemon-x").map((m) => m.key);
    expect(keys).toContain("horde");
    expect(keys).toContain("chain_fishing");
    expect(keys).toContain("friend_safari");
    expect(keys).not.toContain("dexnav");
  });

  it("gen 6 ORAS includes dexnav and soaring but not friend_safari", () => {
    const keys = getAvailableHuntMethods("pokemon-omega-ruby").map((m) => m.key);
    expect(keys).toContain("dexnav");
    expect(keys).toContain("soaring");
    expect(keys).not.toContain("friend_safari");
  });

  it("gen 7 SM includes sos but excludes ultra_wormhole", () => {
    const keys = getAvailableHuntMethods("pokemon-sun").map((m) => m.key);
    expect(keys).toContain("sos");
    expect(keys).not.toContain("ultra_wormhole");
  });

  it("gen 7 USUM includes ultra_wormhole", () => {
    const keys = getAvailableHuntMethods("pokemon-ultra-sun").map((m) => m.key);
    expect(keys).toContain("ultra_wormhole");
  });

  it("gen 7 LGPE includes catch_combo but not sos", () => {
    const keys = getAvailableHuntMethods("pokemon-lets-go-pikachu").map((m) => m.key);
    expect(keys).toContain("catch_combo");
    expect(keys).not.toContain("sos");
  });

  it("gen 8 SwSh includes dynamax_adventure and battle_method", () => {
    const keys = getAvailableHuntMethods("pokemon-sword").map((m) => m.key);
    expect(keys).toContain("dynamax_adventure");
    expect(keys).toContain("battle_method");
  });

  it("gen 8 PLA includes outbreak variants and massive outbreaks", () => {
    const keys = getAvailableHuntMethods("pokemon-legends-arceus").map((m) => m.key);
    expect(keys).toContain("outbreak");
    expect(keys).toContain("outbreak_lv10");
    expect(keys).toContain("outbreak_perfect");
    expect(keys).toContain("massive_outbreak");
  });

  it("gen 9 SV includes sandwich_sp1/2/3 and tera_raid", () => {
    const keys = getAvailableHuntMethods("pokemon-scarlet").map((m) => m.key);
    expect(keys).toContain("sandwich_sp1");
    expect(keys).toContain("sandwich_sp2");
    expect(keys).toContain("sandwich_sp3");
    expect(keys).toContain("tera_raid");
  });

  it("gen 9 ZA includes sparkling_power levels", () => {
    const keys = getAvailableHuntMethods("pokemon-legends-za").map((m) => m.key);
    expect(keys).toContain("sparkling_power_lv1");
    expect(keys).toContain("sparkling_power_lv2");
    expect(keys).toContain("sparkling_power_lv3");
  });

  it("includes encounter and soft_reset for every game that has both", () => {
    for (const gameKey of ["pokemon-gold", "pokemon-diamond", "pokemon-x", "pokemon-sword", "pokemon-scarlet"]) {
      const keys = getAvailableHuntMethods(gameKey).map((m) => m.key);
      expect(keys).toContain("encounter");
      expect(keys).toContain("soft_reset");
    }
  });
});

describe("isPhasingMethod", () => {
  it("denies exactly the nine single-species methods", () => {
    expect([...NON_PHASING_METHODS].sort()).toEqual([
      "breeding",
      "colosseum_bonus_disc",
      "dv_breeding",
      "fossil",
      "masuda",
      "max_raid",
      "picnic_breeding",
      "soft_reset",
      "tera_raid",
    ]);
    for (const key of NON_PHASING_METHODS) {
      expect(isPhasingMethod(key)).toBe(false);
    }
  });

  it("allows methods whose pool holds more than one species", () => {
    for (const key of [
      "encounter",
      "fishing",
      "radar",
      "horde",
      "sos",
      "odd_egg",
      "dexnav",
      "outbreak",
      "massive_outbreak",
      "island_scan",
      "dynamax_adventure",
    ]) {
      expect(isPhasingMethod(key)).toBe(true);
    }
  });

  it("falls back to encounter for a missing hunt type", () => {
    expect(isPhasingMethod(undefined)).toBe(true);
    expect(isPhasingMethod(null)).toBe(true);
    expect(isPhasingMethod("")).toBe(true);
  });

  it("treats an unknown future method as phaseable", () => {
    expect(isPhasingMethod("some_new_method")).toBe(true);
  });

  it("only denies keys that games actually offer", () => {
    const offered = new Set<string>();
    for (const group of GAME_GROUPS) {
      for (const gameKey of group.gameKeys) {
        for (const { key } of getAvailableHuntMethods(gameKey)) offered.add(key);
      }
    }
    const unknown = [...NON_PHASING_METHODS].filter((k) => !offered.has(k));
    expect(unknown).toEqual([]);
  });
});
