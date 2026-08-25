/**
 * DexPage.tsx: Pokédex completion view.
 *
 * Renders every synced species as a slot, resolves the archived catches onto
 * those slots (see utils/dex.ts) and lets the hunter filter, search and inspect
 * them. The whole dex is in the DOM at once: `content-visibility: auto` per
 * generation plus lazy sprites replace virtualization, which keeps find-in-page
 * and the browser's own focus handling intact.
 *
 * The layout is the classic Dex master-detail: the grid on the left, the entry
 * of the selected species permanently on the right. A selection is always
 * active and it follows keyboard focus, so arrowing across the grid pages
 * through the entries. Below the two-pane breakpoint the panel does not fit
 * and the same detail opens as a modal instead.
 */
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useI18n } from "../contexts/I18nContext";
import { useCounterStore } from "../hooks/useCounterState";
import { useDexOverrides } from "../hooks/useDexOverrides";
import {
  usePokedex,
  localeToPokemonLangs,
  isFormAvailableForGame,
  type PokemonData,
} from "../components/pokemon/pokemonPicker";
import { buildDexIndex, type DexEntry, type DexMode } from "../utils/dex";
import { formCanonicalLabel } from "../components/dex/DexOverrideModal";
import { getDefaultSpriteUrl, getBoxSpriteUrl, cachedSpriteSrc, SPRITE_FALLBACK } from "../utils/sprites";
import { getGameName } from "../utils/games";
import { DexCatchesModal } from "../components/dex/DexCatchesModal";
import { DexDetailModal } from "../components/dex/DexDetailModal";
import { DexSpeciesDetail } from "../components/dex/DexSpeciesDetail";
import { CatchMetaModal } from "../components/pokemon/CatchMetaModal";
import { Toggle } from "../components/shared/Toggle";
import { apiUrl } from "../utils/api";
import type { CatchMeta, CatchMetaUpdate, Pokemon } from "../types";
import { pokemonDisplayName } from "../utils/pokemon";
import { Plus, Settings as SettingsIcon, Trash2 } from "lucide-react";
import { useUserPokedexes } from "../hooks/useUserPokedexes";
import { useDexSpecimens } from "../hooks/useDexSpecimens";
import { DEFAULT_POKEDEX, formCategory, speciesInPokedex, type UserPokedex } from "../utils/userPokedex";
import { PokedexSettingsModal } from "../components/dex/PokedexSettingsModal";

// --- Layout constants ---

/** Gap between two slots, mirrors the `gap` of `.dex-grid`. */
const GRID_GAP = 8;
/** Narrowest slot plus the gap; the pitch the column math counts in. */
const SLOT_PITCH = 88;
/** Row height used for the content-visibility size placeholder. */
const ROW_HEIGHT = 112;
/** Rows a PageUp/PageDown jumps. */
const PAGE_ROWS = 5;
/**
 * How far outside the scroll port a slot sprite stays loaded. Roughly six rows
 * in either direction, enough that a fast scroll never outruns the reload but
 * small enough that most of the dex is unloaded at any moment.
 */
const SPRITE_KEEP_MARGIN = "600px";
/**
 * Viewport width from which grid and detail panel sit side by side. Mirrors
 * Tailwind's `lg`, the narrowest breakpoint where a ~340px panel still leaves
 * the grid enough room for a useful number of columns.
 */
const WIDE_LAYOUT_QUERY = "(min-width: 1024px)";

// --- Types ---

/** Four-way caught-state filter. */
type CaughtFilter = "all" | "caught" | "seen" | "missing";

/** Everything one slot needs, flattened to primitives so `memo` can bite. */
interface DexSlotView {
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
}

/** One generation block of the grid. */
interface DexGeneration {
  generation: number;
  slots: DexSlotView[];
  caught: number;
  total: number;
}

// --- Pure helpers ---

/**
 * Localized species name with the same fallback chain the pickers use, plus
 * the es-es/es-419 split that a single locale code cannot express.
 */
function localizedName(species: PokemonData, locale: string): string {
  for (const lang of localeToPokemonLangs(locale)) {
    const name = species.names?.[lang];
    if (name) return name;
  }
  return species.names?.en ?? species.canonical;
}

/** Matches "25", "025", "#25" and "0025" against a dex number. */
function matchesNumber(id: number, needle: string): boolean {
  const digits = needle.startsWith("#") ? needle.slice(1) : needle;
  if (!/^\d+$/.test(digits)) return false;
  return Number.parseInt(digits, 10) === id;
}

/** Search over the localized name, the English canonical and the dex number. */
function matchesQuery(slot: DexSlotView, needle: string): boolean {
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
function matchesCaughtState(slot: DexSlotView, filter: CaughtFilter): boolean {
  if (filter === "caught") return slot.caught;
  if (filter === "seen") return slot.seenOnly;
  if (filter === "missing") return !slot.caught && !slot.seenOnly;
  return true;
}

/** Groups the visible slots into generation blocks, ascending. */
function groupByGeneration(
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
function generationTotals(entries: DexSlotView[]): Map<number, { caught: number; total: number }> {
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
function generationOfKey(slots: DexSlotView[], key: string | null): number | null {
  if (key === null) return null;
  return slots.find((slot) => slot.slotKey === key)?.generation ?? null;
}

/** Clamps a target index into the visible range. */
function clampIndex(next: number, length: number): number {
  return Math.min(Math.max(next, 0), length - 1);
}

/**
 * Target index for a grid navigation key, or null when the key is none of
 * ours and must keep its default behaviour.
 */
function nextIndexFor(
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
function defaultSelectionId(entries: DexEntry[]): number | null {
  const caught = entries.find((entry) => entry.caught);
  return (caught ?? entries[0])?.id ?? null;
}

/** The texture channel of one slot; never picked from color alone (WCAG 1.4.1). */
function slotTexture(caught: boolean, seenOnly: boolean): string {
  if (caught) return "t-cut";
  if (seenOnly) return "t-dot";
  return "t-hatch";
}

/**
 * Surface and border of one slot. Selection outranks the caught state on both
 * channels, which is why this is a lookup and not classes stacked on the
 * element: `bg-bg-card` and `bg-accent-blue/10` would otherwise fight over
 * stylesheet order.
 */
function slotStateClass(caught: boolean, seenOnly: boolean, selected: boolean): string {
  const texture = slotTexture(caught, seenOnly);
  if (selected) return `${texture} border-accent-blue bg-accent-blue/10`;
  if (caught) return `${texture} bg-bg-card border-accent-green/70 hover:border-accent-green`;
  if (seenOnly) return `${texture} bg-bg-card border-accent-yellow/70 hover:border-accent-yellow`;
  return `${texture} bg-bg-card border-border-subtle hover:border-text-muted`;
}

/**
 * Falls back to the Pokésprite box sprite, then the base species' own sprite,
 * then the neutral placeholder glyph.
 *
 * A handful of cosmetic forms (e.g. "pikachu-starter", the Let's Go partner
 * form) have no default PokeAPI pixel sprite or Home render at all, only
 * official artwork and a Showdown GIF, so the primary sprite 404s every time,
 * not just transiently. `boxUrl` is Pokésprite's box art for the same
 * canonical name, which does cover these forms.
 *
 * `baseUrl` catches what neither of those reaches: Pokésprite's set stops at
 * Gen 8, so no Gen 9 slot has box art at all, and the ride-legendary builds
 * and modes (Koraidon, Miraidon) and Sinistcha's masterpiece form have no
 * sprite of their own upstream either. Both steps 404 and the slot used to
 * land on the placeholder. The base species sprite is the same creature in a
 * different pose, so it reads far better than a blank glyph.
 *
 * Only `src` (and the `data-dex-sprite-step` cursor) is touched:
 * `data-dex-sprite` keeps the real URL so the unloading observer retries it,
 * and resets the cursor, the next time the slot scrolls back into view.
 * Writing the placeholder into `data-dex-sprite` itself would turn a single
 * transient failure, a network blip or a throttled response from the sprite
 * host, into a permanent one for the rest of the session, because the
 * observer restores from that attribute and React never rewrites a prop whose
 * value did not change.
 */
function handleSpriteError(
  event: React.SyntheticEvent<HTMLImageElement>,
  boxUrl: string,
  baseUrl: string,
) {
  const img = event.currentTarget;
  // The attribute, never the `src` property: the property resolves to an
  // absolute URL, while the sprite-cache URLs are relative wherever the
  // backend shares the renderer's origin, and the two would never compare
  // equal.
  const current = img.getAttribute("src");
  if (current === SPRITE_FALLBACK) return;
  const chain = [boxUrl, baseUrl, SPRITE_FALLBACK];
  let step = Number(img.dataset.dexSpriteStep ?? 0);
  // Skip a step the slot has no candidate for, and one that repeats the URL
  // which just failed: either would spend a round trip to fail identically.
  while (step < chain.length - 1 && (!chain[step] || chain[step] === current)) step++;
  img.dataset.dexSpriteStep = String(step + 1);
  img.src = chain[step];
}

// --- Slot ---

interface DexSlotProps {
  readonly slotKey: string;
  readonly dexNumber: number;
  readonly name: string;
  /** English PokéAPI slug; drives the Pokésprite box-sprite fallback. */
  readonly canonical: string;
  readonly caught: boolean;
  readonly seenOnly: boolean;
  readonly selected: boolean;
  readonly catchCount: number;
  readonly formEntryCount: number;
  readonly label: string;
  readonly spriteId: number | string;
  readonly spriteSlug?: string;
  readonly gender?: "male" | "female";
  readonly tabIndex: number;
  readonly onOpen: (slotKey: string, dexNumber: number) => void;
}

/**
 * One species or form slot. Caught, seen-only and uncaught differ on three
 * independent channels so the state never rests on colour alone (WCAG
 * 1.4.1): the corner cut, dot or hatch texture, the border colour, and the
 * sprite, a flat silhouette for uncaught, the plain sprite for seen-only, the
 * full-colour shiny for caught, mirroring how mainline games distinguish
 * seen from caught. Selection adds a fourth channel, a filled corner tab no
 * other state paints, so it reads apart from both the caught state and the
 * focus ring.
 */
const DexSlot = memo(function DexSlot({
  slotKey,
  dexNumber,
  name,
  canonical,
  caught,
  seenOnly,
  selected,
  catchCount,
  formEntryCount,
  label,
  spriteId,
  spriteSlug,
  gender,
  tabIndex,
  onOpen,
}: DexSlotProps) {
  const { t } = useI18n();
  const spriteUrl = cachedSpriteSrc(getDefaultSpriteUrl(spriteSlug ?? spriteId, caught ? "shiny" : "normal", gender));
  const boxUrl = cachedSpriteSrc(getBoxSpriteUrl(canonical, caught ? "shiny" : "normal"));
  // Empty on a slot that already is its own base species: stepping to the URL
  // that just failed would spend a second round trip to fail identically.
  const baseSprite = cachedSpriteSrc(getDefaultSpriteUrl(dexNumber, caught ? "shiny" : "normal"));
  const baseUrl = baseSprite === spriteUrl ? "" : baseSprite;
  const showSilhouette = !caught && !seenOnly;
  return (
    <li>
      <button
        type="button"
        data-dex-slot-key={slotKey}
        tabIndex={tabIndex}
        aria-label={label}
        aria-current={selected ? "true" : undefined}
        onClick={() => onOpen(slotKey, dexNumber)}
        className={`relative flex h-full w-full min-h-[104px] flex-col items-center justify-center gap-0.5 border p-1 transition-colors ${slotStateClass(caught, seenOnly, selected)}`}
      >
        {selected && (
          <span aria-hidden="true" className="absolute left-0 top-0 h-2 w-2 bg-accent-blue" />
        )}
        <span className="inline-flex">
          <img
            src={spriteUrl}
            alt=""
            width={96}
            height={96}
            loading="lazy"
            decoding="async"
            // The URL this slot belongs to, kept in an attribute React owns so
            // the unloading observer restores the right sprite even after
            // React recycled the element for another species.
            data-dex-sprite={spriteUrl}
            onError={(e) => handleSpriteError(e, boxUrl, baseUrl)}
            className={`h-12 w-12 object-contain [image-rendering:pixelated] ${showSilhouette ? "t-dex-silhouette" : ""}`}
          />
        </span>
        <span className="font-mono tabular-nums text-[10px] text-text-faint">
          #{String(dexNumber).padStart(4, "0")}
        </span>
        <span className="hidden max-w-full truncate text-[11px] text-text-secondary sm:block">
          {name}
        </span>
        {(catchCount > 1 || formEntryCount > 0) && (
          <span aria-hidden="true" className="flex flex-wrap justify-center gap-1">
            {catchCount > 1 && (
              <span className="t-label dex-slot-badge bg-bg-card tabular-nums">
                {t("dex.catchCount")} {catchCount}
              </span>
            )}
            {formEntryCount > 0 && (
              <span className="t-label dex-slot-badge bg-bg-card tabular-nums" title={t("dex.formsWithEntries")}>
                {t("dex.variants")} {formEntryCount}
              </span>
            )}
          </span>
        )}
      </button>
    </li>
  );
});

// --- Sprite unloading ---

/**
 * Keeps only the sprites near the scroll port loaded.
 *
 * `loading="lazy"` alone stops the dex from fetching all 1025 sprites up front,
 * but once a species has scrolled past, its image stays decoded for the rest of
 * the session; walking the dex once therefore ends with the full set resident.
 * The observer swaps the placeholder glyph into every slot that left the port,
 * which releases the sprite, and puts the real URL back on the way in.
 *
 * The URL it puts back is read from `data-dex-sprite`, which React renders
 * alongside `src`, rather than from a copy the observer parked itself: React
 * recycles slot elements when a filter rebuilds the grid, and a parked copy
 * would then restore the previous species' sprite into the reused slot.
 *
 * Swapping in a placeholder rather than dropping the `src` attribute is also
 * load-bearing: an image without a source collapses to a zero area box, an
 * element of zero area intersects nothing, and the observer would never report
 * the slot as visible again, leaving it blank forever. The glyph is the one a
 * failed sprite already shows, so the swap stays unremarkable in the only
 * moment it can be seen at all, a jump long enough to outrun the keep margin.
 *
 * The sprites are the only thing released: the slots stay in the DOM, so
 * find-in-page, focus order and the roving tabindex are untouched.
 *
 * @param gridsRef Element wrapping every generation section.
 * @param revision Changes whenever the rendered slot set does, so the observer
 * picks up sprites of newly mounted or re-filtered blocks.
 */
function useSpriteUnloading(
  gridsRef: React.RefObject<HTMLDivElement | null>,
  revision: unknown,
) {
  useEffect(() => {
    const root = gridsRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const sprite = entry.target as HTMLImageElement;
          const wanted = entry.isIntersecting
            ? (sprite.dataset.dexSprite ?? SPRITE_FALLBACK)
            : SPRITE_FALLBACK;
          // Coming back into view retries the primary sprite fresh, so a
          // form whose default sprite is permanently missing walks the whole
          // fallback chain again instead of jumping straight to the
          // placeholder on every pass after the first.
          if (entry.isIntersecting) delete sprite.dataset.dexSpriteStep;
          // Compared as the attribute for the same reason as in
          // handleSpriteError: `sprite.src` resolves to an absolute URL and
          // would never match the relative sprite-cache URL, so every
          // registration would reassign every visible sprite for nothing.
          if (sprite.getAttribute("src") !== wanted) sprite.src = wanted;
        }
      },
      // No explicit root: the dex scrolls in a container owned by the app
      // shell, and the viewport intersection is already clipped by it.
      { rootMargin: SPRITE_KEEP_MARGIN },
    );

    for (const sprite of root.querySelectorAll<HTMLImageElement>("img[data-dex-sprite]")) {
      observer.observe(sprite);
    }
    return () => observer.disconnect();
  }, [gridsRef, revision]);
}

// --- Grid sections ---

interface DexSectionProps {
  readonly block: DexGeneration;
  readonly columns: number;
  readonly activeKey: string | null;
  readonly selectedKey: string | null;
  readonly onOpen: (slotKey: string, dexNumber: number) => void;
  readonly onKeyDown: (event: React.KeyboardEvent<HTMLUListElement>) => void;
}

/**
 * One generation of the grid. A real list, not `role="grid"`: CSS
 * auto-placement means DOM rows do not exist, and a list hands out set size
 * and find-in-page for free. The explicit `role="list"` is load-bearing,
 * Safari drops list semantics under `list-style: none`.
 *
 * Memoised, and both key props arrive pre-scoped to this generation (see the
 * render site): a click moves the selection within one block, so the other
 * eight can be skipped instead of walking their slots again. Without the
 * scoping the memo would never bite, since the raw keys change on every click.
 */
const DexSection = memo(function DexSection({
  block,
  columns,
  activeKey,
  selectedKey,
  onOpen,
  onKeyDown,
}: DexSectionProps) {
  const { t } = useI18n();
  const headingId = useId();
  const rows = Math.ceil(block.slots.length / Math.max(1, columns));

  return (
    <section
      className="dex-section"
      aria-labelledby={headingId}
      style={{ containIntrinsicSize: `auto ${rows * ROW_HEIGHT}px` }}
    >
      {/* The sticky element is this wrapper, not the bar, so the gap below the
          bar is opaque page background rather than a hole the grid scrolls
          through. A margin or a transparent gap cannot do both jobs: it would
          either close the gap or let the slots show in it. */}
      <div className="sticky top-0 z-10 bg-bg-primary pb-2">
        {/* bg-secondary lands within 1.05:1 of a slot card, so a background
            alone gives the bar no edge. border-active carries the separation,
            at 6.1:1 dark and 6.8:1 light, the same accent rule the sidebar
            tabs use. */}
        <h2
          id={headingId}
          className="flex items-baseline gap-3 border-b border-border-active bg-bg-secondary p-4 text-xs font-semibold uppercase tracking-[0.18em] text-text-primary"
        >
          {t("dex.generation", { n: block.generation })}
          <span
            className={`t-label ${block.caught === block.total ? "t-label--accent" : ""}`}
          >
            <span className="font-mono tabular-nums">
              {block.caught}/{block.total}
            </span>
          </span>
        </h2>
      </div>
      <ul role="list" className="dex-grid" onKeyDown={onKeyDown}>
        {block.slots.map((slot) => (
          <DexSlot
            key={slot.slotKey}
            slotKey={slot.slotKey}
            dexNumber={slot.id}
            name={slot.name}
            canonical={slot.canonical}
            caught={slot.caught}
            seenOnly={slot.seenOnly}
            selected={slot.slotKey === selectedKey}
            catchCount={slot.catchCount}
            formEntryCount={slot.formEntryCount}
            label={slot.label}
            spriteId={slot.spriteId}
            spriteSlug={slot.spriteSlug}
            gender={slot.gender}
            tabIndex={slot.slotKey === activeKey ? 0 : -1}
            onOpen={onOpen}
          />
        ))}
      </ul>
    </section>
  );
});

// --- Filters ---

interface GenerationChipsProps {
  readonly generations: number[];
  readonly selected: ReadonlySet<number>;
  readonly onToggle: (generation: number) => void;
}

/** Multi-select generation chips; an empty selection means "every generation". */
function GenerationChips({ generations, selected, onToggle }: GenerationChipsProps) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {generations.map((generation) => {
        const active = selected.has(generation);
        return (
          <button
            key={generation}
            type="button"
            aria-pressed={active}
            aria-label={t("dex.generation", { n: generation })}
            onClick={() => onToggle(generation)}
            // Single digits would fall short of the 24x24 minimum target
            // size (WCAG 2.5.8) without the explicit width.
            className={`t-label min-h-[24px] min-w-[28px] justify-center px-2 transition-colors ${
              active ? "t-label--accent" : "hover:text-text-primary"
            }`}
          >
            {generation}
          </button>
        );
      })}
    </div>
  );
}

/** Caught-state options in display order, from fully done to never encountered. */
const CAUGHT_FILTERS: { value: CaughtFilter; key: string }[] = [
  { value: "all", key: "dex.filterAll" },
  { value: "caught", key: "dex.filterCaught" },
  { value: "seen", key: "dex.filterSeen" },
  { value: "missing", key: "dex.filterMissing" },
];

interface CaughtFilterControlProps {
  readonly value: CaughtFilter;
  readonly onChange: (value: CaughtFilter) => void;
}

/**
 * Caught-state control as a real radio group: one tab stop, arrow keys move
 * and select. The group is named after the state it filters on, which is the
 * only thing all options have in common.
 */
function CaughtFilterControl({ value, onChange }: CaughtFilterControlProps) {
  const { t } = useI18n();

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const current = CAUGHT_FILTERS.findIndex((option) => option.value === value);
    const next = (current + step + CAUGHT_FILTERS.length) % CAUGHT_FILTERS.length;
    onChange(CAUGHT_FILTERS[next].value);
  };

  return (
    <div
      role="radiogroup"
      aria-label={t("dex.caught")}
      onKeyDown={handleKeyDown}
      className="flex flex-wrap items-center gap-1.5"
    >
      {CAUGHT_FILTERS.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={`t-label min-h-[24px] px-2 transition-colors ${
              active ? "t-label--accent" : "hover:text-text-primary"
            }`}
          >
            {t(option.key)}
          </button>
        );
      })}
    </div>
  );
}

// --- Progress ---

interface DexProgressProps {
  readonly caught: number;
  readonly total: number;
}

/**
 * Completion header. The count line is the only live region on the page: the
 * filtered result count deliberately stays out of it, otherwise every
 * keystroke in the search field would queue an announcement.
 */
function DexProgress({ caught, total }: DexProgressProps) {
  const { t } = useI18n();
  const summary = t("dex.caughtOf", { caught, total });
  const percent = total > 0 ? Math.round((caught / total) * 100) : 0;

  return (
    <div className="t-panel flex flex-col gap-3 p-4">
      <h1 className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
        {t("dex.title")}
      </h1>
      <div aria-live="polite" aria-atomic="true" className="flex flex-col gap-1">
        {/* Hidden from the announcement: the sentence below already spells the
            same number out in words. */}
        <span
          aria-hidden="true"
          className="font-mono leading-none tabular-nums text-text-primary"
          style={{ fontSize: "clamp(28px, 4vw, 48px)" }}
        >
          {caught}
        </span>
        <span className="text-xs text-text-muted">{summary}</span>
      </div>
      <div className="h-1 w-full bg-border-subtle">
        <div
          role="progressbar"
          aria-label={t("aria.dexProgress")}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={caught}
          aria-valuetext={summary}
          style={{ width: `${percent}%` }}
          className="h-full bg-accent-green transition-[width] duration-300"
        />
      </div>
    </div>
  );
}

// --- Unmatched ---

interface UnmatchedSectionProps {
  readonly entries: Pokemon[];
}

/** Completed catches that resolve onto no species slot. Never hidden. */
function UnmatchedSection({ entries }: UnmatchedSectionProps) {
  const { t } = useI18n();
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="t-panel flex flex-col gap-2 p-4">
      <h2 id={headingId} className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">
        {t("dex.unmatched")}
      </h2>
      <p className="text-xs text-text-muted">{t("dex.unmatchedHint")}</p>
      <ul role="list" className="flex flex-col gap-1">
        {entries.map((entry) => (
          <li key={entry.id} className="flex items-center gap-2 text-sm text-text-secondary">
            <span className="truncate">{pokemonDisplayName(entry)}</span>
            <span className="t-label shrink-0">{entry.canonical_name || "?"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// --- Page ---

/**
 * True while the viewport is wide enough for the two-pane layout. Environments
 * without `matchMedia` (jsdom) report narrow, which keeps the modal path as the
 * conservative default: it works at every width.
 */
function useWideLayout(): boolean {
  const [wide, setWide] = useState(false);

  useEffect(() => {
    const query = window.matchMedia?.(WIDE_LAYOUT_QUERY);
    if (!query) return;
    setWide(query.matches);
    const onChange = (event: MediaQueryListEvent) => setWide(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return wide;
}

/**
 * Pokédex page: completion header, filter toolbar, one grid section per
 * generation and the detail of the selected species.
 */
export function DexPage() {
  const { t, locale } = useI18n();
  const { allPokemon, games } = usePokedex();
  // Narrow selector: a bare useCounterStore() also subscribes to flashingIds
  // and detectorStatus, which change several times per second per running
  // hunt. Every one of those rebuilt the whole 1025-slot model behind the grid.
  const appState = useCounterStore((s) => s.appState);
  // Single instance, threaded down to DexSpeciesDetail/DexDetailModal: the
  // grid slot and the "mark manually" modal must share one overrides list, or
  // a write in the modal would not show up on the grid until a reload.
  const searchId = useId();
  const gameId = useId();
  const panelHeadingId = useId();
  const wide = useWideLayout();
  const userPokedexes = useUserPokedexes();
  const { overrides, setOverride } = useDexOverrides(userPokedexes.active.id);
  const dexSpecimens = useDexSpecimens(userPokedexes.active.id);

  const [mode, setMode] = useState<DexMode>("national");
  const [game, setGame] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<UserPokedex | null>(null);
  const [generationFilter, setGenerationFilter] = useState<ReadonlySet<number>>(new Set());
  const [caughtFilter, setCaughtFilter] = useState<CaughtFilter>("all");
  const [query, setQuery] = useState("");
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // The exact slot last picked by click or keyboard, species or form. Only
  // trusted for the aria-current marker while it still belongs to
  // `selectedId`; a species switch (game change, default re-selection) leaves
  // it stale, and `selectedKey` below falls back to the species slot then.
  const [pickedSlotKey, setPickedSlotKey] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [catchesOpen, setCatchesOpen] = useState(false);
  const [editCatchId, setEditCatchId] = useState<string | null>(null);
  const [columns, setColumns] = useState(1);

  const gridsRef = useRef<HTMLDivElement>(null);
  const showAllCatchesRef = useRef<HTMLButtonElement>(null);
  // Whether the hunter has chosen a slot. Only their pick is worth preserving
  // across a late-arriving snapshot; a default is not.
  const pickedRef = useRef(false);
  const snapshot = appState?.pokemon;
  // Resolving against the live snapshot also closes the editor when the entry
  // is deleted underneath it, so the id can never dangle.
  const editCatchTarget = snapshot?.find((p) => p.id === editCatchId) ?? null;

  /** Stores the edited catch details. Rejecting keeps the dialog open. */
  const saveCatchMeta = useCallback(async (id: string, meta: CatchMetaUpdate) => {
    const res = await fetch(apiUrl(`/api/pokemon/${id}/catch`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(meta),
    });
    if (!res.ok) throw new Error("save catch metadata failed");
  }, []);

  // Game mode without a game would filter everything away; settle on the
  // first known game as soon as the list arrives.
  useEffect(() => {
    if (mode !== "game" || game || games.length === 0) return;
    setGame(games[0].key);
  }, [mode, game, games]);

  // One measurement drives both the placeholder heights and the arrow-key
  // step. Reading `gridTemplateColumns` instead would return "none" inside a
  // content-visibility skipped subtree.
  useEffect(() => {
    const el = gridsRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () =>
      setColumns(Math.max(1, Math.floor((el.clientWidth + GRID_GAP) / SLOT_PITCH)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The game catalogue is the only place that knows a game's generation, so
  // the cap is resolved here and dex.ts stays free of catalogue knowledge.
  const gameGeneration = games.find((entry) => entry.key === game)?.generation;

  const scopedPokemon = useMemo(() => allPokemon.filter((species) => speciesInPokedex(species, userPokedexes.active, games)), [allPokemon, userPokedexes.active, games]);
  const scopedCatches = useMemo(() => (snapshot ?? []).filter((pokemon) =>
    (pokemon.pokedex_ids ?? ["default"]).includes(userPokedexes.active.id) &&
    (userPokedexes.active.catch_games.length === 0 || userPokedexes.active.catch_games.includes(pokemon.game))), [snapshot, userPokedexes.active]);
  const index = useMemo(
    () => buildDexIndex(scopedPokemon, scopedCatches, mode, game, gameGeneration, overrides, dexSpecimens.specimens),
    [scopedPokemon, scopedCatches, mode, game, gameGeneration, overrides, dexSpecimens.specimens],
  );

  const slots = useMemo<DexSlotView[]>(() => {
    const speciesById = new Map(allPokemon.map((species) => [species.id, species]));
    const result: DexSlotView[] = [];
    for (const entry of index.entries) {
      const species = speciesById.get(entry.id);
      const name = species ? localizedName(species, locale) : entry.canonical;
      const catchCount = entry.baseCatchCount;
      const formEntryCount = userPokedexes.active.show_forms
        ? 0
        : entry.forms.filter((form) => form.caught || form.seen).length;
      const seenOnly = entry.seen && !entry.caught;
      result.push({
        slotKey: String(entry.id),
        id: entry.id,
        canonical: entry.canonical,
        name,
        generation: entry.generation,
        caught: entry.caught,
        seenOnly,
        catchCount,
        formEntryCount,
        label: slotLabel(t, entry.id, name, entry.caught, seenOnly, catchCount, formEntryCount),
        spriteId: entry.id,
      });

      if (!userPokedexes.active.show_forms) continue;
      const forms = (species?.forms ?? []).filter((form) => userPokedexes.active.form_categories.includes(formCategory(form)));
      const formStates = new Map(entry.forms.map((f) => [f.canonical.toLowerCase(), f]));
      for (const form of forms) {
        if (!isFormAvailableForGame(form, mode === "game" ? game : "", games)) continue;
        const state = formStates.get(form.canonical.toLowerCase());
        const formCaught = state?.caught ?? false;
        const formSeenOnly = (state?.seen ?? false) && !formCaught;
        const formName = formCanonicalLabel(form, locale, t);
        result.push({
          slotKey: `${entry.id}:${form.canonical}`,
          id: entry.id,
          canonical: form.canonical,
          name: formName,
          generation: entry.generation,
          caught: formCaught,
          seenOnly: formSeenOnly,
          catchCount: state?.catchCount ?? 0,
          formEntryCount: 0,
          label: formSlotLabel(t, entry.id, name, formName, formCaught, formSeenOnly, state?.catchCount ?? 0),
          spriteId: form.sprite_id,
          spriteSlug: form.sprite_slug,
          gender: form.gender,
        });
      }
    }
    return result;
  }, [index, allPokemon, locale, t, userPokedexes.active, mode, game, games]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return slots.filter(
      (slot) =>
        (generationFilter.size === 0 || generationFilter.has(slot.generation)) &&
        matchesCaughtState(slot, caughtFilter) &&
        matchesQuery(slot, needle),
    );
  }, [slots, generationFilter, caughtFilter, query]);

  const totals = useMemo(() => generationTotals(slots), [slots]);
  const caught = useMemo(() => slots.filter((slot) => slot.caught).length, [slots]);
  const blocks = useMemo(() => groupByGeneration(visible, totals), [visible, totals]);
  const generations = useMemo(() => [...totals.keys()].sort((a, b) => a - b), [totals]);

  // Rendering all nine generations at once costs one ~180ms task on entry,
  // which reads as the tab stalling. Only ~35ms of that is the DOM: the rest
  // is React walking 1025 slot components, so content-visibility cannot help,
  // it only skips layout and paint of what React has already produced.
  // Mounting one block per frame keeps every task short and puts generation 1
  // on screen in the first one. The counter only grows: once it has passed the
  // block count it stops mattering, so a later filter renders in a single
  // pass rather than replaying the ramp.
  const [mountedBlocks, setMountedBlocks] = useState(1);
  useEffect(() => {
    if (mountedBlocks >= blocks.length) return;
    const frame = requestAnimationFrame(() => setMountedBlocks((n) => n + 1));
    return () => cancelAnimationFrame(frame);
  }, [mountedBlocks, blocks.length]);

  // Re-registered whenever a block mounts or the filter rebuilds the grid,
  // because both change which sprites exist.
  useSpriteUnloading(gridsRef, `${blocks.length}:${mountedBlocks}:${visible.length}`);

  // Switching to an older game drops the generations above its dex cap. A
  // selection left on one of them would empty the grid with no chip left to
  // switch it off again.
  useEffect(() => {
    setGenerationFilter((current) => {
      const next = new Set([...current].filter((generation) => totals.has(generation)));
      return next.size === current.size ? current : next;
    });
  }, [totals]);

  // A selection is always active, the way a physical Pokédex always shows an
  // entry: the first caught species, or the first species at all. Until the
  // hunter picks a slot the default keeps re-deriving, because the species
  // list and the archive snapshot arrive in separate round trips and the first
  // catch is only knowable once both are in. Afterwards the pick only gives
  // way when its species leaves the index entirely (a game switch caps the dex
  // below it); a filter that merely hides its slot keeps the panel on it, so
  // filtering never blanks the detail.
  useEffect(() => {
    setSelectedId((current) => {
      const keep =
        pickedRef.current &&
        current !== null &&
        index.entries.some((entry) => entry.id === current);
      return keep ? current : defaultSelectionId(index.entries);
    });
  }, [index]);

  // The slot-level aria-current marker. `pickedSlotKey` only wins while it
  // still belongs to the current `selectedId`; a species-level reset (above)
  // leaves it pointing at a slot that no longer exists in `slots`, and this
  // falls back to that species' own slot instead of marking nothing at all.
  const selectedKey = useMemo(() => {
    if (pickedSlotKey && pickedSlotKey.split(":")[0] === String(selectedId)) return pickedSlotKey;
    return selectedId === null ? null : String(selectedId);
  }, [pickedSlotKey, selectedId]);

  // Roving tabindex: exactly one slot is tabbable, so Tab passes the whole
  // grid in a single press. Tab lands on the selected slot while the grid has
  // not been entered yet, and falls back to the first visible slot whenever a
  // filter drops both.
  const activeKey = useMemo(() => {
    const isVisible = (key: string | null) => key !== null && visible.some((slot) => slot.slotKey === key);
    if (isVisible(focusedKey)) return focusedKey;
    if (isVisible(selectedKey)) return selectedKey;
    return visible[0]?.slotKey ?? null;
  }, [focusedKey, selectedKey, visible]);

  // `activeKey` changes on every click, and the key handler is a prop of every
  // generation section. Reading it from a ref keeps the handler's identity
  // stable, which is what lets those sections memoise at all. Only the latest
  // value is ever wanted, so nothing here needs to be reactive.
  const activeKeyRef = useRef(activeKey);
  activeKeyRef.current = activeKey;

  // Which block owns each key. Passing the raw keys to every section would
  // change their props on each click and defeat the memo; scoped this way only
  // the block that gains the marker, and the one that loses it, re-render.
  // Two linear scans of string comparisons, against a render pass over a
  // thousand slot components.
  const activeGeneration = useMemo(() => generationOfKey(visible, activeKey), [visible, activeKey]);
  const selectedGeneration = useMemo(
    () => generationOfKey(visible, selectedKey),
    [visible, selectedKey],
  );

  // Selection follows focus: arrowing across the grid pages the detail panel
  // through the entries, which is the whole point of the two-pane layout.
  const focusSlot = useCallback((slotKey: string, dexNumber: number) => {
    pickedRef.current = true;
    setFocusedKey(slotKey);
    setPickedSlotKey(slotKey);
    setSelectedId(dexNumber);
    const el = gridsRef.current?.querySelector<HTMLElement>(`[data-dex-slot-key="${slotKey}"]`);
    if (!el) return;
    el.focus();
    // Focusing un-skips the section, and the corrected heights only land on
    // the next frame; scrolling earlier would aim at the placeholder box.
    requestAnimationFrame(() => el.scrollIntoView?.({ block: "nearest" }));
  }, []);

  const handleGridKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLUListElement>) => {
      if (visible.length === 0) return;
      // Measured per event so a resize between renders cannot desync the step.
      const gridColumns = Math.max(
        1,
        Math.floor((event.currentTarget.clientWidth + GRID_GAP) / SLOT_PITCH),
      );
      const current = Math.max(
        0,
        visible.findIndex((slot) => slot.slotKey === activeKeyRef.current),
      );
      const next = nextIndexFor(event.key, current, visible.length, gridColumns);
      if (next === null) return;
      // Enter and Space are deliberately absent: the slots are real buttons
      // and the browser already turns both into a click.
      event.preventDefault();
      focusSlot(visible[next].slotKey, visible[next].id);
    },
    [visible, focusSlot],
  );

  const handleOpen = useCallback(
    (slotKey: string, dexNumber: number) => {
      pickedRef.current = true;
      setFocusedKey(slotKey);
      setPickedSlotKey(slotKey);
      setSelectedId(dexNumber);
      // Wide viewports already show the detail next to the grid, so only the
      // collapsed layout still needs the dialog.
      if (wide) return;
      setDetailOpen(true);
    },
    [wide],
  );

  const handleCloseDetail = useCallback(() => {
    setDetailOpen(false);
    if (selectedKey === null) return;
    // The CRT close transition delays unmount, so the dialog's own focus
    // restoration lands too late. Put it back explicitly.
    gridsRef.current?.querySelector<HTMLElement>(`[data-dex-slot-key="${selectedKey}"]`)?.focus();
  }, [selectedKey]);

  const handleCloseCatches = useCallback(() => {
    setCatchesOpen(false);
    // The CRT close transition delays unmount, so the dialog's own focus
    // restoration lands too late. Put it back on the control that opened it.
    showAllCatchesRef.current?.focus();
  }, []);

  // Growing past the breakpoint turns the dialog into a duplicate of the panel
  // that is already on screen.
  useEffect(() => {
    if (wide) setDetailOpen(false);
  }, [wide]);

  // The catch list belongs to one species and the narrow layout carries its
  // own copy inside the detail dialog, so both changes retire this one.
  useEffect(() => {
    setCatchesOpen(false);
  }, [selectedId, wide]);

  const toggleGeneration = useCallback((generation: number) => {
    setGenerationFilter((current) => {
      const next = new Set(current);
      if (!next.delete(generation)) next.add(generation);
      return next;
    });
  }, []);

  const clearFilters = () => {
    setGenerationFilter(new Set());
    setCaughtFilter("all");
    setQuery("");
  };

  const filtersActive =
    generationFilter.size > 0 || caughtFilter !== "all" || query.trim().length > 0;
  const gameLanguages = [locale, ...(appState?.settings?.languages ?? []), "en"];
  const selected = index.entries.find((entry) => entry.id === selectedId) ?? null;
  const selectedName = slots.find((slot) => slot.id === selectedId)?.name ?? "";

  return (
    <main id="main-content" className="flex-1 flex flex-col min-h-0 bg-transparent">
      {/* A size container, so the sticky detail panel can cap itself at the
          height of this scrollport (100cqh) instead of guessing at the app
          chrome above and below it with viewport units. */}
      {/* No top padding on the scroller itself: a sticky child pins to the
          padding edge, so any padding here becomes a band above the pinned
          generation bar that the grid stays visible in while it scrolls. The
          top inset lives on the content instead, where it scrolls away. */}
      <div className="flex-1 min-h-0 overflow-auto px-6 pb-6 [container-type:size]">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 pt-6">
          <DexProgress caught={caught} total={slots.length} />

          <div className="t-panel flex flex-col gap-4 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <><select aria-label={t("dex.selectPokedex")} className="t-select w-52" value={userPokedexes.active.id} onChange={(event) => userPokedexes.setActiveId(event.target.value)}>{userPokedexes.pokedexes.map((dex) => <option key={dex.id} value={dex.id}>{dex.name}{dex.id === "default" ? ` (${t("dex.defaultMarker")})` : ""}</option>)}</select><button type="button" className="t-label px-2" aria-label={t("dex.createPokedex")} onClick={() => { setSettingsDraft({ ...DEFAULT_POKEDEX, id: "", name: t("dex.newPokedex") }); setSettingsOpen(true); }}><Plus className="h-4 w-4" /></button>{userPokedexes.active.id !== "default" && <button type="button" className="t-label px-2 text-accent-red" aria-label={t("dex.deletePokedex")} onClick={() => { if (window.confirm(t("dex.deletePokedexConfirm"))) void userPokedexes.remove(userPokedexes.active.id).catch(() => window.alert(t("dex.deletePokedexConflict"))); }}><Trash2 className="h-4 w-4" /></button>}</>
              <ModeButton active={mode === "national"} onClick={() => setMode("national")}>
                {t("dex.modeNational")}
              </ModeButton>
              <ModeButton active={mode === "game"} onClick={() => setMode("game")}>
                {t("dex.modeGame")}
              </ModeButton>
              {mode === "game" && (
                <div className="flex items-center gap-2">
                  <label htmlFor={gameId} className="text-xs text-text-muted">
                    {t("dex.pickGame")}
                  </label>
                  <div className="t-select-wrap w-56">
                    <select
                      id={gameId}
                      className="t-select text-sm"
                      value={game}
                      onChange={(e) => setGame(e.target.value)}
                    >
                      {games.map((entry) => (
                        <option key={entry.key} value={entry.key}>
                          {getGameName(entry, gameLanguages)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
                <label htmlFor={searchId} className="text-xs text-text-muted">
                  {t("dex.searchLabel")}
                </label>
                <input
                  id={searchId}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("dex.searchPlaceholder")}
                  className="w-full rounded-none border border-border-subtle bg-bg-secondary px-3 py-2 text-sm text-text-primary placeholder-text-faint focus:border-accent-blue/50 focus:outline-none"
                />
              </div>
              <CaughtFilterControl value={caughtFilter} onChange={setCaughtFilter} />
              {/* Grouped with the other list-shaping controls (search, caught
                  state), not the mode buttons above: it shapes what the grid
                  shows exactly the way they do, National/Spiel choose the
                  underlying data instead. Still a pill switch rather than
                  another radio/button, since it toggles independently of
                  caughtFilter instead of picking one of a fixed set. */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted">{t("dex.modeForms")}</span>
                <Toggle
                  enabled={userPokedexes.active.show_forms}
                  onChange={() => void userPokedexes.save({ ...userPokedexes.active, show_forms: !userPokedexes.active.show_forms })}
                  label={t("dex.modeForms")}
                />
                <button type="button" onClick={() => { setSettingsDraft(userPokedexes.active); setSettingsOpen(true); }} aria-label={t("dex.settingsTitle")} className="t-label min-h-[24px] px-2"><SettingsIcon className="h-4 w-4" /></button>
              </div>
              {filtersActive && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="t-label min-h-[24px] px-2 hover:text-text-primary"
                >
                  {t("dex.clearFilters")}
                </button>
              )}
            </div>

            <GenerationChips
              generations={generations}
              selected={generationFilter}
              onToggle={toggleGeneration}
            />
          </div>

          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
            {/* min-w-0 is load-bearing: without it the grid column refuses to
                shrink below its content and the page scrolls sideways. */}
            <div
              ref={gridsRef}
              role="group"
              aria-label={t("aria.dexGrid", { count: visible.length })}
              className="flex min-w-0 flex-1 flex-col gap-6"
            >
              {allPokemon.length === 0 && (
                <p className="text-sm text-text-muted">{t("dex.loading")}</p>
              )}
              {allPokemon.length > 0 && visible.length === 0 && (
                <p className="text-sm text-text-muted">{t("dex.noResults")}</p>
              )}
              {blocks.slice(0, mountedBlocks).map((block) => (
                <DexSection
                  key={block.generation}
                  block={block}
                  columns={columns}
                  activeKey={block.generation === activeGeneration ? activeKey : null}
                  selectedKey={block.generation === selectedGeneration ? selectedKey : null}
                  onOpen={handleOpen}
                  onKeyDown={handleGridKeyDown}
                />
              ))}
            </div>

            {wide && selected && (
              // Not a live region on purpose: selection follows focus, so an
              // announcement would fire on every single arrow key.
              //
              // The summary card is short by construction, but the recorded
              // catch metadata of its inline catch can still run long (six
              // determinants plus a ribbon wall). A sticky box taller than the
              // viewport pins its top and puts the rest out of reach, so the
              // cap and the panel's own scrollbar stay. The catch list is a
              // native dialog in the top layer and is not clipped by it.
              // tabIndex makes that scroll container keyboard operable (WCAG
              // 2.1.1); the section already carries a name through
              // aria-labelledby.
              <section
                aria-labelledby={panelHeadingId}
                tabIndex={0}
                // overflow-x is pinned to hidden because setting only
                // overflow-y makes the other axis compute to auto, and the
                // hit-area expanders on the icon buttons overshoot their row by
                // a few pixels, which was enough to grow a horizontal scrollbar.
                className="sticky top-0 max-h-[100cqh] w-[340px] shrink-0 overflow-y-auto overflow-x-hidden xl:w-[380px]"
              >
                <DexSpeciesDetail
                  id={selected.id}
                  canonical={selected.canonical}
                  name={selectedName}
                  generation={selected.generation}
                  catches={selected.catches}
                  snapshot={snapshot ?? []}
                  games={games}
                  languages={gameLanguages}
                  headingId={panelHeadingId}
                  onEditCatch={setEditCatchId}
                  onShowAllCatches={() => setCatchesOpen(true)}
                  showAllRef={showAllCatchesRef}
                  caught={selected.caught}
                  overrides={overrides}
                  setOverride={setOverride}
                  specimens={dexSpecimens.specimens}
                  saveSpecimen={dexSpecimens.saveSpecimen}
                  removeSpecimen={dexSpecimens.removeSpecimen}
                />
              </section>
            )}
          </div>

          {index.unmatched.length > 0 && <UnmatchedSection entries={index.unmatched} />}
        </div>
      </div>

      {detailOpen && selected && (
        <DexDetailModal
          id={selected.id}
          canonical={selected.canonical}
          name={selectedName}
          generation={selected.generation}
          catches={selected.catches}
          snapshot={snapshot ?? []}
          games={games}
          languages={gameLanguages}
          onEditCatch={setEditCatchId}
          onClose={handleCloseDetail}
          caught={selected.caught}
          overrides={overrides}
          setOverride={setOverride}
          specimens={dexSpecimens.specimens}
          saveSpecimen={dexSpecimens.saveSpecimen}
          removeSpecimen={dexSpecimens.removeSpecimen}
        />
      )}

      {catchesOpen && selected && (
        <DexCatchesModal
          name={selectedName}
          canonical={selected.canonical}
          catches={selected.catches}
          snapshot={snapshot ?? []}
          games={games}
          languages={gameLanguages}
          onEditCatch={setEditCatchId}
          onClose={handleCloseCatches}
        />
      )}

      {editCatchTarget && (
        <CatchMetaModal
          pokemon={editCatchTarget}
          mode="edit"
          onSubmit={saveCatchMeta}
          onClose={() => setEditCatchId(null)}
        />
      )}
      {settingsOpen && settingsDraft && <PokedexSettingsModal pokedex={settingsDraft} games={games} onSave={userPokedexes.save} onClose={() => setSettingsOpen(false)} />}
    </main>
  );
}

interface ModeButtonProps {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}

/**
 * Mode switch. Two pressed-state buttons rather than a tablist: both states
 * show the very same panel, only its numbers change.
 */
function ModeButton({ active, onClick, children }: ModeButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-[28px] rounded-none border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] transition-colors ${
        active
          ? "border-accent-blue/50 bg-accent-blue/10 text-accent-blue"
          : "border-border-subtle text-text-muted hover:text-text-primary"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Builds the complete aria sentence of one species slot. The caught and seen
 * variants use their own full-sentence key on purpose; the pieces are never
 * concatenated. Driven by `caught`/`seenOnly` rather than `catchCount`, since
 * a manual override can mark a slot caught (or seen) with zero archived
 * catches behind it.
 */
function slotLabel(
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
function formSlotLabel(
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
  return t("aria.dexFormSlotCaught", { num: id, name: speciesName, form: formName, count: catchCount });
}
