/**
 * phase.ts: derivation helpers for phased hunts.
 *
 * A phase is a normal Pokémon entry that carries `phase_of` and `phase_number`.
 * Every aggregate over the phases of a hunt (phase number, total encounters,
 * total time) is derived from the current snapshot and never stored, mirroring
 * `backend/internal/state/phases.go` one to one so the numbers cannot drift.
 *
 * Nothing in this module reads the clock: a running timer segment is added by
 * the caller. Keeping the helpers pure is what allows callers to cache the
 * result in a `useMemo` without freezing a live value.
 */
import type { Pokemon } from "../types";

/** Aggregated phase view of a single hunt or phase entry. */
export interface PhaseStats {
  /** True when the entry itself is a finished phase of another hunt. */
  isPhase: boolean;
  /**
   * Phase currently in progress for a running hunt, or the frozen number of a
   * phase entry. 0 when the entry is unknown.
   */
  phaseNumber: number;
  /** Phase entries of this hunt, ascending by phase number. Empty for phase entries. */
  children: Pokemon[];
  /** Parent hunt of a phase entry. null for regular hunts and for orphaned entries. */
  parent: Pokemon | null;
  /** Encounters of the entry plus those of all of its phases. */
  totalEncounters: number;
  /**
   * Accumulated timer milliseconds of the entry plus those of all of its
   * phases. Excludes a currently running segment, callers add it live.
   */
  totalTimerMs: number;
}

/** Reports whether the entry is a finished phase of another hunt. */
export function isPhaseEntry(pokemon: Pokemon | null | undefined): boolean {
  return Boolean(pokemon?.phase_of);
}

/**
 * Returns the phase entries belonging to `parentId`, ascending by phase number.
 * The result is a fresh array and never null. An entry that points at itself is
 * skipped so a corrupted snapshot cannot make a hunt its own phase.
 */
export function phaseChildren(all: Pokemon[], parentId: string): Pokemon[] {
  if (!parentId) return [];
  return all
    .filter((p) => p.phase_of === parentId && p.id !== parentId)
    .sort((a, b) => (a.phase_number ?? 0) - (b.phase_number ?? 0));
}

/**
 * Returns the phase number of the entry with the given id: for a running hunt
 * the number of the phase in progress, for a phase entry its own frozen number.
 * Returns 0 when no entry with that id exists.
 *
 * The running phase is `max(child.phase_number) + 1`, which yields 1 for a hunt
 * without phases and stays stable when a phase in the middle is deleted.
 */
export function phaseNumber(all: Pokemon[], id: string): number {
  const entry = findEntry(all, id);
  if (!entry) return 0;
  return resolvePhaseNumber(all, entry);
}

/**
 * Computes the phase view of `pokemon` against the full snapshot `all`.
 *
 * For a running hunt the totals cover the hunt itself plus all of its phases.
 * For a phase entry the totals are its own frozen values and `parent` points at
 * the hunt it belongs to, or is null once that hunt has been deleted.
 */
export function computePhaseStats(pokemon: Pokemon | null | undefined, all: Pokemon[]): PhaseStats {
  if (!pokemon) return emptyStats();

  const ownEncounters = pokemon.encounters || 0;
  const ownTimerMs = pokemon.timer_accumulated_ms || 0;

  if (isPhaseEntry(pokemon)) {
    return {
      isPhase: true,
      phaseNumber: pokemon.phase_number ?? 0,
      children: [],
      parent: findParent(all, pokemon),
      totalEncounters: ownEncounters,
      totalTimerMs: ownTimerMs,
    };
  }

  const children = phaseChildren(all, pokemon.id);
  return {
    isPhase: false,
    phaseNumber: resolvePhaseNumber(all, pokemon),
    children,
    parent: null,
    totalEncounters: children.reduce((sum, child) => sum + (child.encounters || 0), ownEncounters),
    // Only the accumulated field, never computeTimerMs: a child carrying a
    // stale timer_started_at would otherwise make the sum clock-dependent and
    // freeze it inside a caller's useMemo. The phase history in the dashboard
    // reads the same field, so both places agree.
    totalTimerMs: children.reduce(
      (sum, child) => sum + (child.timer_accumulated_ms || 0),
      ownTimerMs,
    ),
  };
}

/** Zeroed stats for an unknown or missing entry. */
function emptyStats(): PhaseStats {
  return {
    isPhase: false,
    phaseNumber: 0,
    children: [],
    parent: null,
    totalEncounters: 0,
    totalTimerMs: 0,
  };
}

/** Looks up a Pokémon by id in a snapshot. */
function findEntry(all: Pokemon[], id: string): Pokemon | undefined {
  if (!id) return undefined;
  return all.find((p) => p.id === id);
}

/**
 * Resolves the parent hunt of a phase entry, or null when the parent has been
 * deleted or the entry points at itself.
 */
function findParent(all: Pokemon[], pokemon: Pokemon): Pokemon | null {
  const parentId = pokemon.phase_of ?? "";
  if (parentId === pokemon.id) return null;
  return findEntry(all, parentId) ?? null;
}

/** Phase number of an entry that is known to exist in the snapshot. */
function resolvePhaseNumber(all: Pokemon[], entry: Pokemon): number {
  if (isPhaseEntry(entry)) return entry.phase_number ?? 0;
  let highest = 0;
  for (const p of all) {
    if (p.phase_of !== entry.id || p.id === entry.id) continue;
    highest = Math.max(highest, p.phase_number ?? 0);
  }
  return highest + 1;
}
