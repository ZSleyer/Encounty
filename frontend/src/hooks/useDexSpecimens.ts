import { useCallback, useEffect, useState } from "react";
import type { CatchMeta } from "../types";
import { apiUrl } from "../utils/api";

export interface DexSpecimen {
  id: number;
  pokedex_id: string;
  species_id: number;
  form_canonical?: string;
  gender?: string;
  game?: string;
  meta?: CatchMeta;
}

export type SpecimenInput = Omit<DexSpecimen, "id" | "pokedex_id"> & { id?: number };

export function useDexSpecimens(pokedexId = "default") {
  const [specimens, setSpecimens] = useState<DexSpecimen[]>([]);
  const reload = useCallback(async () => {
    const response = await fetch(apiUrl(`/api/pokedex/specimens?pokedex_id=${encodeURIComponent(pokedexId)}`));
    if (response.ok) setSpecimens(await response.json() as DexSpecimen[]);
  }, [pokedexId]);
  useEffect(() => { void reload(); }, [reload]);
  const saveSpecimen = async (input: SpecimenInput) => {
    const response = await fetch(apiUrl(input.id ? `/api/pokedex/specimens/${input.id}` : "/api/pokedex/specimens"), {
      method: input.id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, pokedex_id: pokedexId }),
    });
    if (!response.ok) throw new Error("failed to save specimen");
    await reload();
  };
  const removeSpecimen = async (id: number) => {
    const response = await fetch(apiUrl(`/api/pokedex/specimens/${id}`), { method: "DELETE" });
    if (!response.ok) throw new Error("failed to delete specimen");
    await reload();
  };
  return { specimens, saveSpecimen, removeSpecimen, reload };
}
