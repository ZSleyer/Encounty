/**
 * templateCategories.ts -- Chip colors for the region category names.
 */

/** Fixed palette for category chips. Regions sharing a category get the same hue. */
const CATEGORY_COLORS = [
  "#60a5fa",
  "#a78bfa",
  "#34d399",
  "#fbbf24",
  "#f472b6",
  "#22d3ee",
  "#fb923c",
  "#a3e635",
  "#f87171",
  "#c084fc",
] as const;

/**
 * Returns a stable chip color for a category name, or null for the default
 * (empty) category so unset regions render no chip and behave as before.
 */
export function categoryColor(category: string | undefined, order: string[]): string | null {
  const name = (category ?? "").trim();
  if (!name) return null;
  const idx = order.indexOf(name);
  const slot = idx >= 0 ? idx : order.length;
  return CATEGORY_COLORS[slot % CATEGORY_COLORS.length];
}
