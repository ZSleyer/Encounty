import { describe, it, expect } from "vitest";
import {
  getGameGroup,
  getMethodsForGame,
  getMethodOdds,
  gameSupportsCharm,
  gameSupportsShinyVariant,
  applyShinyVariantOdds,
  formatOdds,
  formatOddsApprox,
  GAME_GROUPS,
  methodSupportsSparklingPower,
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
  it("includes the universal methods for groups that offer them", () => {
    const methods = getMethodsForGame("pokemon-diamond");
    expect(methods).toContain("encounter");
    expect(methods).toContain("soft_reset");
  });

  it("narrows the universal methods for groups that declare their own", () => {
    expect(getMethodsForGame("pokemon-colosseum")).toEqual([
      "shadow_snag_colosseum",
    ]);
    expect(getMethodsForGame("pokemon-xd")).toEqual([
      "poke_spot_xd",
      "gift_xd",
      "trade_xd",
    ]);
    const gen1 = getMethodsForGame("pokemon-red");
    expect(gen1).toContain("soft_reset");
    expect(gen1).not.toContain("encounter");
    expect(gen1).not.toContain("safari_zone");
  });

  it("never returns a method twice", () => {
    for (const group of GAME_GROUPS) {
      for (const gameKey of group.gameKeys) {
        const methods = getMethodsForGame(gameKey);
        expect(new Set(methods).size).toBe(methods.length);
      }
    }
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

  it("returns the Brilliant tier odds for the SwSh battle method", () => {
    expect(getMethodOdds("pokemon-sword", "battle_method", false)).toEqual([1, 585]);
    expect(getMethodOdds("pokemon-sword", "battle_method", true)).toEqual([1, 455]);
  });

  it("does not offer chain fishing in SwSh", () => {
    expect(getMethodsForGame("pokemon-sword")).not.toContain("chain_fishing");
    expect(getMethodsForGame("pokemon-x")).toContain("chain_fishing");
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

describe("getMethodOdds with Sparkling Power", () => {
  // Every retired sandwich key must keep reading the fraction it read before
  // the level became a modifier of its own.
  it.each([
    ["sandwich_sp1", 1, [1, 2048], [1, 1024]],
    ["sandwich_sp2", 2, [1, 1365], [1, 819]],
    ["sandwich_sp3", 3, [1, 1024], [1, 683]],
    ["sandwich", 3, [1, 1024], [1, 683]],
  ])("keeps the odds of the legacy key %s", (key, level, base, charm) => {
    expect(getMethodOdds("pokemon-scarlet", key as string, false)).toEqual(base);
    expect(getMethodOdds("pokemon-scarlet", key as string, true)).toEqual(charm);
    // The legacy key and the modifier are two spellings of one hunt.
    expect(getMethodOdds("pokemon-scarlet", "encounter", false, level as number)).toEqual(base);
    expect(getMethodOdds("pokemon-scarlet", "encounter", true, level as number)).toEqual(charm);
  });

  it.each([
    ["sparkling_power_lv1", 1, [1, 2048], [1, 819]],
    ["sparkling_power_lv2", 2, [1, 1365], [1, 683]],
    ["sparkling_power_lv3", 3, [1, 1024], [1, 585]],
  ])("keeps the odds of the legacy ZA key %s", (key, level, base, charm) => {
    expect(getMethodOdds("pokemon-legends-za", key as string, false)).toEqual(base);
    expect(getMethodOdds("pokemon-legends-za", key as string, true)).toEqual(charm);
    expect(getMethodOdds("pokemon-legends-za", "encounter", false, level as number)).toEqual(base);
    expect(getMethodOdds("pokemon-legends-za", "encounter", true, level as number)).toEqual(charm);
  });

  it("stacks the level on a mass outbreak", () => {
    expect(getMethodOdds("pokemon-scarlet", "outbreak_ko60", false, 0)).toEqual([1, 1365]);
    expect(getMethodOdds("pokemon-scarlet", "outbreak_ko60", false, 3)).toEqual([1, 683]);
    // 3 rolls for the outbreak, 2 for the charm, 3 for the sandwich
    expect(getMethodOdds("pokemon-scarlet", "outbreak_ko60", true, 3)).toEqual([1, 512]);
    expect(getMethodOdds("pokemon-scarlet", "outbreak_ko30", true, 3)).toEqual([1, 585]);
    // The untouched tier matches a plain wild encounter.
    expect(getMethodOdds("pokemon-scarlet", "outbreak_ko0", false)).toEqual([1, 4096]);
  });

  it("keeps the plain outbreak key for Legends Arceus", () => {
    expect(getMethodOdds("pokemon-legends-arceus", "outbreak", false)).toEqual([1, 158]);
    // Scarlet/Violet name their tier explicitly instead.
    expect(getMethodOdds("pokemon-scarlet", "outbreak", false)).toEqual([1, 4096]);
  });

  it("returns the event outbreak odds including the flat 0.5% bonus", () => {
    expect(getMethodOdds("pokemon-scarlet", "outbreak_event_ko0", false)).toEqual([1, 190]);
    expect(getMethodOdds("pokemon-scarlet", "outbreak_event_ko30", false)).toEqual([1, 182]);
    expect(getMethodOdds("pokemon-scarlet", "outbreak_event_ko60", false)).toEqual([1, 174]);
    expect(getMethodOdds("pokemon-scarlet", "outbreak_event_ko60", true)).toEqual([1, 160]);
    expect(getMethodOdds("pokemon-scarlet", "outbreak_event_ko60", true, 3)).toEqual([1, 144]);
  });

  it("leaves methods a sandwich cannot reach untouched", () => {
    for (const method of ["masuda", "picnic_breeding", "tera_raid", "soft_reset"]) {
      expect(getMethodOdds("pokemon-scarlet", method, false, 3)).toEqual(
        getMethodOdds("pokemon-scarlet", method, false),
      );
      expect(getMethodOdds("pokemon-scarlet", method, true, 3)).toEqual(
        getMethodOdds("pokemon-scarlet", method, true),
      );
    }
  });

  it("ignores the level outside gen 9", () => {
    expect(getMethodOdds("pokemon-sword", "encounter", false, 3)).toEqual([1, 4096]);
    expect(getMethodOdds("unknown", "encounter", false, 3)).toEqual([1, 4096]);
  });

  it("clamps a level outside 0..3", () => {
    expect(getMethodOdds("pokemon-scarlet", "encounter", false, 99)).toEqual([1, 1024]);
    expect(getMethodOdds("pokemon-scarlet", "encounter", false, -1)).toEqual([1, 4096]);
  });

  it("corrects the SV egg odds to the roll model", () => {
    // The Shiny Charm is worth two rolls in SV, eggs included.
    expect(getMethodOdds("pokemon-scarlet", "picnic_breeding", true)).toEqual([1, 1365]);
  });
});

describe("methodSupportsSparklingPower", () => {
  it("returns true for gen 9 wild methods", () => {
    expect(methodSupportsSparklingPower("pokemon-scarlet", "encounter")).toBe(true);
    expect(methodSupportsSparklingPower("pokemon-violet", "outbreak_ko60")).toBe(true);
    expect(methodSupportsSparklingPower("pokemon-scarlet", "outbreak_event_ko0")).toBe(true);
    expect(methodSupportsSparklingPower("pokemon-legends-za", "encounter")).toBe(true);
    // Legacy keys resolve to a wild encounter.
    expect(methodSupportsSparklingPower("pokemon-scarlet", "sandwich_sp2")).toBe(true);
  });

  it("returns false for eggs, raids, other games and unknown keys", () => {
    expect(methodSupportsSparklingPower("pokemon-scarlet", "masuda")).toBe(false);
    expect(methodSupportsSparklingPower("pokemon-scarlet", "picnic_breeding")).toBe(false);
    expect(methodSupportsSparklingPower("pokemon-scarlet", "tera_raid")).toBe(false);
    expect(methodSupportsSparklingPower("pokemon-scarlet", "soft_reset")).toBe(false);
    expect(methodSupportsSparklingPower("pokemon-legends-za", "fossil")).toBe(false);
    expect(methodSupportsSparklingPower("pokemon-sword", "encounter")).toBe(false);
    expect(methodSupportsSparklingPower("unknown", "encounter")).toBe(false);
    expect(methodSupportsSparklingPower("pokemon-scarlet", "nope")).toBe(false);
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

describe("gameSupportsShinyVariant", () => {
  it("returns true for SwSh", () => {
    expect(gameSupportsShinyVariant("pokemon-sword")).toBe(true);
    expect(gameSupportsShinyVariant("pokemon-shield")).toBe(true);
  });

  it("returns false for every other game", () => {
    expect(gameSupportsShinyVariant("pokemon-scarlet")).toBe(false);
    expect(gameSupportsShinyVariant("pokemon-bd")).toBe(false);
    expect(gameSupportsShinyVariant("pokemon-x")).toBe(false);
    expect(gameSupportsShinyVariant("pokemon-red")).toBe(false);
  });

  it("returns false for unknown games", () => {
    expect(gameSupportsShinyVariant("unknown")).toBe(false);
    expect(gameSupportsShinyVariant("")).toBe(false);
  });
});

describe("applyShinyVariantOdds", () => {
  const swshOdds = (method: string, hasCharm = false) =>
    getMethodOdds("pokemon-sword", method, hasCharm);

  const variantOdds = (method: string, variant: "star" | "square") =>
    applyShinyVariantOdds("pokemon-sword", method, swshOdds(method), variant);

  const probability = (odds: [number, number]) => odds[0] / odds[1];

  describe("wild bucket (overworld PID overwrite, XOR forced to 0)", () => {
    it("keeps almost all of the curry odds for square", () => {
      const odds = variantOdds("curry_hunting", "square");
      expect(odds).toEqual([65521, 268435456]);
      expect(formatOddsApprox(odds)).toBe("1/4097");
      expect(probability(odds)).toBeCloseTo(65521 / 268435456, 12);
    });

    it("makes a curry star almost unreachable", () => {
      const odds = variantOdds("curry_hunting", "star");
      expect(formatOddsApprox(odds)).toBe("1/17895697");
      expect(probability(odds)).toBeCloseTo(1 / 17895697, 12);
    });

    it("keeps almost all of the battle-method odds for square", () => {
      const odds = variantOdds("battle_method", "square");
      expect(odds).toEqual([65521, 38338560]);
      expect(formatOddsApprox(odds)).toBe("1/585");
      expect(probability(odds)).toBeCloseTo(65521 / 38338560, 10);
    });

    it("makes a battle-method star almost unreachable", () => {
      const odds = variantOdds("battle_method", "star");
      expect(odds).toEqual([1, 2555904]);
      expect(formatOddsApprox(odds)).toBe("1/2555904");
    });

    it("treats the universal encounter method as wild", () => {
      const odds = variantOdds("encounter", "square");
      expect(formatOddsApprox(odds)).toBe("1/4097");
    });
  });

  describe("egg/static/raid bucket (natural PID, 15:1 split)", () => {
    it("gives masuda stars 15 of the 16 XOR buckets", () => {
      const odds = variantOdds("masuda", "star");
      expect(odds).toEqual([15, 10912]);
      // 682 * 16 / 15 = 727.47, the nearest unit fraction is 1/727.
      expect(formatOddsApprox(odds)).toBe("1/727");
      expect(probability(odds)).toBeCloseTo(15 / 10912, 10);
    });

    it("gives masuda squares a single XOR bucket", () => {
      const odds = variantOdds("masuda", "square");
      expect(odds).toEqual([1, 10912]);
      expect(formatOddsApprox(odds)).toBe("1/10912");
    });

    it("splits max raid odds the same way", () => {
      expect(formatOddsApprox(variantOdds("max_raid", "star"))).toBe("1/4369");
      expect(variantOdds("max_raid", "square")).toEqual([1, 65536]);
      expect(formatOddsApprox(variantOdds("max_raid", "square"))).toBe("1/65536");
    });

    it("treats soft_reset and breeding as static/egg methods", () => {
      expect(variantOdds("soft_reset", "square")).toEqual([1, 65536]);
      expect(variantOdds("breeding", "square")).toEqual([1, 65536]);
    });

    it("makes squares rarer than stars, unlike the wild bucket", () => {
      const star = probability(variantOdds("dynamax_adventure", "star"));
      const square = probability(variantOdds("dynamax_adventure", "square"));
      expect(square).toBeLessThan(star);
    });
  });

  describe("identity", () => {
    it("leaves the tuple untouched without a variant", () => {
      expect(
        applyShinyVariantOdds("pokemon-sword", "curry_hunting", [1, 4096]),
      ).toEqual([1, 4096]);
      expect(
        applyShinyVariantOdds("pokemon-sword", "masuda", [1, 682], undefined),
      ).toEqual([1, 682]);
    });

    it("leaves the tuple untouched for games without variants", () => {
      expect(
        applyShinyVariantOdds("pokemon-scarlet", "encounter", [1, 4096], "star"),
      ).toEqual([1, 4096]);
      expect(
        applyShinyVariantOdds("pokemon-x", "horde", [5, 4096], "square"),
      ).toEqual([5, 4096]);
      expect(
        applyShinyVariantOdds("unknown", "encounter", [1, 4096], "star"),
      ).toEqual([1, 4096]);
    });

    it("applies the charm before the variant split", () => {
      const charmed = applyShinyVariantOdds(
        "pokemon-sword",
        "masuda",
        swshOdds("masuda", true),
        "star",
      );
      expect(charmed).toEqual([15, 8192]);
    });
  });
});

describe("formatOddsApprox", () => {
  it("renders exact unit fractions unchanged", () => {
    expect(formatOddsApprox([1, 4096])).toBe("1/4096");
  });

  it("rounds a non-unit fraction to the nearest 1-in-N", () => {
    expect(formatOddsApprox([5, 4096])).toBe("1/819");
    expect(formatOddsApprox([65521, 268435456])).toBe("1/4097");
  });

  it("falls back to the exact format for degenerate tuples", () => {
    expect(formatOddsApprox([0, 4096])).toBe("0/4096");
  });
});
