/**
 * dexFilters.ts: pure grid logic of the Pokédex page.
 *
 * Naming, searching, filtering, grouping and the arrow-key arithmetic of the
 * slot grid, all of it free of React so the page itself is left with state and
 * markup only.
 */
import { localeToPokemonLangs, type PokemonData } from "../../components/pokemon/pokemonPicker";
import type { DexEntry } from "../../utils/dex";
import type { CaughtFilter, DexGeneration, DexSlotView, VariantFilter } from "./types";

/** Rows a PageUp/PageDown jumps. */
const PAGE_ROWS = 5;

/**
 * Localized species name with the same fallback chain the pickers use, plus
 * the es-es/es-419 split that a single locale code cannot express.
 */
export function localizedName(species: PokemonData, locale: string): string {
  for (const lang of localeToPokemonLangs(locale)) {
    const name = species.names?.[lang];
    if (name) return name;
  }
  return species.names?.en ?? species.canonical;
}

/** Matches "25", "025", "#25" and "0025" against a dex number. */
export function matchesNumber(id: number, needle: string): boolean {
  const digits = needle.startsWith("#") ? needle.slice(1) : needle;
  if (!/^\d+$/.test(digits)) return false;
  return Number.parseInt(digits, 10) === id;
}

/** Search over the localized name, the English canonical and the dex number. */
export function matchesQuery(slot: DexSlotView, needle: string): boolean {
  if (!needle) return true;
  if (slot.name.toLowerCase().includes(needle)) return true;
  if (slot.canonical.includes(needle)) return true;
  return matchesNumber(slot.id, needle);
}

/**
 * Applies the caught-state filter to one slot. The four states partition the
 * slots: "seen" never also matches "missing", even though a seen slot is
 * technically "not caught" too, because the filter is about the distinct
 * visible state, not the caught boolean alone.
 */
export function matchesCaughtState(slot: DexSlotView, filter: CaughtFilter): boolean {
  if (filter === "caught") return slot.caught;
  if (filter === "seen") return slot.seenOnly;
  if (filter === "missing") return !slot.caught && !slot.seenOnly;
  return true;
}

/**
 * Applies the shiny variant filter. Slots without a recorded variant only show
 * up under "all": an unset variant is unknown, not a third kind of sparkle.
 */
export function matchesShinyVariant(slot: DexSlotView, filter: VariantFilter): boolean {
  if (filter === "all") return true;
  return slot.shinyVariants.includes(filter);
}

/** Groups the visible slots into generation blocks, ascending. */
export function groupByGeneration(
  slots: DexSlotView[],
  totals: Map<number, { caught: number; total: number }>,
): DexGeneration[] {
  const blocks = new Map<number, DexSlotView[]>();
  for (const slot of slots) {
    const bucket = blocks.get(slot.generation);
    if (bucket) {
      bucket.push(slot);
    } else {
      blocks.set(slot.generation, [slot]);
    }
  }
  return [...blocks.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([generation, entries]) => ({
      generation,
      slots: entries,
      caught: totals.get(generation)?.caught ?? 0,
      total: totals.get(generation)?.total ?? entries.length,
    }));
}

/**
 * Per-generation caught/total over every unfiltered slot in the grid.
 */
export function generationTotals(
  entries: DexSlotView[],
): Map<number, { caught: number; total: number }> {
  const totals = new Map<number, { caught: number; total: number }>();
  for (const entry of entries) {
    const bucket = totals.get(entry.generation) ?? { caught: 0, total: 0 };
    bucket.total++;
    if (entry.caught) bucket.caught++;
    totals.set(entry.generation, bucket);
  }
  return totals;
}

/**
 * The generation block a slot key belongs to, or null when the key names no
 * visible slot. Lets the grid hand each section only the keys that are its own.
 */
export function generationOfKey(slots: DexSlotView[], key: string | null): number | null {
  if (key === null) return null;
  return slots.find((slot) => slot.slotKey === key)?.generation ?? null;
}

/** Clamps a target index into the visible range. */
export function clampIndex(next: number, length: number): number {
  return Math.min(Math.max(next, 0), length - 1);
}

/**
 * Target index for a grid navigation key, or null when the key is none of
 * ours and must keep its default behaviour.
 */
export function nextIndexFor(
  key: string,
  current: number,
  length: number,
  columns: number,
): number | null {
  switch (key) {
    case "ArrowRight":
      return clampIndex(current + 1, length);
    case "ArrowLeft":
      return clampIndex(current - 1, length);
    case "ArrowDown":
      return clampIndex(current + columns, length);
    case "ArrowUp":
      return clampIndex(current - columns, length);
    case "Home":
      return 0;
    case "End":
      return length - 1;
    case "PageDown":
      return clampIndex(current + columns * PAGE_ROWS, length);
    case "PageUp":
      return clampIndex(current - columns * PAGE_ROWS, length);
    default:
      return null;
  }
}

/** First caught species in dex order, else the first species at all. */
export function defaultSelectionId(entries: DexEntry[]): number | null {
  const caught = entries.find((entry) => entry.caught);
  return (caught ?? entries[0])?.id ?? null;
}

/**
 * Builds the complete aria sentence of one species slot. The caught and seen
 * variants use their own full-sentence key on purpose; the pieces are never
 * concatenated. Driven by `caught`/`seenOnly` rather than `catchCount`, since
 * a manual override can mark a slot caught (or seen) with zero archived
 * catches behind it.
 */
export function slotLabel(
  t: (key: string, options?: Record<string, string | number>) => string,
  id: number,
  name: string,
  caught: boolean,
  seenOnly: boolean,
  catchCount: number,
  variantCount: number,
): string {
  if (!caught) {
    if (variantCount > 0) {
      return t(seenOnly ? "aria.dexSlotSeenVariants" : "aria.dexSlotUncaughtVariants", {
        num: id,
        name,
        variants: variantCount,
      });
    }
    return seenOnly
      ? t("aria.dexSlotSeen", { num: id, name })
      : t("aria.dexSlotUncaught", { num: id, name });
  }
  if (variantCount > 0) {
    return t("aria.dexSlotCaughtVariants", {
      num: id,
      name,
      count: catchCount,
      variants: variantCount,
    });
  }
  return t("aria.dexSlotCaught", { num: id, name, count: catchCount });
}

/**
 * Builds the complete aria sentence of one form slot. Always names both the
 * species and the form, since the form name alone (e.g. "Mega X") means
 * nothing without knowing which species it belongs to.
 */
export function formSlotLabel(
  t: (key: string, options?: Record<string, string | number>) => string,
  id: number,
  speciesName: string,
  formName: string,
  caught: boolean,
  seenOnly: boolean,
  catchCount: number,
): string {
  if (!caught) {
    return seenOnly
      ? t("aria.dexFormSlotSeen", { num: id, name: speciesName, form: formName })
      : t("aria.dexFormSlotUncaught", { num: id, name: speciesName, form: formName });
  }
  return t("aria.dexFormSlotCaught", {
    num: id,
    name: speciesName,
    form: formName,
    count: catchCount,
  });
}
