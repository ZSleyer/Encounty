/**
 * odds.ts — Shared shiny-odds formatting helpers used by the Dashboard card
 * and the overlay odds element. Two display modes are supported:
 *
 *  - "fractional" — the static per-hunt odds as a ratio, e.g. "1/4096".
 *  - "percent"    — the cumulative probability that at least one of the
 *                   current `encounters` rolls would have been shiny,
 *                   computed as `1 - (1 - p)^encounters` where
 *                   `p = numerator / denominator`.
 */
import type { Pokemon } from "../types";
import {
  applyShinyVariantOdds,
  formatOdds,
  formatOddsApprox,
  gameSupportsShinyVariant,
  getMethodOdds,
} from "./gameGroups";

/**
 * Resolves the base fractional odds tuple for a pokemon's current configuration.
 * The tuple stays exact (unrounded) because every probability helper builds on
 * it, only the fractional display rounds.
 */
function resolveOddsTuple(pokemon: Pokemon | null): [number, number] {
  if (!pokemon) return [1, 4096];
  const gameKey = pokemon.game ?? "";
  const huntType = pokemon.hunt_type || "encounter";
  const hasCharm = pokemon.shiny_charm ?? false;
  if (gameKey) {
    const sparkling = pokemon.sparkling_power ?? 0;
    const odds = getMethodOdds(gameKey, huntType, hasCharm, sparkling);
    return applyShinyVariantOdds(gameKey, huntType, odds, pokemon.shiny_variant);
  }
  return [1, 4096];
}

/** Returns whether a sparkle variant actually reshapes this pokemon's odds. */
function usesShinyVariant(pokemon: Pokemon | null): boolean {
  if (!pokemon?.shiny_variant) return false;
  return gameSupportsShinyVariant(pokemon.game ?? "");
}

/** Returns the static fractional odds for the given pokemon, e.g. "1/4096". */
export function getOddsFractional(pokemon: Pokemon | null): string {
  const odds = resolveOddsTuple(pokemon);
  return usesShinyVariant(pokemon) ? formatOddsApprox(odds) : formatOdds(odds);
}

/**
 * Resolves the encounter count the cumulative probability is based on.
 *
 * Callers that track phased hunts pass the total across all phases here.
 * Handing over a plain number instead of a patched pokemon copy is deliberate:
 * a spread clone would break the `useMemo` identity of every caller that keys
 * its memo on the pokemon object.
 */
function resolveEncounters(pokemon: Pokemon | null, override?: number): number {
  const raw = override ?? pokemon?.encounters ?? 0;
  return Math.max(0, raw);
}

/**
 * Returns the cumulative shiny probability after the pokemon's current
 * encounter count as a formatted percentage (e.g. "63.2%").
 * Pass `encountersOverride` to base the result on a different count, e.g. the
 * total encounters of a phased hunt.
 * Edge cases: missing pokemon or non-positive encounter counts return "0.0%";
 * a probability that exceeds 1 is capped at "100.0%".
 */
export function getOddsPercent(pokemon: Pokemon | null, encountersOverride?: number): string {
  if (!pokemon) return "0.0%";
  const [num, denom] = resolveOddsTuple(pokemon);
  if (denom <= 0) return "0.0%";
  const p = num / denom;
  const encounters = resolveEncounters(pokemon, encountersOverride);
  if (encounters === 0) return "0.0%";
  if (p >= 1) return "100.0%";
  const cumulative = 1 - Math.pow(1 - p, encounters);
  return `${(cumulative * 100).toFixed(1)}%`;
}

/**
 * Dispatches to fractional or percent formatting based on the format key.
 * `encountersOverride` only affects the percent mode, the fractional odds do
 * not depend on the encounter count.
 */
export function computeOddsDisplay(
  pokemon: Pokemon | null,
  format: "fractional" | "percent",
  encountersOverride?: number,
): string {
  return format === "percent"
    ? getOddsPercent(pokemon, encountersOverride)
    : getOddsFractional(pokemon);
}

/**
 * Returns the expected number of encounters required to reach the given
 * cumulative probability target for a pokemon's current odds configuration.
 * Uses the inverse `n = ln(1 − target) / ln(1 − p)`.
 *
 * Returns null when the result is undefined (p ≥ 1, p ≤ 0, target ≤ 0,
 * target ≥ 1, or pokemon missing).
 */
export function encountersForProbability(pokemon: Pokemon | null, target: number): number | null {
  if (!pokemon) return null;
  if (target <= 0 || target >= 1) return null;
  const [num, denom] = resolveOddsTuple(pokemon);
  if (denom <= 0) return null;
  const p = num / denom;
  if (p <= 0 || p >= 1) return null;
  const n = Math.log(1 - target) / Math.log(1 - p);
  return Math.ceil(n);
}

/** One milestone entry returned by {@link getOddsMilestones}. */
export interface OddsMilestone {
  /** Cumulative probability target in the range (0, 1). */
  target: number;
  /** Number of encounters required to reach the target, or null if undefined. */
  encounters: number | null;
  /**
   * Estimated time to reach the target in milliseconds from the current
   * encounter count, or null when no rate was provided or the target is
   * already reached.
   */
  etaMs: number | null;
}

const DEFAULT_MILESTONE_TARGETS = [0.5, 0.75, 0.9, 0.99];

/**
 * Returns cumulative-probability milestones for the pokemon's current
 * configuration. When `ratePerHour > 0`, each milestone also carries a
 * remaining-ETA in milliseconds based on the pokemon's `encounters`, or on
 * `encountersOverride` when the caller tracks a total across phases.
 */
export function getOddsMilestones(
  pokemon: Pokemon | null,
  targets: number[] = DEFAULT_MILESTONE_TARGETS,
  ratePerHour?: number,
  encountersOverride?: number,
): OddsMilestone[] {
  const current = resolveEncounters(pokemon, encountersOverride);
  const rateMs = ratePerHour && ratePerHour > 0 ? ratePerHour / 3_600_000 : 0;

  return targets.map((target) => {
    const encounters = encountersForProbability(pokemon, target);
    let etaMs: number | null = null;
    if (encounters !== null && rateMs > 0) {
      const remaining = Math.max(0, encounters - current);
      etaMs = remaining / rateMs;
    }
    return { target, encounters, etaMs };
  });
}

/** One point on the probability curve. */
export interface ProbabilityPoint {
  n: number;
  p: number;
}

/**
 * Builds an evenly-spaced sample of the cumulative probability curve
 * `P(n) = 1 − (1 − p)^n` from 0 to `maxEncounters` (inclusive).
 * Returns an empty array when p is undefined (no pokemon or p ≤ 0).
 */
export function buildProbabilityCurve(
  pokemon: Pokemon | null,
  maxEncounters: number,
  points = 60,
): ProbabilityPoint[] {
  if (!pokemon) return [];
  const [num, denom] = resolveOddsTuple(pokemon);
  if (denom <= 0) return [];
  const p = num / denom;
  if (p <= 0) return [];
  const sampleCount = Math.max(2, points);
  const upper = Math.max(1, Math.round(maxEncounters));
  const step = upper / (sampleCount - 1);
  const out: ProbabilityPoint[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const n = Math.round(i * step);
    const pCum = p >= 1 ? 1 : 1 - Math.pow(1 - p, n);
    out.push({ n, p: pCum });
  }
  return out;
}
