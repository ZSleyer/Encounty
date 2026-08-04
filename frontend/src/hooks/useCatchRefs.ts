/**
 * useCatchRefs.ts: Loads the reference catalogues behind the catch metadata
 * UI: natures, balls, abilities, ribbons, marks and the location list of one
 * game group.
 *
 * Both backend endpoints answer with `Cache-Control: max-age=86400`, so the
 * browser cache is the only cache layer needed here.
 */
import { useEffect, useMemo, useState } from "react";
import { apiUrl } from "../utils/api";

// --- Types ---

/** Shared shape of every reference entry: a stable slug plus localized names. */
export interface CatchRefEntry {
  /** Stable identifier persisted in CatchMeta. */
  slug: string;
  /** Localized display names keyed by locale code. */
  names: Record<string, string>;
}

/** A nature with the stats it raises and lowers (absent for neutral natures). */
export interface NatureRef extends CatchRefEntry {
  raises?: string;
  lowers?: string;
}

/** A Poké Ball with the generations it exists in. */
export interface BallRef extends CatchRefEntry {
  generations: number[];
}

/** A ribbon with its introducing generation and grouping category. */
export interface RibbonRef extends CatchRefEntry {
  gen?: number;
  category?: string;
}

/** A mark with its introducing generation. */
export interface MarkRef extends CatchRefEntry {
  gen?: number;
}

/** Raw payload of GET /api/catch-refs. */
interface CatchRefsResponse {
  natures?: NatureRef[];
  balls?: BallRef[];
  abilities?: CatchRefEntry[];
  ribbons?: RibbonRef[];
  marks?: MarkRef[];
}

/** Raw payload of GET /api/catch-refs/locations. */
interface LocationsResponse {
  group?: string;
  locations?: CatchRefEntry[];
}

/** Everything {@link useCatchRefs} hands to its consumers. */
export interface CatchRefsData {
  natures: NatureRef[];
  balls: BallRef[];
  abilities: CatchRefEntry[];
  ribbons: RibbonRef[];
  marks: MarkRef[];
  /** Locations of the requested game's group; empty for an unknown game. */
  locations: CatchRefEntry[];
  /** True while either request is still in flight. */
  loading: boolean;
  /** Localized name of an entry with an English and slug fallback. */
  label: (entry: CatchRefEntry, locale: string) => string;
}

// --- Helpers ---

/** Empty catalogues, used before the first response and after a failure. */
const EMPTY_REFS: Required<CatchRefsResponse> = {
  natures: [],
  balls: [],
  abilities: [],
  ribbons: [],
  marks: [],
};

/**
 * Localized name of a reference entry. Falls back to English and finally to
 * the slug, so an incomplete translation still renders something meaningful.
 */
export function refLabel(entry: CatchRefEntry, locale: string): string {
  return entry.names?.[locale] || entry.names?.en || entry.slug;
}

/**
 * Localized name of the entry carrying `value` as its slug. Unknown values are
 * returned verbatim, which is what free-text fields (location, ability) store.
 */
export function refLabelFor(
  list: readonly CatchRefEntry[],
  value: string,
  locale: string,
): string {
  const entry = list.find((e) => e.slug === value);
  return entry ? refLabel(entry, locale) : value;
}

// --- Hook ---

/**
 * Fetches the catch reference catalogues once per mount and reloads the
 * location list whenever `game` changes.
 *
 * Failures are swallowed: the catch metadata form stays usable with empty
 * catalogues, every field of it degrades to plain text or an empty select.
 *
 * @param game Game key whose location list is loaded; omit to skip locations.
 */
export function useCatchRefs(game?: string): CatchRefsData {
  const [refs, setRefs] = useState<Required<CatchRefsResponse>>(EMPTY_REFS);
  const [locations, setLocations] = useState<CatchRefEntry[]>([]);
  const [refsLoading, setRefsLoading] = useState(true);
  const [locationsLoading, setLocationsLoading] = useState(Boolean(game));

  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl("/api/catch-refs"))
      .then((r) => r.json())
      .then((data: CatchRefsResponse) => {
        if (cancelled || !data || typeof data !== "object") return;
        setRefs({
          natures: Array.isArray(data.natures) ? data.natures : [],
          balls: Array.isArray(data.balls) ? data.balls : [],
          abilities: Array.isArray(data.abilities) ? data.abilities : [],
          ribbons: Array.isArray(data.ribbons) ? data.ribbons : [],
          marks: Array.isArray(data.marks) ? data.marks : [],
        });
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setRefsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!game) {
      setLocations([]);
      setLocationsLoading(false);
      return;
    }
    // `cancelled` guards against a slower earlier response overwriting the
    // list of the game the user switched to in the meantime.
    let cancelled = false;
    setLocationsLoading(true);
    fetch(apiUrl(`/api/catch-refs/locations?game=${encodeURIComponent(game)}`))
      .then((r) => r.json())
      .then((data: LocationsResponse) => {
        if (cancelled) return;
        setLocations(Array.isArray(data?.locations) ? data.locations : []);
      })
      .catch(() => {
        if (!cancelled) setLocations([]);
      })
      .finally(() => {
        if (!cancelled) setLocationsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [game]);

  return useMemo(
    () => ({
      ...refs,
      locations,
      loading: refsLoading || locationsLoading,
      label: refLabel,
    }),
    [refs, locations, refsLoading, locationsLoading],
  );
}
