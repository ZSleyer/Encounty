/**
 * sidebarSort.ts: Search filter and sort order of the sidebar hunt list.
 *
 * Holds the persisted sort preference and the comparators the list applies to
 * a snapshot before rendering it.
 */

import { Pokemon } from "../../types";
import { pokemonDisplayName } from "../../utils/pokemon";
import type { SortDir, SortMode } from "./types";

/** Filters a Pokemon list by a search query, matching name, canonical name, or game. */
export function filterPokemonByQuery(list: Pokemon[], query: string): Pokemon[] {
  if (!query) return list;
  return list.filter(
    (p) =>
      pokemonDisplayName(p).toLowerCase().includes(query) ||
      p.canonical_name.toLowerCase().includes(query) ||
      p.game?.toLowerCase().includes(query),
  );
}

/** Loads the persisted sort mode from localStorage, defaulting to "recent". */
export function loadSortMode(): SortMode {
  return (localStorage.getItem("encounty-sort-mode") as SortMode) || "recent";
}

/** Loads the persisted sort direction from localStorage, defaulting to "asc". */
export function loadSortDir(): SortDir {
  return (localStorage.getItem("encounty-sort-dir") as SortDir) || "asc";
}

/** Sorts a Pokemon list by the given mode and direction. */
export function sortPokemonList(list: Pokemon[], mode: SortMode, dir: SortDir): Pokemon[] {
  if (mode === "recent") return dir === "asc" ? list : [...list].reverse();
  // Manual order is absolute (set via drag-and-drop); direction does not apply.
  // Legacy items without sort_order sort to the end.
  if (mode === "manual") {
    return [...list].sort(
      (a, b) =>
        (a.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.sort_order ?? Number.MAX_SAFE_INTEGER),
    );
  }
  const sorted = [...list].sort((a, b) => {
    if (mode === "name") return a.name.localeCompare(b.name);
    if (mode === "encounters") return a.encounters - b.encounters;
    if (mode === "game") return (a.game ?? "").localeCompare(b.game ?? "");
    return 0;
  });
  return dir === "desc" ? sorted.reverse() : sorted;
}

/** Handles sort button click: toggles direction if same mode, otherwise switches mode. */
export function handleSortClick(
  clickedMode: SortMode,
  currentMode: SortMode,
  setSortMode: (m: SortMode) => void,
  setSortDir: React.Dispatch<React.SetStateAction<SortDir>>,
  setShowMenu: (v: boolean) => void,
): void {
  if (clickedMode === currentMode) {
    setSortDir((d) => (d === "asc" ? "desc" : "asc"));
  } else {
    setSortMode(clickedMode);
    setSortDir("asc");
  }
  setShowMenu(false);
}
