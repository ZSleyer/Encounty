/**
 * specimenPhase.ts: derivation helpers for phased Pokédex specimens.
 *
 * A phase is a normal specimen row that carries `phase_of` and `phase_number`.
 * Every aggregate over the phases of a catch (phase number, total encounters,
 * total time) is derived from the current snapshot and never stored, so the
 * numbers cannot drift apart from the rows they summarise.
 *
 * This deliberately mirrors `utils/phase.ts` instead of being a generic version
 * of it: `phase.ts` is typed against `Pokemon` with string ids, and generifying
 * it would loosen the type the dashboard counter path depends on. Specimen ids
 * are numeric, so the two modules stay separate and each keeps its exact type.
 *
 * Nothing in this module reads the clock. Keeping the helpers pure is what
 * allows callers to cache the result in a `useMemo` without freezing a live
 * value.
 */
import type { DexSpecimen } from "../hooks/useDexSpecimens";

/** Aggregated phase view of a single specimen. */
export interface SpecimenPhaseStats {
  /** True when the specimen itself is a phase of another specimen. */
  isPhase: boolean;
  /**
   * Phase that a non-phase specimen would record next, or the frozen number of
   * a phase row. 0 when the specimen is missing.
   */
  phaseNumber: number;
  /** Phases of this specimen, ascending by phase number. Empty for a phase row. */
  children: DexSpecimen[];
  /** Parent of a phase row. null for regular specimens and for orphaned rows. */
  parent: DexSpecimen | null;
  /** Encounters of the specimen plus those of all of its phases. */
  totalEncounters: number;
  /** Accumulated timer milliseconds of the specimen plus those of all of its phases. */
  totalTimerMs: number;
}

/** Reports whether the specimen is a phase of another specimen. */
export function isSpecimenPhase(
  specimen: DexSpecimen | null | undefined,
): boolean {
  return Boolean(specimen?.phase_of);
}

/**
 * Returns the phases belonging to `parentId`, ascending by phase number.
 * The result is a fresh array and never null. A row that points at itself is
 * skipped so a corrupted snapshot cannot make a specimen its own phase.
 */
export function specimenPhaseChildren(
  all: DexSpecimen[],
  parentId: number,
): DexSpecimen[] {
  if (!parentId) return [];
  return all
    .filter((s) => s.phase_of === parentId && s.id !== parentId)
    .sort((a, b) => (a.phase_number ?? 0) - (b.phase_number ?? 0));
}

/**
 * Returns the number the next phase of `parentId` should get.
 *
 * It is `max(child.phase_number) + 1`, which yields 1 for a specimen without
 * phases and stays stable when a phase in the middle is deleted.
 */
export function nextSpecimenPhaseNumber(
  all: DexSpecimen[],
  parentId: number,
): number {
  let highest = 0;
  for (const child of specimenPhaseChildren(all, parentId)) {
    highest = Math.max(highest, child.phase_number ?? 0);
  }
  return highest + 1;
}

/**
 * Resolves the parent of a phase row, or null when the parent has been deleted,
 * the row points at itself, or the row is not a phase at all.
 */
export function specimenPhaseParent(
  all: DexSpecimen[],
  specimen: DexSpecimen | null | undefined,
): DexSpecimen | null {
  const parentId = specimen?.phase_of ?? 0;
  if (!specimen || !parentId || parentId === specimen.id) return null;
  return all.find((s) => s.id === parentId) ?? null;
}

/**
 * Computes the phase view of `specimen` against the full snapshot `all`.
 *
 * For a regular specimen the totals cover the specimen itself plus all of its
 * phases. For a phase row the totals are its own frozen values and `parent`
 * points at the specimen it belongs to, or is null once that row has been
 * deleted.
 */
export function computeSpecimenPhaseStats(
  specimen: DexSpecimen | null | undefined,
  all: DexSpecimen[],
): SpecimenPhaseStats {
  if (!specimen) return emptySpecimenStats();

  const ownEncounters = specimen.encounters || 0;
  const ownTimerMs = specimen.timer_accumulated_ms || 0;

  if (isSpecimenPhase(specimen)) {
    return {
      isPhase: true,
      phaseNumber: specimen.phase_number ?? 0,
      children: [],
      parent: specimenPhaseParent(all, specimen),
      totalEncounters: ownEncounters,
      totalTimerMs: ownTimerMs,
    };
  }

  const children = specimenPhaseChildren(all, specimen.id);
  return {
    isPhase: false,
    phaseNumber: nextSpecimenPhaseNumber(all, specimen.id),
    children,
    parent: null,
    totalEncounters: children.reduce(
      (sum, child) => sum + (child.encounters || 0),
      ownEncounters,
    ),
    // Only the accumulated field is summed, so the total never depends on the
    // clock and stays safe to cache in a caller's useMemo.
    totalTimerMs: children.reduce(
      (sum, child) => sum + (child.timer_accumulated_ms || 0),
      ownTimerMs,
    ),
  };
}

/** Zeroed stats for a missing specimen. */
function emptySpecimenStats(): SpecimenPhaseStats {
  return {
    isPhase: false,
    phaseNumber: 0,
    children: [],
    parent: null,
    totalEncounters: 0,
    totalTimerMs: 0,
  };
}
