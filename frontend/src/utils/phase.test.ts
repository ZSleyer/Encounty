import { describe, expect, it, vi } from "vitest";
import type { Pokemon } from "../types";
import {
  computePhaseStats,
  isPhaseEntry,
  phaseChildren,
  phaseNumber,
} from "./phase";

function pokemon(overrides: Partial<Pokemon> = {}): Pokemon {
  return {
    id: "p1",
    name: "Bulbasaur",
    canonical_name: "bulbasaur",
    sprite_url: "",
    sprite_type: "normal",
    encounters: 0,
    is_active: false,
    created_at: "2026-01-01T00:00:00Z",
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

/** Builds a finished phase entry of `parentId`. */
function phase(
  id: string,
  parentId: string,
  number: number,
  overrides: Partial<Pokemon> = {},
): Pokemon {
  return pokemon({
    id,
    phase_of: parentId,
    phase_number: number,
    completed_at: "2026-01-02T00:00:00Z",
    ...overrides,
  });
}

describe("isPhaseEntry", () => {
  it("is false for a regular hunt and for missing entries", () => {
    expect(isPhaseEntry(pokemon())).toBe(false);
    expect(isPhaseEntry(pokemon({ phase_of: "" }))).toBe(false);
    expect(isPhaseEntry(null)).toBe(false);
    expect(isPhaseEntry(undefined)).toBe(false);
  });

  it("is true once phase_of is set", () => {
    expect(isPhaseEntry(phase("c1", "parent", 1))).toBe(true);
  });
});

describe("phaseChildren", () => {
  it("returns an empty array for an empty parent id", () => {
    expect(phaseChildren([pokemon()], "")).toEqual([]);
  });

  it("sorts the children ascending by phase number", () => {
    const all = [
      pokemon({ id: "parent" }),
      phase("c3", "parent", 3),
      phase("c1", "parent", 1),
      phase("c2", "parent", 2),
      phase("other", "someone-else", 1),
    ];
    expect(phaseChildren(all, "parent").map((c) => c.id)).toEqual([
      "c1",
      "c2",
      "c3",
    ]);
  });

  it("does not treat a self-referencing entry as its own child", () => {
    const all = [phase("loop", "loop", 4)];
    expect(phaseChildren(all, "loop")).toEqual([]);
  });
});

describe("phaseNumber", () => {
  it("returns 0 for an unknown or empty id", () => {
    expect(phaseNumber([pokemon()], "nope")).toBe(0);
    expect(phaseNumber([pokemon()], "")).toBe(0);
  });

  it("returns 1 for a hunt without phases", () => {
    expect(phaseNumber([pokemon({ id: "parent" })], "parent")).toBe(1);
  });

  it("returns the frozen number of a phase entry", () => {
    const all = [pokemon({ id: "parent" }), phase("c2", "parent", 2)];
    expect(phaseNumber(all, "c2")).toBe(2);
  });
});

describe("computePhaseStats", () => {
  it("returns zeroed stats for a missing pokemon", () => {
    expect(computePhaseStats(null, [])).toEqual({
      isPhase: false,
      phaseNumber: 0,
      children: [],
      parent: null,
      totalEncounters: 0,
      totalTimerMs: 0,
    });
  });

  it("reports phase 1 and the own values for a parent without children", () => {
    const parent = pokemon({
      id: "parent",
      encounters: 300,
      timer_accumulated_ms: 5000,
    });
    const stats = computePhaseStats(parent, [parent]);
    expect(stats.isPhase).toBe(false);
    expect(stats.phaseNumber).toBe(1);
    expect(stats.children).toEqual([]);
    expect(stats.parent).toBeNull();
    expect(stats.totalEncounters).toBe(300);
    expect(stats.totalTimerMs).toBe(5000);
  });

  it("sums encounters and timer over a parent with three children", () => {
    const parent = pokemon({
      id: "parent",
      encounters: 40,
      timer_accumulated_ms: 4000,
    });
    const all = [
      parent,
      phase("c2", "parent", 2, { encounters: 20, timer_accumulated_ms: 2000 }),
      phase("c1", "parent", 1, { encounters: 10, timer_accumulated_ms: 1000 }),
      phase("c3", "parent", 3, { encounters: 30, timer_accumulated_ms: 3000 }),
      pokemon({ id: "unrelated", encounters: 999, timer_accumulated_ms: 999 }),
    ];
    const stats = computePhaseStats(parent, all);
    expect(stats.phaseNumber).toBe(4);
    expect(stats.children.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    expect(stats.totalEncounters).toBe(100);
    expect(stats.totalTimerMs).toBe(10000);
  });

  it("returns the own frozen values and the parent from a child's perspective", () => {
    const parent = pokemon({
      id: "parent",
      encounters: 40,
      timer_accumulated_ms: 4000,
    });
    const child = phase("c1", "parent", 1, {
      encounters: 10,
      timer_accumulated_ms: 1000,
    });
    const stats = computePhaseStats(child, [parent, child]);
    expect(stats.isPhase).toBe(true);
    expect(stats.phaseNumber).toBe(1);
    expect(stats.children).toEqual([]);
    expect(stats.parent?.id).toBe("parent");
    expect(stats.totalEncounters).toBe(10);
    expect(stats.totalTimerMs).toBe(1000);
  });

  it("leaves the parent null for an orphaned child", () => {
    const child = phase("c1", "deleted-parent", 2, { encounters: 10 });
    const stats = computePhaseStats(child, [child]);
    expect(stats.isPhase).toBe(true);
    expect(stats.phaseNumber).toBe(2);
    expect(stats.parent).toBeNull();
    expect(stats.totalEncounters).toBe(10);
  });

  it("does not resolve an entry that points at itself as its own parent", () => {
    const loop = phase("loop", "loop", 3, { encounters: 7 });
    const stats = computePhaseStats(loop, [loop]);
    expect(stats.isPhase).toBe(true);
    expect(stats.parent).toBeNull();
    expect(stats.children).toEqual([]);
    expect(stats.totalEncounters).toBe(7);
  });

  it("ignores a running timer on a child so the total never reads the clock", () => {
    const parent = pokemon({
      id: "parent",
      encounters: 40,
      timer_accumulated_ms: 4000,
    });
    // A phase entry is frozen, but a corrupted snapshot may still carry a
    // timer_started_at. The total must stay the accumulated value either way.
    const child = phase("c1", "parent", 1, {
      encounters: 10,
      timer_accumulated_ms: 1000,
      timer_started_at: "2026-01-02T00:00:00Z",
    });
    const all = [parent, child];

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-02T00:00:10Z"));
      const early = computePhaseStats(parent, all);
      vi.setSystemTime(new Date("2026-06-01T00:00:00Z"));
      const late = computePhaseStats(parent, all);
      expect(early.totalTimerMs).toBe(5000);
      expect(late.totalTimerMs).toBe(early.totalTimerMs);
    } finally {
      vi.useRealTimers();
    }
  });

  it("numbers the next phase as max + 1 after a child was deleted", () => {
    const parent = pokemon({ id: "parent" });
    // Phase 2 was deleted: two children remain, but the next phase is 4, not 3.
    const all = [parent, phase("c1", "parent", 1), phase("c3", "parent", 3)];
    expect(computePhaseStats(parent, all).phaseNumber).toBe(4);
    expect(phaseNumber(all, "parent")).toBe(4);
  });
});
