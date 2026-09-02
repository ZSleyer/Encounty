/**
 * types.ts: the view model the Pokédex grid is rendered from.
 *
 * The dex index (see utils/dex.ts) is per species; these types are per slot,
 * which is what the grid, the filters and the keyboard navigation all work in.
 */
import type { ShinyVariant } from "../../types";

/** Four-way caught-state filter. */
export type CaughtFilter = "all" | "caught" | "seen" | "missing";

/** Shiny variant filter. "all" keeps slots that carry no variant at all. */
export type VariantFilter = "all" | ShinyVariant;

/** Everything one slot needs, flattened to primitives so `memo` can bite. */
export interface DexSlotView {
  /**
   * Unique grid/DOM identity: the dex id alone for a species slot, or
   * `"{id}:{formCanonical}"` for one of its form slots. `id` alone cannot
   * serve this role once a species has more than one slot on screen.
   */
  slotKey: string;
  /** National Dex number; identical for a species slot and all its form slots. */
  id: number;
  canonical: string;
  name: string;
  generation: number;
  caught: boolean;
  /**
   * Seen but not caught (a manual override, since a real catch always sets
   * `caught` too). Excludes caught slots on purpose, unlike `DexEntry.seen`,
   * so this and `caught` partition the slots without overlap.
   */
  seenOnly: boolean;
  /** Archived catches resolved onto this slot; drives the `×N` badge. */
  catchCount: number;
  /** Form entries collapsed into this base slot while individual forms are hidden. */
  formEntryCount: number;
  /** Complete aria sentence; never assembled from several keys at render time. */
  label: string;
  /** PokeAPI id the sprite renders; a form's own id for a form slot. */
  spriteId: number | string;
  /** Cosmetic form slug that overrides `spriteId` when the form has no own PokeAPI entity. */
  spriteSlug?: string;
  /** Gender the sprite should render, for a gender-restricted form. */
  gender?: "male" | "female";
  /** Shiny variants recorded on this species, shared by its form slots. */
  shinyVariants: ShinyVariant[];
}

/** One generation block of the grid. */
export interface DexGeneration {
  generation: number;
  slots: DexSlotView[];
  caught: number;
  total: number;
}
