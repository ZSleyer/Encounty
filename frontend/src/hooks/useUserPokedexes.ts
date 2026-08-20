import { useCallback, useEffect, useState } from "react";
import { apiUrl } from "../utils/api";
import { DEFAULT_POKEDEX, type UserPokedex } from "../utils/userPokedex";

export function useUserPokedexes() {
  const [pokedexes, setPokedexes] = useState<UserPokedex[]>([DEFAULT_POKEDEX]);
  const [activeId, setActiveIdState] = useState(() => localStorage.getItem("encounty.active-pokedex") || "default");
  const reload = useCallback(async () => {
    const res = await fetch(apiUrl("/api/pokedexes"));
    if (!res.ok) return;
    const rows = await res.json() as UserPokedex[];
    if (rows.length && rows.every((row) => Array.isArray(row.form_categories))) setPokedexes(rows);
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  const setActiveId = (id: string) => { setActiveIdState(id); localStorage.setItem("encounty.active-pokedex", id); };
  const active = pokedexes.find((dex) => dex.id === activeId) ?? pokedexes[0] ?? DEFAULT_POKEDEX;
  const save = async (dex: UserPokedex) => {
    if (!dex.id) {
      const res = await fetch(apiUrl("/api/pokedexes"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dex) });
      if (!res.ok) throw new Error("failed to create pokedex");
      const rows = await res.json() as UserPokedex[];
      setPokedexes(rows);
      const created = rows[rows.length - 1];
      if (created) setActiveId(created.id);
      return;
    }
    const previous = pokedexes;
    setPokedexes((current) => current.map((item) => item.id === dex.id ? dex : item));
    const res = await fetch(apiUrl(`/api/pokedexes/${dex.id}`), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dex) });
    if (!res.ok) {
      setPokedexes(previous);
      throw new Error("failed to save pokedex");
    }
    await reload();
  };
  const remove = async (id: string) => {
    const res = await fetch(apiUrl(`/api/pokedexes/${id}`), { method: "DELETE" });
    if (!res.ok) throw new Error("failed to delete pokedex");
    setActiveId("default");
    await reload();
  };
  return { pokedexes, active, setActiveId, save, remove, reload };
}
