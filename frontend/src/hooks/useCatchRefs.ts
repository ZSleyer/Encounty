/**
 * useCatchRefs.ts: Loads the reference catalogs behind the catch metadata
 * UI: natures, balls, abilities, ribbons, marks and the location list of one
 * game group.
 *
 * Both backend endpoints answer with `Cache-Control: max-age=86400`, but the
 * HTTP cache cannot help with the part that actually hurts: one
 * `CatchMetaSummary` is rendered per catch, so a species with 54 catches used
 * to start 54 identical requests and then run 54 rounds of state updates for
 * catalogs that never change during a session. The module-level cache below
 * collapses that into a single load whose result later mounts read
 * synchronously, without rendering twice.
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
  /**
   * Game keys the ball is limited to. Set only where the generation is too
   * coarse, and then it wins over `generations`.
   */
  games?: string[];
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

/** Empty catalogs, used before the first response and after a failure. */
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
export function refLabelFor(list: readonly CatchRefEntry[], value: string, locale: string): string {
  const entry = list.find((e) => e.slug === value);
  return entry ? refLabel(entry, locale) : value;
}

// --- Session cache ---

/** Settled catalogs of this session; `null` until the first load succeeded. */
let refsCache: Required<CatchRefsResponse> | null = null;
/** The one in-flight catalog request every concurrent mount awaits. */
let refsPromise: Promise<Required<CatchRefsResponse>> | null = null;
/** Settled location lists per game key. */
const locationsCache = new Map<string, CatchRefEntry[]>();
/** In-flight location requests per game key. */
const locationsPromises = new Map<string, Promise<CatchRefEntry[]>>();

/** Drops every list the payload does not carry as an array. */
function normalizeRefs(data: CatchRefsResponse): Required<CatchRefsResponse> {
  return {
    natures: Array.isArray(data.natures) ? data.natures : [],
    balls: Array.isArray(data.balls) ? data.balls : [],
    abilities: Array.isArray(data.abilities) ? data.abilities : [],
    ribbons: Array.isArray(data.ribbons) ? data.ribbons : [],
    marks: Array.isArray(data.marks) ? data.marks : [],
  };
}

/**
 * Fetches a JSON object from the backend. Rejects on anything unusable, which
 * is what keeps an unusable answer out of the cache.
 */
async function fetchObject(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(apiUrl(path));
  if (!res.ok) throw new Error(`${path} responded ${res.status}`);
  const data: unknown = await res.json();
  if (!data || typeof data !== "object") throw new Error(`${path} did not return an object`);
  return data as Record<string, unknown>;
}

/**
 * The reference catalogs, fetched at most once per session.
 *
 * A failure is deliberately not remembered: the backend may still be starting
 * up when the first summary mounts, and a cached empty catalog would then
 * outlive the outage until the window reloads.
 */
function loadRefs(): Promise<Required<CatchRefsResponse>> {
  refsPromise ??= fetchObject("/api/catch-refs")
    .then((data) => {
      const refs = normalizeRefs(data as CatchRefsResponse);
      refsCache = refs;
      return refs;
    })
    .catch((err: unknown) => {
      refsPromise = null;
      throw err;
    });
  return refsPromise;
}

/** The location list of one game group, fetched at most once. Retries as above. */
function loadLocations(game: string): Promise<CatchRefEntry[]> {
  let pending = locationsPromises.get(game);
  if (!pending) {
    pending = fetchObject(`/api/catch-refs/locations?game=${encodeURIComponent(game)}`)
      .then((data) => {
        const { locations } = data as LocationsResponse;
        const list = Array.isArray(locations) ? locations : [];
        locationsCache.set(game, list);
        return list;
      })
      .catch((err: unknown) => {
        locationsPromises.delete(game);
        throw err;
      });
    locationsPromises.set(game, pending);
  }
  return pending;
}

// --- Hook ---

/**
 * Serves the catch reference catalogs and reloads the location list whenever
 * `game` changes. Both are fetched once per session and shared across mounts.
 *
 * Failures are swallowed: the catch metadata form stays usable with empty
 * catalogs, every field of it degrades to plain text or an empty select.
 *
 * @param game Game key whose location list is loaded; omit to skip locations.
 */
export function useCatchRefs(game?: string): CatchRefsData {
  // Seeded from the cache rather than filled in by an effect, so a mount that
  // arrives after the first load renders the catalogs immediately and never
  // updates state at all.
  const [refs, setRefs] = useState<Required<CatchRefsResponse>>(() => refsCache ?? EMPTY_REFS);
  const [locations, setLocations] = useState<CatchRefEntry[]>(
    () => (game ? locationsCache.get(game) : undefined) ?? [],
  );
  const [refsLoading, setRefsLoading] = useState(refsCache === null);
  const [locationsLoading, setLocationsLoading] = useState(() =>
    game ? !locationsCache.has(game) : false,
  );

  useEffect(() => {
    if (refsCache) return;
    let canceled = false;
    loadRefs()
      .then((data) => {
        if (!canceled) setRefs(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!canceled) setRefsLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (!game) {
      // Identity-preserving, because a fresh [] would re-render every consumer
      // that keys a memo on the list, on every mount, for no new data.
      setLocations((prev) => (prev.length === 0 ? prev : []));
      setLocationsLoading(false);
      return;
    }
    const cached = locationsCache.get(game);
    if (cached) {
      setLocations(cached);
      setLocationsLoading(false);
      return;
    }
    // `canceled` guards against a slower earlier response overwriting the
    // list of the game the user switched to in the meantime.
    let canceled = false;
    setLocationsLoading(true);
    loadLocations(game)
      .then((list) => {
        if (!canceled) setLocations(list);
      })
      .catch(() => {
        if (!canceled) setLocations([]);
      })
      .finally(() => {
        if (!canceled) setLocationsLoading(false);
      });
    return () => {
      canceled = true;
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
