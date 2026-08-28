import { describe, expect, it } from "vitest";
import type { DexSpecimen } from "../hooks/useDexSpecimens";
import {
  computeSpecimenPhaseStats,
  isSpecimenPhase,
  nextSpecimenPhaseNumber,
  specimenPhaseChildren,
  specimenPhaseParent,
} from "./specimenPhase";

function specimen(overrides: Partial<DexSpecimen> = {}): DexSpecimen {
  return {
    id: 1,
    pokedex_id: "default",
    species_id: 1,
    game: "pokemon-scarlet",
    hunt_type: "encounter",
    encounters: 0,
    timer_accumulated_ms: 0,
    ...overrides,
  };
}

/** Builds a finished phase row of `parentId`. */
function phase(
  id: number,
  parentId: number,
  number: number,
  overrides: Partial<DexSpecimen> = {},
): DexSpecimen {
  return specimen({
    id,
    phase_of: parentId,
    phase_number: number,
    completed_at: "2026-01-02T00:00:00Z",
    ...overrides,
  });
}

describe("isSpecimenPhase", () => {
  it("is false for a regular specimen and for missing rows", () => {
    expect(isSpecimenPhase(specimen())).toBe(false);
    expect(isSpecimenPhase(specimen({ phase_of: 0 }))).toBe(false);
    expect(isSpecimenPhase(null)).toBe(false);
    expect(isSpecimenPhase(undefined)).toBe(false);
  });

  it("is true once phase_of is set", () => {
    expect(isSpecimenPhase(phase(2, 1, 1))).toBe(true);
  });

  it("treats a row without the phase fields as a regular specimen", () => {
    // Rows created before phases existed carry neither field.
    const legacy: DexSpecimen = {
      id: 7,
      pokedex_id: "default",
      species_id: 25,
    };
    expect(isSpecimenPhase(legacy)).toBe(false);
    expect(specimenPhaseParent([legacy], legacy)).toBeNull();
    const stats = computeSpecimenPhaseStats(legacy, [legacy]);
    expect(stats.isPhase).toBe(false);
    expect(stats.phaseNumber).toBe(1);
    expect(stats.parent).toBeNull();
    expect(stats.totalEncounters).toBe(0);
    expect(stats.totalTimerMs).toBe(0);
  });
});

describe("specimenPhaseChildren", () => {
  it("returns an empty array for a missing parent id", () => {
    expect(specimenPhaseChildren([specimen()], 0)).toEqual([]);
  });

  it("sorts the children ascending by phase number", () => {
    const all = [
      specimen({ id: 1 }),
      phase(4, 1, 3),
      phase(2, 1, 1),
      phase(3, 1, 2),
      phase(5, 99, 1),
    ];
    expect(specimenPhaseChildren(all, 1).map((c) => c.id)).toEqual([2, 3, 4]);
  });

  it("does not treat a self-referencing row as its own child", () => {
    const all = [phase(8, 8, 4)];
    expect(specimenPhaseChildren(all, 8)).toEqual([]);
  });
});

describe("nextSpecimenPhaseNumber", () => {
  it("returns 1 for a specimen without phases", () => {
    expect(nextSpecimenPhaseNumber([specimen({ id: 1 })], 1)).toBe(1);
    expect(nextSpecimenPhaseNumber([], 1)).toBe(1);
  });

  it("returns the highest phase number plus one", () => {
    const all = [specimen({ id: 1 }), phase(2, 1, 1), phase(3, 1, 2), phase(4, 1, 3)];
    expect(nextSpecimenPhaseNumber(all, 1)).toBe(4);
  });

  it("stays stable after a phase in the middle was removed", () => {
    const parent = specimen({ id: 1 });
    // Phase 2 was deleted: two phases remain, but the next one is 4, not 3.
    const all = [parent, phase(2, 1, 1), phase(4, 1, 3)];
    expect(nextSpecimenPhaseNumber(all, 1)).toBe(4);
    expect(computeSpecimenPhaseStats(parent, all).phaseNumber).toBe(4);
  });
});

describe("specimenPhaseParent", () => {
  it("resolves the parent of a phase row", () => {
    const parent = specimen({ id: 1 });
    const child = phase(2, 1, 1);
    expect(specimenPhaseParent([parent, child], child)?.id).toBe(1);
  });

  it("returns null for a regular specimen, an orphan and a self-reference", () => {
    expect(specimenPhaseParent([specimen()], specimen())).toBeNull();
    const orphan = phase(2, 404, 1);
    expect(specimenPhaseParent([orphan], orphan)).toBeNull();
    const loop = phase(8, 8, 2);
    expect(specimenPhaseParent([loop], loop)).toBeNull();
    expect(specimenPhaseParent([], null)).toBeNull();
  });
});

describe("computeSpecimenPhaseStats", () => {
  it("returns zeroed stats for a missing specimen and an empty snapshot", () => {
    expect(computeSpecimenPhaseStats(null, [])).toEqual({
      isPhase: false,
      phaseNumber: 0,
      children: [],
      parent: null,
      totalEncounters: 0,
      totalTimerMs: 0,
    });
    expect(computeSpecimenPhaseStats(undefined, [])).toEqual({
      isPhase: false,
      phaseNumber: 0,
      children: [],
      parent: null,
      totalEncounters: 0,
      totalTimerMs: 0,
    });
  });

  it("reports phase 1 and the own values for a specimen without phases", () => {
    const parent = specimen({ id: 1, encounters: 300, timer_accumulated_ms: 5000 });
    const stats = computeSpecimenPhaseStats(parent, [parent]);
    expect(stats.isPhase).toBe(false);
    expect(stats.phaseNumber).toBe(1);
    expect(stats.children).toEqual([]);
    expect(stats.parent).toBeNull();
    expect(stats.totalEncounters).toBe(300);
    expect(stats.totalTimerMs).toBe(5000);
  });

  it("sums encounters and timer over a specimen with three phases", () => {
    const parent = specimen({ id: 1, encounters: 40, timer_accumulated_ms: 4000 });
    const all = [
      parent,
      phase(3, 1, 2, { encounters: 20, timer_accumulated_ms: 2000 }),
      phase(2, 1, 1, { encounters: 10, timer_accumulated_ms: 1000 }),
      phase(4, 1, 3, { encounters: 30, timer_accumulated_ms: 3000 }),
      specimen({ id: 9, encounters: 999, timer_accumulated_ms: 999 }),
    ];
    const stats = computeSpecimenPhaseStats(parent, all);
    expect(stats.phaseNumber).toBe(4);
    expect(stats.children.map((c) => c.id)).toEqual([2, 3, 4]);
    expect(stats.totalEncounters).toBe(100);
    expect(stats.totalTimerMs).toBe(10000);
  });

  it("returns the own frozen values and the parent from a phase perspective", () => {
    const parent = specimen({ id: 1, encounters: 40, timer_accumulated_ms: 4000 });
    const child = phase(2, 1, 1, { encounters: 10, timer_accumulated_ms: 1000 });
    const stats = computeSpecimenPhaseStats(child, [parent, child]);
    expect(stats.isPhase).toBe(true);
    expect(stats.phaseNumber).toBe(1);
    expect(stats.children).toEqual([]);
    expect(stats.parent?.id).toBe(1);
    expect(stats.totalEncounters).toBe(10);
    expect(stats.totalTimerMs).toBe(1000);
  });

  it("leaves the parent null for an orphaned phase", () => {
    const child = phase(2, 404, 2, { encounters: 10 });
    const stats = computeSpecimenPhaseStats(child, [child]);
    expect(stats.isPhase).toBe(true);
    expect(stats.phaseNumber).toBe(2);
    expect(stats.parent).toBeNull();
    expect(stats.totalEncounters).toBe(10);
  });

  it("does not resolve a row that points at itself as its own parent", () => {
    const loop = phase(8, 8, 3, { encounters: 7 });
    const stats = computeSpecimenPhaseStats(loop, [loop]);
    expect(stats.isPhase).toBe(true);
    expect(stats.parent).toBeNull();
    expect(stats.children).toEqual([]);
    expect(stats.totalEncounters).toBe(7);
  });
});
