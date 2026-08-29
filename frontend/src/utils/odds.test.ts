import { describe, expect, it } from "vitest";
import type { Pokemon } from "../types";
import {
  buildProbabilityCurve,
  computeOddsDisplay,
  encountersForProbability,
  getOddsFractional,
  getOddsMilestones,
  getOddsPercent,
} from "./odds";

function pokemon(overrides: Partial<Pokemon> = {}): Pokemon {
  return {
    id: "p1",
    name: "Bulbasaur",
    canonical_name: "bulbasaur",
    sprite_url: "",
    sprite_type: "normal",
    encounters: 0,
    is_active: false,
    created_at: new Date().toISOString(),
    language: "en",
    game: "pokemon-scarlet",
    overlay_mode: "default",
    hunt_type: "encounter",
    shiny_charm: false,
    timer_accumulated_ms: 0,
    hunt_mode: "both",
    group_id: "",
    tags: [],
    ...overrides,
  } as Pokemon;
}

function swsh(overrides: Partial<Pokemon> = {}): Pokemon {
  return pokemon({ game: "pokemon-sword", hunt_type: "max_raid", ...overrides });
}

describe("odds", () => {
  describe("getOddsFractional", () => {
    it("returns the raw fractional odds for a pokemon without charm", () => {
      expect(getOddsFractional(pokemon())).toBe("1/4096");
    });

    it("applies the Sparkling Power level", () => {
      expect(getOddsFractional(pokemon({ sparkling_power: 3 }))).toBe("1/1024");
      expect(getOddsFractional(pokemon({ sparkling_power: 3, shiny_charm: true }))).toBe("1/683");
      expect(
        getOddsFractional(pokemon({ hunt_type: "outbreak_event_ko60", sparkling_power: 3, shiny_charm: true })),
      ).toBe("1/144");
    });

    it("still reads a legacy sandwich hunt without a stored level", () => {
      expect(getOddsFractional(pokemon({ hunt_type: "sandwich_sp2", sparkling_power: 0 }))).toBe("1/1365");
    });

    it("applies the shiny charm multiplier", () => {
      const withoutCharm = getOddsFractional(pokemon({ shiny_charm: false }));
      const withCharm = getOddsFractional(pokemon({ shiny_charm: true }));
      expect(withoutCharm).not.toBe(withCharm);
    });

    it("returns a safe fallback for a null pokemon", () => {
      expect(getOddsFractional(null)).toBe("1/4096");
    });

    it("rounds the wild SwSh square odds to the nearest 1-in-N", () => {
      expect(
        getOddsFractional(
          swsh({ hunt_type: "curry_hunting", shiny_variant: "square" }),
        ),
      ).toBe("1/4097");
    });

    it("rounds the wild SwSh star odds to the nearest 1-in-N", () => {
      expect(
        getOddsFractional(
          swsh({ hunt_type: "battle_method", shiny_variant: "star" }),
        ),
      ).toBe("1/2555904");
    });

    it("rounds the egg-bucket SwSh odds to the nearest 1-in-N", () => {
      expect(
        getOddsFractional(swsh({ hunt_type: "masuda", shiny_variant: "star" })),
      ).toBe("1/727");
      expect(
        getOddsFractional(swsh({ hunt_type: "masuda", shiny_variant: "square" })),
      ).toBe("1/10912");
    });

    it("keeps the exact fraction when no variant is targeted", () => {
      expect(getOddsFractional(swsh({ hunt_type: "max_raid" }))).toBe("1/4096");
    });

    it("ignores a variant set on a game without variants", () => {
      expect(getOddsFractional(pokemon({ shiny_variant: "star" }))).toBe("1/4096");
    });
  });

  describe("getOddsPercent", () => {
    it("returns 0.0% for zero encounters", () => {
      expect(getOddsPercent(pokemon({ encounters: 0 }))).toBe("0.0%");
    });

    it("returns 0.0% for a null pokemon", () => {
      expect(getOddsPercent(null)).toBe("0.0%");
    });

    it("approximates 63.2% after one odds-denominator worth of encounters", () => {
      // p = 1/4096, n = 4096 → 1 - (1 - 1/4096)^4096 ≈ 0.632
      expect(getOddsPercent(pokemon({ encounters: 4096 }))).toBe("63.2%");
    });

    it("is monotonically increasing with encounters", () => {
      const low = parseFloat(getOddsPercent(pokemon({ encounters: 100 })));
      const high = parseFloat(getOddsPercent(pokemon({ encounters: 1000 })));
      expect(high).toBeGreaterThan(low);
    });

    it("uses the encounters override instead of the pokemon's own count", () => {
      expect(getOddsPercent(pokemon({ encounters: 100 }), 4096)).toBe("63.2%");
    });

    it("returns 0.0% for an override of zero even with own encounters", () => {
      expect(getOddsPercent(pokemon({ encounters: 4096 }), 0)).toBe("0.0%");
    });

    it("clamps a negative override to zero", () => {
      expect(getOddsPercent(pokemon({ encounters: 4096 }), -10)).toBe("0.0%");
    });

    it("uses the exact variant probability, not the rounded display", () => {
      // Square max raids are exactly 1/65536, so n = 65536 lands on 63.2%.
      expect(
        getOddsPercent(
          swsh({ shiny_variant: "square", encounters: 65536 }),
        ),
      ).toBe("63.2%");
    });

    it("makes a wild star far less likely than the plain odds", () => {
      const plain = parseFloat(
        getOddsPercent(swsh({ hunt_type: "curry_hunting", encounters: 4096 })),
      );
      const star = parseFloat(
        getOddsPercent(
          swsh({
            hunt_type: "curry_hunting",
            shiny_variant: "star",
            encounters: 4096,
          }),
        ),
      );
      expect(star).toBeLessThan(plain);
      expect(star).toBeCloseTo(0.0, 1);
    });

    it("leaves a wild square nearly as likely as the plain odds", () => {
      const plain = parseFloat(
        getOddsPercent(swsh({ hunt_type: "curry_hunting", encounters: 4096 })),
      );
      const square = parseFloat(
        getOddsPercent(
          swsh({
            hunt_type: "curry_hunting",
            shiny_variant: "square",
            encounters: 4096,
          }),
        ),
      );
      expect(square).toBeCloseTo(plain, 1);
    });

    it("needs more encounters for a variant than without one", () => {
      const plain = encountersForProbability(swsh({ hunt_type: "masuda" }), 0.5);
      const star = encountersForProbability(
        swsh({ hunt_type: "masuda", shiny_variant: "star" }),
        0.5,
      );
      expect(star!).toBeGreaterThan(plain!);
    });
  });

  describe("computeOddsDisplay", () => {
    it("dispatches to fractional formatting", () => {
      expect(computeOddsDisplay(pokemon(), "fractional")).toBe("1/4096");
    });

    it("dispatches to percent formatting", () => {
      expect(computeOddsDisplay(pokemon({ encounters: 4096 }), "percent")).toBe("63.2%");
    });

    it("forwards the encounters override to the percent formatting", () => {
      expect(computeOddsDisplay(pokemon({ encounters: 0 }), "percent", 4096)).toBe("63.2%");
    });

    it("ignores the encounters override in fractional mode", () => {
      expect(computeOddsDisplay(pokemon(), "fractional", 4096)).toBe("1/4096");
    });
  });

  describe("encountersForProbability", () => {
    it("returns ≈2839 for 50% at 1/4096", () => {
      expect(encountersForProbability(pokemon(), 0.5)).toBe(2839);
    });

    it("returns ≈18861 for 99% at 1/4096", () => {
      expect(encountersForProbability(pokemon(), 0.99)).toBe(18861);
    });

    it("returns null for a missing pokemon", () => {
      expect(encountersForProbability(null, 0.5)).toBeNull();
    });

    it("returns null for target ≤ 0 or ≥ 1", () => {
      expect(encountersForProbability(pokemon(), 0)).toBeNull();
      expect(encountersForProbability(pokemon(), 1)).toBeNull();
      expect(encountersForProbability(pokemon(), -0.5)).toBeNull();
    });

    it("respects the shiny-charm multiplier (fewer encounters required)", () => {
      const base = encountersForProbability(pokemon({ shiny_charm: false }), 0.5);
      const charm = encountersForProbability(pokemon({ shiny_charm: true }), 0.5);
      expect(base).not.toBeNull();
      expect(charm).not.toBeNull();
      expect(charm!).toBeLessThan(base!);
    });

    it("respects the Sparkling Power level (fewer encounters required)", () => {
      const base = encountersForProbability(pokemon({ sparkling_power: 0 }), 0.5);
      const boosted = encountersForProbability(pokemon({ sparkling_power: 3 }), 0.5);
      expect(base).not.toBeNull();
      expect(boosted).not.toBeNull();
      expect(boosted!).toBeLessThan(base!);
    });
  });

  describe("getOddsMilestones", () => {
    it("returns the default four targets", () => {
      const ms = getOddsMilestones(pokemon());
      expect(ms.map((m) => m.target)).toEqual([0.5, 0.75, 0.9, 0.99]);
    });

    it("accepts custom targets", () => {
      const ms = getOddsMilestones(pokemon(), [0.25, 0.5]);
      expect(ms).toHaveLength(2);
      expect(ms[0].target).toBe(0.25);
    });

    it("returns null etaMs when no rate is supplied", () => {
      const ms = getOddsMilestones(pokemon({ encounters: 100 }));
      ms.forEach((m) => expect(m.etaMs).toBeNull());
    });

    it("computes a positive etaMs when rate > 0 and target is ahead", () => {
      const ms = getOddsMilestones(pokemon({ encounters: 100 }), [0.5], 60);
      expect(ms[0].etaMs).not.toBeNull();
      expect(ms[0].etaMs!).toBeGreaterThan(0);
    });

    it("returns etaMs = 0 when the pokemon already passed the milestone", () => {
      const ms = getOddsMilestones(pokemon({ encounters: 100_000 }), [0.5], 60);
      expect(ms[0].etaMs).toBe(0);
    });

    it("bases the ETA on the encounters override", () => {
      const own = getOddsMilestones(pokemon({ encounters: 100 }), [0.5], 60);
      const total = getOddsMilestones(pokemon({ encounters: 100 }), [0.5], 60, 2000);
      expect(total[0].etaMs!).toBeLessThan(own[0].etaMs!);
    });

    it("reports a milestone as reached when only the override passes it", () => {
      const ms = getOddsMilestones(pokemon({ encounters: 10 }), [0.5], 60, 100_000);
      expect(ms[0].etaMs).toBe(0);
    });

    it("leaves the required encounter counts untouched by the override", () => {
      const ms = getOddsMilestones(pokemon(), [0.5], undefined, 5000);
      expect(ms[0].encounters).toBe(2839);
    });

    it("returns null etaMs when encounters is unreachable (p ≥ 1 impossible here, but test target ≥ 1)", () => {
      const ms = getOddsMilestones(pokemon({ encounters: 100 }), [1, -1], 60);
      expect(ms[0].encounters).toBeNull();
      expect(ms[0].etaMs).toBeNull();
    });
  });

  describe("buildProbabilityCurve", () => {
    it("returns an empty array for a null pokemon", () => {
      expect(buildProbabilityCurve(null, 1000)).toEqual([]);
    });

    it("starts at n=0, p=0", () => {
      const curve = buildProbabilityCurve(pokemon(), 4096);
      expect(curve[0]).toEqual({ n: 0, p: 0 });
    });

    it("monotonically increases", () => {
      const curve = buildProbabilityCurve(pokemon(), 8000);
      for (let i = 1; i < curve.length; i++) {
        expect(curve[i].p).toBeGreaterThanOrEqual(curve[i - 1].p);
      }
    });

    it("final probability approaches but never exceeds 1", () => {
      const curve = buildProbabilityCurve(pokemon(), 20_000);
      const last = curve[curve.length - 1];
      expect(last.p).toBeLessThanOrEqual(1);
      expect(last.p).toBeGreaterThan(0.9);
    });

    it("respects the points argument", () => {
      expect(buildProbabilityCurve(pokemon(), 1000, 10)).toHaveLength(10);
      expect(buildProbabilityCurve(pokemon(), 1000, 100)).toHaveLength(100);
    });
  });
});
