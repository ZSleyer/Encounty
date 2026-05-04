import { describe, expect, it } from "vitest";
import type { Pokemon } from "../types";
import { computeOddsDisplay, getOddsFractional, getOddsPercent } from "./odds";

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

describe("odds", () => {
  describe("getOddsFractional", () => {
    it("returns the raw fractional odds for a pokemon without charm", () => {
      expect(getOddsFractional(pokemon())).toBe("1/4096");
    });

    it("applies the shiny charm multiplier", () => {
      const withoutCharm = getOddsFractional(pokemon({ shiny_charm: false }));
      const withCharm = getOddsFractional(pokemon({ shiny_charm: true }));
      expect(withoutCharm).not.toBe(withCharm);
    });

    it("returns a safe fallback for a null pokemon", () => {
      expect(getOddsFractional(null)).toBe("1/4096");
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
  });

  describe("computeOddsDisplay", () => {
    it("dispatches to fractional formatting", () => {
      expect(computeOddsDisplay(pokemon(), "fractional")).toBe("1/4096");
    });

    it("dispatches to percent formatting", () => {
      expect(computeOddsDisplay(pokemon({ encounters: 4096 }), "percent")).toBe("63.2%");
    });
  });
});
