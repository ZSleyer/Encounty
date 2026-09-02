/**
 * phaseHelpers.ts: Phase lookups and payloads for the Dashboard.
 *
 * A phase is an archived entry pointing at the hunt it interrupted. These
 * helpers build the per-render lookups the sidebar needs and the species
 * payload a phase entry is created from.
 */

import { Pokemon } from "../../types";
import { pokemonDisplayName } from "../../utils/pokemon";
import { phaseChildren } from "../../utils/phase";
import { isCustomSprite, getBoxSpriteUrl } from "../../utils/sprites";

/** Species data the end-phase modal returns for the foreign shiny that ended a phase. */
export interface PhaseCatchPayload {
  canonical_name: string;
  name: string;
  base_name?: string;
  form_name?: string;
  sprite_url: string;
}

/**
 * Builds the phase catch for a target that got away while the hunt continues.
 *
 * Unlike the off-target case there is nothing to ask: the species is the hunt's
 * own. Only the sprite needs work, because a phase entry is always shiny while
 * the hunt may well be showing the normal sprite, and an uploaded image belongs
 * to the hunt rather than to its archive. Both of those fall back to the box
 * sprite, which is name-based and therefore resolves for forms too.
 *
 * That fallback ignores the hunt's sprite style, so a hunt on animated or 3D
 * sprites gets a box sprite in its phase history. Matching the style would mean
 * resolving the species' numeric id through the pokedex, which is what
 * EndPhaseModal does with the entry its search already handed it.
 */
export function targetPhaseCatch(hunt: Pokemon): PhaseCatchPayload {
  const ownSpriteFits = hunt.sprite_type === "shiny" && !isCustomSprite(hunt.sprite_url);
  return {
    canonical_name: hunt.canonical_name,
    name: hunt.name,
    base_name: hunt.base_name,
    form_name: hunt.form_name,
    sprite_url: ownSpriteFits ? hunt.sprite_url : getBoxSpriteUrl(hunt.canonical_name, "shiny"),
  };
}

/** Per-render phase lookups for the sidebar, so a long list stays linear. */
export interface PhaseIndex {
  /** Parent hunt id → highest phase number already finished below it. */
  latestPhase: Map<string, number>;
  /** Pokémon id → display name, used to resolve the parent of a phase entry. */
  nameById: Map<string, string>;
}

/** Builds both sidebar phase lookups in a single pass over the snapshot. */
export function buildPhaseIndex(all: Pokemon[]): PhaseIndex {
  const latestPhase = new Map<string, number>();
  const nameById = new Map<string, string>();
  for (const p of all) {
    nameById.set(p.id, pokemonDisplayName(p));
    const parentId = p.phase_of;
    // A corrupted snapshot pointing an entry at itself must not make it its own phase.
    if (!parentId || parentId === p.id) continue;
    const number = p.phase_number ?? 0;
    if (number > (latestPhase.get(parentId) ?? 0)) latestPhase.set(parentId, number);
  }
  return { latestPhase, nameById };
}

/**
 * Describes where a phase entry came from, or returns null for a regular hunt.
 * Falls back to the bare phase number once the parent hunt has been deleted.
 */
export function phaseOriginLabel(
  pokemon: Pokemon,
  parentName: string | undefined,
  t: (key: string, options?: Record<string, string | number>) => string,
): string | null {
  if (!pokemon.phase_of) return null;
  const number = pokemon.phase_number ?? 0;
  if (parentName) return t("phase.ofHunt", { number, name: parentName });
  return `${t("phase.badge", { number })} · ${t("phase.orphaned")}`;
}

/**
 * Reports whether the entry is the most recent phase of a parent that still
 * exists. Only that phase can be undone, matching the backend rule.
 */
export function isNewestPhase(pokemon: Pokemon, all: Pokemon[]): boolean {
  const parentId = pokemon.phase_of;
  if (!parentId || !all.some((p) => p.id === parentId)) return false;
  const siblings = phaseChildren(all, parentId);
  return siblings[siblings.length - 1]?.id === pokemon.id;
}
