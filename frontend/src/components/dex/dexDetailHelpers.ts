/**
 * dexDetailHelpers.ts: pure helpers behind the Pokédex species detail.
 *
 * Everything here turns one stored catch (or one manual override) into the
 * strings and counts its card renders. They used to live in
 * DexSpeciesDetail.tsx, next to the cards that were split out of it, and are
 * shared by several of those cards now.
 */
import type { computePhaseStats } from "../../utils/phase";
import { getGameName } from "../../utils/games";
import type { PokemonData, PokemonForm } from "../pokemon/pokemonPicker";
import type { DexOverride } from "../../utils/dex";
import type { GameEntry, Pokemon } from "../../types";

/** Form name of a catch, or the default-form label when it is the base species. */
export function formLabel(entry: Pokemon, canonical: string, fallback: string): string {
  if (entry.form_name) return entry.form_name;
  if (entry.canonical_name && entry.canonical_name !== canonical) return entry.canonical_name;
  return fallback;
}

/** Localized game name, falling back to the raw key for unknown games. */
export function gameLabel(
  entry: { game?: string },
  games: GameEntry[],
  languages: string[],
): string {
  const game = games.find((g) => g.key === entry.game);
  return game ? getGameName(game, languages) : (entry.game ?? "");
}

/** Completion date in the user's locale, empty when the timestamp is unusable. */
export function completionDate(
  entry: { completed_at?: string } | undefined,
  locale: string,
): string {
  if (!entry?.completed_at) return "";
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(entry.completed_at);
  const date = parts
    ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))
    : new Date(entry.completed_at);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(locale);
}

/**
 * Localized hunt method. An empty hunt type means the plain encounter, and a
 * type with no translation falls back to it too: a retired or foreign value
 * must never leak its raw i18n key into the UI.
 */
export function huntMethodLabel(
  t: (key: string, options?: Record<string, string | number>) => string,
  huntType: string | undefined,
): string {
  const fallback = t("huntType.encounter");
  if (!huntType) return fallback;
  const label = t(`huntType.${huntType}`);
  return label === `huntType.${huntType}` ? fallback : label;
}

/**
 * Phase context of one catch: which phase it froze, or how far the hunt it
 * belongs to has phased. Returns an empty string when phases never came up.
 */
export function phaseLabel(
  stats: ReturnType<typeof computePhaseStats>,
  t: (key: string, options?: Record<string, string | number>) => string,
): string {
  if (stats.isPhase) {
    return stats.parent
      ? t("phase.ofHunt", { number: stats.phaseNumber, name: stats.parent.name })
      : t("phase.badge", { number: stats.phaseNumber });
  }
  if (stats.children.length > 0) return t("phase.badge", { number: stats.phaseNumber });
  return "";
}

/**
 * Whether a catch started on this species instead of only evolving into it.
 *
 * The origin decides, never the last evolution step: a Venusaur that later
 * became Mega Venusaur is still a catch of slot 3, while a Doduo that became a
 * Dodrio only ever passed through the Dodrio slot.
 */
export function startedHere(
  entry: Pokemon,
  species: PokemonData | undefined,
  canonical: string,
): boolean {
  const origin = (entry.canonical_name ?? "").toLowerCase();
  if (!origin || origin === canonical.toLowerCase()) return true;
  return (species?.forms ?? []).some((form) => form.canonical.toLowerCase() === origin);
}

/** Number of distinct forms across the catches of one species. */
export function countForms(catches: Pokemon[], canonical: string, fallback: string): number {
  return new Set(catches.map((entry) => formLabel(entry, canonical, fallback))).size;
}

/**
 * Distinct source games in catch order, so the newest game comes first and the
 * chip row can be cut from the tail. Deduplication runs on the game key, not
 * on the label: several legacy keys share one display name.
 */
export function distinctGames(
  catches: Pokemon[],
  games: GameEntry[],
  languages: string[],
): { key: string; label: string }[] {
  const seen = new Set<string>();
  const result: { key: string; label: string }[] = [];
  for (const entry of catches) {
    if (seen.has(entry.game)) continue;
    seen.add(entry.game);
    result.push({ key: entry.game, label: gameLabel(entry, games, languages) });
  }
  return result;
}

/** Sprite identity for an override's scope: its own form when set, the base
 * species otherwise. Mirrors how a real catch's `canonical_name` picks the
 * sprite, so a manual entry's card looks the same as an archived one. */
export function spriteForOverride(
  o: DexOverride,
  forms: PokemonForm[],
  speciesId: number,
  speciesCanonical: string,
): { spriteId: number; canonical: string; spriteSlug?: string; gender?: "male" | "female" } {
  const form = o.formCanonical ? forms.find((f) => f.canonical === o.formCanonical) : undefined;
  if (form) {
    return {
      spriteId: form.sprite_id,
      canonical: form.canonical,
      spriteSlug: form.sprite_slug,
      gender: form.gender,
    };
  }
  return { spriteId: speciesId, canonical: speciesCanonical };
}
