/**
 * overlay.ts — Overlay resolution utility.
 *
 * Resolves which OverlaySettings a Pokemon should use based on its overlay_mode:
 * - "default": uses the app-level settings.overlay
 * - "custom": uses the Pokemon's own overlay
 * - "linked:<id>": follows the chain to the target Pokemon's resolved overlay
 *
 * Circular link detection prevents infinite loops.
 */
import type { Pokemon, OverlaySettings } from "../types";

/** Resolve the effective OverlaySettings for a Pokemon, following links if needed. */
export function resolveOverlay(
  pokemon: Pokemon,
  allPokemon: Pokemon[],
  defaultOverlay: OverlaySettings,
  visited?: Set<string>,
): OverlaySettings {
  const seen = visited ?? new Set<string>();
  if (seen.has(pokemon.id)) return defaultOverlay;
  seen.add(pokemon.id);

  if (pokemon.overlay_mode === "custom" && pokemon.overlay) {
    return pokemon.overlay;
  }
  if (pokemon.overlay_mode?.startsWith("linked:")) {
    const targetId = pokemon.overlay_mode.slice(7);
    const target = allPokemon.find((p) => p.id === targetId);
    if (target)
      return resolveOverlay(target, allPokemon, defaultOverlay, seen);
  }
  return defaultOverlay;
}

/**
 * Check whether linking fromId to toId would create a circular dependency.
 * Returns true if the link would be circular.
 */
export function wouldCreateCircularLink(
  fromId: string,
  toId: string,
  allPokemon: Pokemon[],
): boolean {
  const seen = new Set<string>();
  seen.add(fromId);
  let current = toId;
  while (current) {
    if (seen.has(current)) return true;
    seen.add(current);
    const p = allPokemon.find((x) => x.id === current);
    if (!p?.overlay_mode?.startsWith("linked:")) break;
    current = p.overlay_mode.slice(7);
  }
  return false;
}
