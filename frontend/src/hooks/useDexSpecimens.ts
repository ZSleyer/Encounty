import { useCallback, useEffect, useState } from "react";
import type { CatchMeta } from "../types";
import { apiUrl } from "../utils/api";

/** A single manually added Pokédex catch. */
export interface DexSpecimen {
  id: number;
  pokedex_id: string;
  species_id: number;
  form_canonical?: string;
  gender?: string;
  game?: string;
  completed_at?: string;
  hunt_type?: string;
  encounters?: number;
  timer_accumulated_ms?: number;
  /** Id of the specimen this row is a phase of. 0 or absent on a regular catch. */
  phase_of?: number;
  /** Frozen phase number of this row. 0 or absent on a non-phase. */
  phase_number?: number;
  meta?: CatchMeta;
}

/** Payload for creating (no id) or updating (with id) a specimen. */
export type SpecimenInput = Omit<DexSpecimen, "id" | "pokedex_id"> & { id?: number };

/**
 * Loads the specimens of a Pokédex and exposes create, update and delete.
 *
 * `saveSpecimen` returns the persisted row so a caller can attach phases to a
 * freshly created specimen without waiting for the next render.
 */
export function useDexSpecimens(pokedexId = "default") {
  const [specimens, setSpecimens] = useState<DexSpecimen[]>([]);
  const reload = useCallback(async () => {
    const response = await fetch(apiUrl(`/api/pokedex/specimens?pokedex_id=${encodeURIComponent(pokedexId)}`));
    if (response.ok) setSpecimens(await response.json() as DexSpecimen[]);
  }, [pokedexId]);
  useEffect(() => { void reload(); }, [reload]);
  const saveSpecimen = async (input: SpecimenInput): Promise<DexSpecimen> => {
    const response = await fetch(apiUrl(input.id ? `/api/pokedex/specimens/${input.id}` : "/api/pokedex/specimens"), {
      method: input.id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, pokedex_id: pokedexId }),
    });
    if (!response.ok) throw new Error("failed to save specimen");
    // The response carries the persisted row, the only place the id of a newly
    // created specimen is available to the caller.
    const saved = await response.json() as DexSpecimen;
    await reload();
    return saved;
  };
  const removeSpecimen = async (id: number) => {
    const response = await fetch(apiUrl(`/api/pokedex/specimens/${id}`), { method: "DELETE" });
    if (!response.ok) throw new Error("failed to delete specimen");
    await reload();
  };
  return { specimens, saveSpecimen, removeSpecimen, reload };
}
