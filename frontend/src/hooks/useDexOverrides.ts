/**
 * useDexOverrides.ts: manual caught/seen overrides for Pokédex species that
 * were never actually hunted through the app.
 *
 * Mirrors useCatchRefs.ts's fetch-once-on-mount shape: a swallowed failure
 * still leaves the feature usable (the modal just starts from an empty list),
 * and `setOverride` updates the local list optimistically from the response
 * body so a caller re-renders immediately, without a refetch round trip.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiUrl } from "../utils/api";
import type { DexOverride } from "../utils/dex";
import type { CatchMeta } from "../types";

// --- Wire types ---

/** Raw payload of one row from GET/PUT /api/pokedex/overrides. */
interface OverridePayload {
  id: number;
  species_id: number;
  form_canonical?: string;
  gender?: string;
  game?: string;
  caught: boolean;
  seen: boolean;
  updated_at: string;
  /** Field names inside already match CatchMeta; no snake_case mapping needed. */
  meta?: CatchMeta;
}

/** snake_case wire payload to the camelCase shape the app works with. */
function fromPayload(o: OverridePayload): DexOverride {
  return {
    id: o.id,
    speciesId: o.species_id,
    formCanonical: o.form_canonical ?? "",
    gender: o.gender ?? "",
    game: o.game ?? "",
    caught: o.caught,
    seen: o.seen,
    meta: o.meta,
  };
}

// --- Hook ---

/** Scope identifying one override row: which species/form/gender/game it targets. */
export interface DexOverrideScope {
  speciesId: number;
  formCanonical: string;
  gender: string;
  game: string;
}

/** Input to {@link DexOverridesData.setOverride}. */
export interface SetOverrideInput extends DexOverrideScope {
  caught: boolean;
  seen: boolean;
  /**
   * Catch details to write. Omit entirely (do not pass `undefined` on
   * purpose either, though `JSON.stringify` drops it either way) when there
   * is nothing new to record: the backend leaves the stored meta on the row
   * untouched when the key is absent from the request body, and only clears
   * it when an explicit empty object is sent.
   */
  meta?: CatchMeta;
}

/** Everything {@link useDexOverrides} hands to its consumers. */
export interface DexOverridesData {
  /** Every override currently known, across all species. */
  overrides: DexOverride[];
  /**
   * Writes one override. The backend deletes the row (204, no body) when both
   * `caught` and `seen` are false; the local list drops the entry to match.
   */
  setOverride: (input: SetOverrideInput) => Promise<void>;
  /** True while the initial fetch is still in flight. */
  loading: boolean;
  /** Set when the initial fetch or the most recent `setOverride` call failed. */
  error: string | null;
}

/** True when two scopes address the same species/form/gender/game combination. */
function sameScope(a: DexOverrideScope, b: DexOverrideScope): boolean {
  return (
    a.speciesId === b.speciesId &&
    a.formCanonical === b.formCanonical &&
    a.gender === b.gender &&
    a.game === b.game
  );
}

/**
 * Loads every manual override once on mount and exposes a writer that keeps
 * the local list in sync with what the backend just persisted.
 */
export function useDexOverrides(): DexOverridesData {
  const [overrides, setOverrides] = useState<DexOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl("/api/pokedex/overrides"))
      .then((r) => r.json())
      .then((data: OverridePayload[]) => {
        if (cancelled || !Array.isArray(data)) return;
        setOverrides(data.map(fromPayload));
      })
      .catch(() => {
        if (!cancelled) setError("failed to load overrides");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setOverride = useCallback(async (input: SetOverrideInput) => {
    setError(null);
    try {
      const res = await fetch(apiUrl("/api/pokedex/overrides"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // meta is only included when the caller actually has one to write:
        // JSON.stringify drops an undefined-valued key entirely, so a plain
        // caught/seen toggle (which never sets input.meta) omits the key and
        // the backend leaves the stored meta on the row untouched.
        body: JSON.stringify({
          species_id: input.speciesId,
          form_canonical: input.formCanonical,
          gender: input.gender,
          game: input.game,
          caught: input.caught,
          seen: input.seen,
          meta: input.meta,
        }),
      });
      if (!res.ok) throw new Error(`setOverride failed: ${res.status}`);

      // 204 is the backend's delete shape: both flags were false, and the row
      // is gone server-side, so it drops out of the local list too.
      if (res.status === 204) {
        setOverrides((prev) => prev.filter((o) => !sameScope(o, input)));
        return;
      }
      const body: OverridePayload = await res.json();
      const next = fromPayload(body);
      setOverrides((prev) => {
        const idx = prev.findIndex((o) => sameScope(o, input));
        if (idx === -1) return [...prev, next];
        const copy = [...prev];
        copy[idx] = next;
        return copy;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to save override");
      throw e;
    }
  }, []);

  return useMemo(
    () => ({ overrides, setOverride, loading, error }),
    [overrides, setOverride, loading, error],
  );
}
