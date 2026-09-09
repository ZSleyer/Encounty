/**
 * groupTotals.ts: aggregation of encounters and hunt time across several hunts.
 *
 * A hunt that has phased keeps only the current phase on the parent entry: the
 * backend zeroes the parent when it freezes a phase child. Summing the raw
 * fields of a member list therefore loses everything that happened before the
 * last phase, which is exactly the history the group total is supposed to show.
 * These helpers fold the phase children back in.
 *
 * Like `utils/phase.ts`, `computeGroupTotals` never reads the clock so callers
 * can hold on to its result; the running segment comes from `runningMsFor`.
 */
import type { Pokemon } from "../types";
import { phaseChildren } from "./phase";
import { computeTimerMs } from "./timer";

/** Encounters and accumulated milliseconds summed over a set of hunts. */
export interface GroupTotals {
  encounters: number;
  timerMs: number;
}

/**
 * Sums encounters and accumulated timer milliseconds over `members`, including
 * the phases of every member.
 *
 * A phase child that is itself part of `members` is skipped while walking its
 * parent, so a list holding both (the caught tab, where parent and phases are
 * completed alike) counts every entry exactly once. Excludes a running timer
 * segment, callers add it via `runningMsFor`.
 */
export function computeGroupTotals(members: Pokemon[], all: Pokemon[]): GroupTotals {
  const memberIds = new Set(members.map((p) => p.id));
  let encounters = 0;
  let timerMs = 0;
  for (const member of members) {
    encounters += member.encounters || 0;
    timerMs += member.timer_accumulated_ms || 0;
    // A phase entry is frozen and has no children of its own.
    if (member.phase_of) continue;
    for (const child of phaseChildren(all, member.id)) {
      if (memberIds.has(child.id)) continue;
      encounters += child.encounters || 0;
      timerMs += child.timer_accumulated_ms || 0;
    }
  }
  return { encounters, timerMs };
}

/**
 * Returns the milliseconds currently ticking on the running timers of `entries`.
 *
 * This is the clock-dependent half of a total: added to the accumulated sum it
 * yields the live figure, and kept separate it leaves that sum cacheable.
 */
export function runningMsFor(entries: Pokemon[]): number {
  let running = 0;
  for (const entry of entries) {
    if (!entry.timer_started_at) continue;
    running += computeTimerMs(entry) - (entry.timer_accumulated_ms || 0);
  }
  return running;
}
