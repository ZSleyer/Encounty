import { describe, it, expect } from "vitest";
import { ALL_HUNT_METHOD_KEYS, getAvailableHuntMethods } from "./huntTypes";

describe("ALL_HUNT_METHOD_KEYS", () => {
  it("has at least 60 entries", () => {
    expect(ALL_HUNT_METHOD_KEYS.length).toBeGreaterThanOrEqual(60);
  });

  it("every key is a non-empty string", () => {
    for (const key of ALL_HUNT_METHOD_KEYS) {
      expect(key).toBeTruthy();
      expect(typeof key).toBe("string");
    }
  });

  it("contains no duplicates", () => {
    const unique = new Set(ALL_HUNT_METHOD_KEYS);
    expect(unique.size).toBe(ALL_HUNT_METHOD_KEYS.length);
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

  it("gen 1 includes encounter, fishing, safari_zone but excludes masuda", () => {
    const keys = getAvailableHuntMethods("pokemon-red").map((m) => m.key);
    expect(keys).toContain("encounter");
    expect(keys).toContain("fishing");
    expect(keys).toContain("safari_zone");
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

  it("always includes encounter and soft_reset for any known game", () => {
    for (const gameKey of ["pokemon-red", "pokemon-diamond", "pokemon-x", "pokemon-sword", "pokemon-scarlet"]) {
      const keys = getAvailableHuntMethods(gameKey).map((m) => m.key);
      expect(keys).toContain("encounter");
      expect(keys).toContain("soft_reset");
    }
  });
});
