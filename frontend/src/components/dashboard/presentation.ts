/**
 * presentation.ts: Pure class-name, label and sprite-URL helpers.
 *
 * Everything here maps Pokemon data or UI state onto a string the markup can
 * use. No side effects and no React, so the sidebar, the header and the
 * counter panel can share the same styling decisions.
 */

import { Pokemon } from "../../types";
import { pokemonDisplayName } from "../../utils/pokemon";
import {
  SPRITE_FALLBACK,
  resolveSpriteSrc,
  cachedSpriteSrc,
  getBoxSpriteUrl,
} from "../../utils/sprites";

/** Returns the base name and form name from Pokemon data, or falls back to parsing the display name. */
export function getBaseAndFormName(p: Pokemon): [string, string | null] {
  if (p.nickname?.trim()) return [pokemonDisplayName(p), p.name];
  if (p.base_name || p.form_name) {
    return [p.base_name || p.name, p.form_name || null];
  }
  const m = p.name.match(/^(.+?)\s*\((.+)\)$/);
  return m ? [m[1], m[2]] : [p.name, null];
}

/**
 * Deterministic dot color for a tag, matching the djb2-derived hue used by
 * TagChip so the compact sidebar dots and the full chips stay color-consistent.
 */
export function tagDotColor(tag: string): string {
  let hash = 5381;
  for (let i = 0; i < tag.length; i++) {
    hash = (hash * 33) ^ tag.charCodeAt(i);
  }
  return `hsl(${Math.abs(hash) % 360}, 70%, 65%)`;
}

/** Formats a game key into a short display string. */
export function formatGame(game: string): string {
  return game ? game.replace("pokemon-", "").replace("letsgo", "L.G. ").toUpperCase() : "—";
}

/** Resolves detector dot styling and title for a sidebar Pokemon sprite. */
export function resolveDetectorDot(
  detectorStatus: Record<string, { state?: string; confidence?: number }>,
  pokemonId: string,
  t: (key: string) => string,
  isCapturing?: boolean,
): { dotClass: string; title: string } {
  const isMatch = detectorStatus[pokemonId]?.state === "match";
  const isRunning = !!detectorStatus[pokemonId];
  if (isMatch) return { dotClass: "bg-accent-green", title: t("detector.stateMatch") };
  if (isRunning)
    return { dotClass: "bg-accent-blue animate-pulse", title: t("detector.stateIdle") };
  if (isCapturing === false)
    return { dotClass: "bg-accent-red/60", title: t("detector.errNoSource") };
  return { dotClass: "bg-text-faint/40", title: t("detector.stopped") };
}

/**
 * Font size for the hero counter that shrinks as the number grows so extreme
 * encounter counts never overflow the panel.
 */
export function heroCounterFontSize(value: number): string {
  const len = String(value).length;
  if (len > 9) return "clamp(24px, 3vw, 40px)";
  if (len > 6) return "clamp(34px, 4vw, 56px)";
  return "clamp(48px, 5vw, 80px)";
}

/**
 * Builds the class for a sidebar tab button. `selectedColor` is the text color
 * the tab takes while it is the selected one.
 */
export function sidebarTabClass(isSelected: boolean, selectedColor: string): string {
  const state = isSelected ? selectedColor : "text-text-muted hover:text-text-secondary";
  return `flex-1 min-h-8 py-2 text-xs 2xl:text-sm font-semibold transition-colors relative ${state}`;
}

/**
 * Accessible name for a sidebar tab. The visible count badge is a bare number
 * and therefore hidden from assistive tech, so the name spells the count out.
 * Without entries the badge is absent and the visible label already suffices.
 */
export function sidebarTabLabel(
  label: string,
  count: number,
  t: (key: string, options?: Record<string, string | number>) => string,
): string | undefined {
  return count > 0 ? t("aria.sidebarTabCount", { label, count }) : undefined;
}

/** Returns the CSS class for a header tab button based on active state. */
export function tabButtonClass(isActive: boolean): string {
  // shrink-0 so a narrow window scrolls the strip instead of squeezing the tabs
  // into unreadable slivers.
  return `shrink-0 px-4 py-2 rounded-none text-xs font-semibold transition-all flex items-center gap-1.5 ${
    isActive
      ? "bg-accent-blue text-white shadow"
      : "text-text-muted hover:text-text-primary hover:bg-bg-hover"
  }`;
}

/** Tempest micro-label shown next to each panel tab icon, visible at all sizes. */
export function tabLabelClass(): string {
  return "uppercase tracking-[0.14em] text-[10px] font-semibold whitespace-nowrap";
}

/** Builds the full CSS class for a sidebar Pokemon list item. */
export function buildSidebarItemClass(borderClass: string, isFocused: boolean): string {
  const focusRing = isFocused ? " ring-1 ring-inset ring-accent-blue/40" : "";
  return `flex gap-2 2xl:gap-3 px-2.5 py-1.5 2xl:px-4 2xl:py-2 cursor-pointer transition-colors group ${borderClass}${focusRing}`;
}

/** Resolves the sprite URL for a Pokemon, falling back if there's an error or no URL. */
export function resolveSpriteUrl(
  pokemonId: string,
  spriteUrl: string | undefined,
  imgError: Record<string, string>,
): string {
  const src = resolveSpriteSrc(spriteUrl);
  return imgError[pokemonId] === src ? SPRITE_FALLBACK : src;
}

/**
 * Sprite URL for the sidebar rows, which always show the plain box sprite.
 *
 * The sidebar ignores the hunt's own sprite style and any uploaded image on
 * purpose: it is the one list that stays on screen permanently, and an animated
 * GIF there keeps the GPU process busy for as long as the app is open. Box
 * sprites are static and uniform in size, which also keeps the rows aligned.
 * Hunts without a canonical name (legacy snapshots) have no box sprite to
 * derive, so they fall back to the neutral silhouette.
 */
export function sidebarSpriteUrl(pokemon: Pokemon, imgError: Record<string, string>): string {
  if (!pokemon.canonical_name) return SPRITE_FALLBACK;
  const src = cachedSpriteSrc(getBoxSpriteUrl(pokemon.canonical_name, pokemon.sprite_type));
  return imgError[pokemon.id] === src ? SPRITE_FALLBACK : src;
}

/** Returns the border class for a sidebar Pokemon item based on selection state. */
export function sidebarItemBorderClass(isSelected: boolean, isViewed: boolean): string {
  if (isSelected) return "bg-accent-blue/15 border-l-2 border-accent-blue";
  if (isViewed) return "bg-accent-blue/10 border-l-2 border-accent-blue";
  return "hover:bg-bg-hover border-l-2 border-transparent";
}

/** Resolves the step label for encounter buttons (+N / -N). */
export function stepLabel(pokemon: Pokemon): string {
  return pokemon.step && pokemon.step > 1 ? String(pokemon.step) : "1";
}
