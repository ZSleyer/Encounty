import { describe, it, expect, vi, afterEach } from "vitest";
import { computeGroupTotals, runningMsFor } from "./groupTotals";
import { makePokemon } from "../test-utils";

/** Hunt fixture with explicit encounters and accumulated time. */
function hunt(id: string, encounters: number, timerMs: number, extra = {}) {
  return makePokemon({ id, encounters, timer_accumulated_ms: timerMs, ...extra });
}

describe("computeGroupTotals", () => {
  it("returns zeroes for an empty member list", () => {
    expect(computeGroupTotals([], [])).toEqual({ encounters: 0, timerMs: 0 });
  });

  it("sums plain hunts without phases", () => {
    const members = [hunt("a", 10, 1000), hunt("b", 5, 500)];
    expect(computeGroupTotals(members, members)).toEqual({ encounters: 15, timerMs: 1500 });
  });

  it("folds in phases that are not part of the member list", () => {
    const parent = hunt("a", 10, 1000);
    const phase1 = hunt("p1", 100, 9000, { phase_of: "a", phase_number: 1 });
    const phase2 = hunt("p2", 200, 8000, { phase_of: "a", phase_number: 2 });
    expect(computeGroupTotals([parent], [parent, phase1, phase2])).toEqual({
      encounters: 310,
      timerMs: 18_000,
    });
  });

  it("counts a phase once when parent and phase are both members", () => {
    const parent = hunt("a", 10, 1000);
    const phase = hunt("p1", 100, 9000, { phase_of: "a", phase_number: 1 });
    const all = [parent, phase];
    expect(computeGroupTotals(all, all)).toEqual({ encounters: 110, timerMs: 10_000 });
  });

  it("counts an orphaned phase with its own values", () => {
    const orphan = hunt("p1", 100, 9000, { phase_of: "gone", phase_number: 1 });
    expect(computeGroupTotals([orphan], [orphan])).toEqual({ encounters: 100, timerMs: 9000 });
  });

  it("treats missing counters as zero", () => {
    const bare = makePokemon({ id: "a", encounters: 0 });
    expect(computeGroupTotals([bare], [bare])).toEqual({ encounters: 0, timerMs: 0 });
  });
});

describe("runningMsFor", () => {
  afterEach(() => vi.useRealTimers());

  it("ignores stopped timers", () => {
    expect(runningMsFor([hunt("a", 0, 5000)])).toBe(0);
  });

  it("sums the running segments of every started timer", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:30Z"));
    const entries = [
      hunt("a", 0, 5000, { timer_started_at: "2024-01-01T00:00:00Z" }),
      hunt("b", 0, 1000, { timer_started_at: "2024-01-01T00:00:20Z" }),
      hunt("c", 0, 7000),
    ];
    expect(runningMsFor(entries)).toBe(40_000);
  });
});
