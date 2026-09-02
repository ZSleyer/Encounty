/**
 * useVisibleSections.ts: Search filter over the settings section registry.
 */

import { useMemo } from "react";

import { SECTIONS } from "./sections";

/**
 * Return the ids of the sections matching the search query, or every section
 * id while the query is empty. Matches the translated title and the static
 * keyword list of each section.
 */
export function useVisibleSections(search: string, t: (key: string) => string): string[] {
  return useMemo(() => {
    if (!search.trim()) return SECTIONS.map((s) => s.id);
    const q = search.toLowerCase();
    return SECTIONS.filter(
      (s) => t(s.titleKey).toLowerCase().includes(q) || s.keywords.some((kw) => kw.includes(q)),
    ).map((s) => s.id);
  }, [search, t]);
}
