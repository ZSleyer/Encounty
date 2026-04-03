import { describe, it, expect } from "vitest";
import {
  getGameGroup,
  getMethodsForGame,
  getMethodOdds,
  gameSupportsCharm,
  formatOdds,
  GAME_GROUPS,
} from "./gameGroups";

describe("GAME_GROUPS", () => {
  it("has at least 20 groups", () => {
    expect(GAME_GROUPS.length).toBeGreaterThanOrEqual(20);
  });

  it("every group has unique id and non-empty gameKeys", () => {
    const ids = new Set<string>();
    for (const g of GAME_GROUPS) {
      expect(ids.has(g.id)).toBe(false);
      ids.add(g.id);
      expect(g.gameKeys.length).toBeGreaterThan(0);
    }
  });
});

describe("getGameGroup", () => {
  it("returns the correct group for known game keys", () => {
    expect(getGameGroup("pokemon-red")?.id).toBe("gen1_rby");
    expect(getGameGroup("pokemon-diamond")?.id).toBe("gen4_dpp");
    expect(getGameGroup("pokemon-scarlet")?.id).toBe("gen9_sv");
  });

  it("returns null for unknown game keys", () => {
    expect(getGameGroup("pokemon-unknown")).toBeNull();
    expect(getGameGroup("")).toBeNull();
  });
});

describe("getMethodsForGame", () => {
  it("always includes encounter and soft_reset", () => {
    const methods = getMethodsForGame("pokemon-red");
    expect(methods).toContain("encounter");
    expect(methods).toContain("soft_reset");
  });

  it("returns game-specific methods for DPPt", () => {
    const methods = getMethodsForGame("pokemon-diamond");
    expect(methods).toContain("radar");
    expect(methods).toContain("masuda");
    expect(methods).toContain("honey_tree");
  });

  it("returns only universal methods for unknown games", () => {
    expect(getMethodsForGame("unknown")).toEqual(["encounter", "soft_reset"]);
  });
});

describe("getMethodOdds", () => {
  it("returns base odds for encounter in gen 1", () => {
    expect(getMethodOdds("pokemon-red", "encounter", false)).toEqual([1, 8192]);
  });

  it("returns base odds for encounter in gen 9", () => {
    expect(getMethodOdds("pokemon-scarlet", "encounter", false)).toEqual([1, 4096]);
  });

  it("returns charm odds for encounter in gen 9 with charm", () => {
    expect(getMethodOdds("pokemon-scarlet", "encounter", true)).toEqual([1, 1365]);
  });

  it("returns method-specific odds for masuda in DPPt", () => {
    expect(getMethodOdds("pokemon-diamond", "masuda", false)).toEqual([1, 1638]);
  });

  it("returns method-specific odds for masuda in gen 6", () => {
    expect(getMethodOdds("pokemon-x", "masuda", false)).toEqual([1, 682]);
  });

  it("returns charm odds for masuda in gen 6", () => {
    expect(getMethodOdds("pokemon-x", "masuda", true)).toEqual([1, 512]);
  });

  it("returns dynamax_adventure base odds for SwSh", () => {
    expect(getMethodOdds("pokemon-sword", "dynamax_adventure", false)).toEqual([1, 300]);
  });

  it("returns dynamax_adventure charm odds for SwSh", () => {
    expect(getMethodOdds("pokemon-sword", "dynamax_adventure", true)).toEqual([1, 100]);
  });

  it("returns correct PLA outbreak odds", () => {
    expect(getMethodOdds("pokemon-legends-arceus", "outbreak", false)).toEqual([1, 158]);
    expect(getMethodOdds("pokemon-legends-arceus", "outbreak", true)).toEqual([1, 142]);
  });

  it("returns correct PLA outbreak_perfect odds", () => {
    expect(getMethodOdds("pokemon-legends-arceus", "outbreak_perfect", false)).toEqual([1, 141]);
  });

  it("handles legacy sandwich key via alias", () => {
    const odds = getMethodOdds("pokemon-scarlet", "sandwich", false);
    expect(odds).toEqual([1, 1024]);
  });

  it("returns base odds for unknown method", () => {
    expect(getMethodOdds("pokemon-red", "unknown_method", false)).toEqual([1, 8192]);
  });

  it("returns 1/4096 for unknown game key", () => {
    expect(getMethodOdds("unknown", "encounter", false)).toEqual([1, 4096]);
  });

  it("ignores charm when game has no charm support", () => {
    expect(getMethodOdds("pokemon-red", "encounter", true)).toEqual([1, 8192]);
  });

  it("returns horde odds as 5/4096 in XY", () => {
    expect(getMethodOdds("pokemon-x", "horde", false)).toEqual([5, 4096]);
  });

  it("returns BW2 base charm odds", () => {
    expect(getMethodOdds("pokemon-black-2", "encounter", true)).toEqual([1, 2730]);
  });

  it("returns SV sandwich_sp3 odds", () => {
    expect(getMethodOdds("pokemon-scarlet", "sandwich_sp3", false)).toEqual([1, 1024]);
    expect(getMethodOdds("pokemon-scarlet", "sandwich_sp3", true)).toEqual([1, 683]);
  });

  it("returns ZA sparkling_power odds", () => {
    expect(getMethodOdds("pokemon-legends-za", "sparkling_power_lv3", false)).toEqual([1, 1024]);
    expect(getMethodOdds("pokemon-legends-za", "sparkling_power_lv3", true)).toEqual([1, 585]);
  });
});

describe("gameSupportsCharm", () => {
  it("returns false for gen 1-5 (except BW2)", () => {
    expect(gameSupportsCharm("pokemon-red")).toBe(false);
    expect(gameSupportsCharm("pokemon-gold")).toBe(false);
    expect(gameSupportsCharm("pokemon-ruby")).toBe(false);
    expect(gameSupportsCharm("pokemon-diamond")).toBe(false);
    expect(gameSupportsCharm("pokemon-black")).toBe(false);
  });

  it("returns true for BW2", () => {
    expect(gameSupportsCharm("pokemon-black-2")).toBe(true);
  });

  it("returns true for gen 6+", () => {
    expect(gameSupportsCharm("pokemon-x")).toBe(true);
    expect(gameSupportsCharm("pokemon-sun")).toBe(true);
    expect(gameSupportsCharm("pokemon-sword")).toBe(true);
    expect(gameSupportsCharm("pokemon-scarlet")).toBe(true);
  });

  it("returns false for unknown games", () => {
    expect(gameSupportsCharm("unknown")).toBe(false);
  });
});

describe("formatOdds", () => {
  it("formats simple odds", () => {
    expect(formatOdds([1, 4096])).toBe("1/4096");
  });

  it("formats horde odds", () => {
    expect(formatOdds([5, 4096])).toBe("5/4096");
  });
});
