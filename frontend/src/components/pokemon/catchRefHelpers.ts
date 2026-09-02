/**
 * catchRefHelpers.ts: Pure lookup and filtering helpers over the catch
 * reference catalogs (balls, natures, abilities, locations, marks) that the
 * catch metadata dialog offers as suggestions.
 */
import { refLabel, type BallRef, type CatchRefEntry } from "../../hooks/useCatchRefs";

/** How many suggestions a free-text field offers at once. */
export const SUGGESTION_LIMIT = 50;

/**
 * Catalog entries whose localized name starts with what was typed, capped at
 * {@link SUGGESTION_LIMIT}. An empty query offers the head of the catalog.
 */
export function matchingRefs(
  entries: readonly CatchRefEntry[],
  query: string,
  locale: string,
): CatchRefEntry[] {
  const needle = query.trim().toLowerCase();
  const matching = needle
    ? entries.filter((entry) => refLabel(entry, locale).toLowerCase().startsWith(needle))
    : entries;
  return matching.slice(0, SUGGESTION_LIMIT);
}

/** Renders a numeric string, keeping "" for unset. Non-digits are dropped. */
export function digitsOnly(raw: string, maxLength: number): string {
  return raw.replace(/\D/g, "").slice(0, maxLength);
}

/** Localized names sorted for the current locale. */
export function sortedByLabel<T extends CatchRefEntry>(entries: T[], locale: string): T[] {
  return [...entries].sort((a, b) =>
    refLabel(a, locale).localeCompare(refLabel(b, locale), locale),
  );
}

/**
 * Reports whether a ball can be obtained in the given game. A ball scoped to
 * game keys wins over the generation, because the Legends Arceus balls are
 * reported for generation 8 and 9 although they exist in a single game, and
 * their German names collide with the regular balls of those generations.
 */
export function ballFitsGame(entry: BallRef, gameKey: string, generation: number): boolean {
  if (entry.games?.length) return entry.games.includes(gameKey);
  return entry.generations?.includes(generation) ?? false;
}
