/**
 * Migration of stored overlay settings: filling in elements a saved overlay
 * predates, and clamping a filled-in element into the stored canvas.
 */
import { describe, it, expect } from "vitest";
import { makeOverlaySettings } from "../../test-utils";
import { fillMissingElements } from "./overlayMigration";
import type { OverlaySettings } from "../../types";

describe("fillMissingElements", () => {
  const t = ((key: string) => key) as unknown as Parameters<typeof fillMissingElements>[1];

  /** An overlay saved before an element existed persisted it zero-sized. */
  const legacy = (overrides: Partial<OverlaySettings> = {}) => {
    const base = makeOverlaySettings();
    return {
      ...base,
      canvas_width: 800,
      canvas_height: 200,
      odds: { ...base.odds, width: 0, height: 0, x: 0, y: 0 },
      ...overrides,
    };
  };

  it("fills an absent odds element instead of leaving it zero-sized", () => {
    const filled = fillMissingElements(legacy(), t);
    expect(filled.odds.width).toBeGreaterThan(0);
    expect(filled.odds.height).toBeGreaterThan(0);
  });

  it("leaves a filled-in element hidden", () => {
    expect(fillMissingElements(legacy(), t).odds.visible).toBe(false);
  });

  it("clamps a filled-in element into the stored canvas", () => {
    // The defaults are laid out for a taller canvas than a legacy overlay has,
    // so without clamping the layer sits below the panel and shows up outside
    // it the moment the user switches it on.
    const filled = fillMissingElements(legacy(), t);
    expect(filled.odds.y + filled.odds.height).toBeLessThanOrEqual(200);
    expect(filled.odds.x + filled.odds.width).toBeLessThanOrEqual(800);
  });

  it("does not touch an element the user actually positioned", () => {
    const base = makeOverlaySettings();
    const mine = { ...base.odds, x: 11, y: 22, width: 33, height: 44, visible: true };
    const filled = fillMissingElements(legacy({ odds: mine }), t);
    expect(filled.odds).toEqual(mine);
  });
});
