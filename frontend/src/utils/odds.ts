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
import { formatOdds, getMethodOdds } from "./gameGroups";

/** Resolves the base fractional odds tuple for a pokemon's current configuration. */
function resolveOddsTuple(pokemon: Pokemon | null): [number, number] {
  if (!pokemon) return [1, 4096];
  const gameKey = pokemon.game ?? "";
  const huntType = pokemon.hunt_type || "encounter";
  const hasCharm = pokemon.shiny_charm ?? false;
  if (gameKey) {
    return getMethodOdds(gameKey, huntType, hasCharm);
  }
  return [1, 4096];
}

/** Returns the static fractional odds for the given pokemon, e.g. "1/4096". */
export function getOddsFractional(pokemon: Pokemon | null): string {
  return formatOdds(resolveOddsTuple(pokemon));
}

/**
 * Returns the cumulative shiny probability after the pokemon's current
 * encounter count as a formatted percentage (e.g. "63.2%").
 * Edge cases: missing pokemon or non-positive encounter counts return "0.0%";
 * a probability that exceeds 1 is capped at "100.0%".
 */
export function getOddsPercent(pokemon: Pokemon | null): string {
  if (!pokemon) return "0.0%";
  const [num, denom] = resolveOddsTuple(pokemon);
  if (denom <= 0) return "0.0%";
  const p = num / denom;
  const encounters = Math.max(0, pokemon.encounters ?? 0);
  if (encounters === 0) return "0.0%";
  if (p >= 1) return "100.0%";
  const cumulative = 1 - Math.pow(1 - p, encounters);
  return `${(cumulative * 100).toFixed(1)}%`;
}

/** Dispatches to fractional or percent formatting based on the format key. */
export function computeOddsDisplay(
  pokemon: Pokemon | null,
  format: "fractional" | "percent",
): string {
  return format === "percent" ? getOddsPercent(pokemon) : getOddsFractional(pokemon);
}
