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
import {
  usePokedex,
  localeToPokemonLangs,
  type PokemonData,
} from "../components/pokemon/pokemonPicker";
import { buildDexIndex, type DexEntry, type DexMode } from "../utils/dex";
import { getDefaultSpriteUrl, SPRITE_FALLBACK } from "../utils/sprites";
import { getGameName } from "../utils/games";
import { DexCatchesModal } from "../components/dex/DexCatchesModal";
import { DexDetailModal } from "../components/dex/DexDetailModal";
import { DexSpeciesDetail } from "../components/dex/DexSpeciesDetail";
import { CatchMetaModal } from "../components/pokemon/CatchMetaModal";
import { apiUrl } from "../utils/api";
import type { CatchMeta, Pokemon } from "../types";

// --- Layout constants ---

/** Gap between two slots, mirrors the `gap` of `.dex-grid`. */
const GRID_GAP = 8;
/** Narrowest slot plus the gap; the pitch the column math counts in. */
const SLOT_PITCH = 88;
/** Row height used for the content-visibility size placeholder. */
const ROW_HEIGHT = 100;
/** Rows a PageUp/PageDown jumps. */
const PAGE_ROWS = 5;
/**
 * Viewport width from which grid and detail panel sit side by side. Mirrors
 * Tailwind's `lg`, the narrowest breakpoint where a ~340px panel still leaves
 * the grid enough room for a useful number of columns.
 */
const WIDE_LAYOUT_QUERY = "(min-width: 1024px)";

// --- Types ---

/** Three-way caught-state filter. */
type CaughtFilter = "all" | "caught" | "missing";

/** Everything one slot needs, flattened to primitives so `memo` can bite. */
interface DexSlotView {
  id: number;
  canonical: string;
  name: string;
  generation: number;
  caught: boolean;
  /** Archived catches resolved onto this slot; drives the `×N` badge. */
  catchCount: number;
  /** Complete aria sentence; never assembled from several keys at render time. */
  label: string;
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

/** Applies the caught-state filter to one slot. */
function matchesCaughtState(slot: DexSlotView, filter: CaughtFilter): boolean {
  if (filter === "caught") return slot.caught;
  if (filter === "missing") return !slot.caught;
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

/** Per-generation caught/total over the unfiltered index. */
function generationTotals(entries: DexEntry[]): Map<number, { caught: number; total: number }> {
  const totals = new Map<number, { caught: number; total: number }>();
  for (const entry of entries) {
    const bucket = totals.get(entry.generation) ?? { caught: 0, total: 0 };
    bucket.total++;
    if (entry.catches.length > 0) bucket.caught++;
    totals.set(entry.generation, bucket);
  }
  return totals;
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
  const caught = entries.find((entry) => entry.catches.length > 0);
  return (caught ?? entries[0])?.id ?? null;
}

/**
 * Surface and border of one slot. Selection outranks the caught state on both
 * channels, which is why this is a lookup and not three classes stacked on the
 * element: `bg-bg-card` and `bg-accent-blue/10` would otherwise fight over
 * stylesheet order.
 */
function slotStateClass(caught: boolean, selected: boolean): string {
  const texture = caught ? "t-cut" : "t-hatch";
  if (selected) return `${texture} border-accent-blue bg-accent-blue/10`;
  if (caught) return `${texture} bg-bg-card border-accent-green/70 hover:border-accent-green`;
  return `${texture} bg-bg-card border-border-subtle hover:border-text-muted`;
}

/** Swaps a broken sprite for the neutral placeholder glyph, once. */
function handleSpriteError(event: React.SyntheticEvent<HTMLImageElement>) {
  const img = event.currentTarget;
  if (img.src === SPRITE_FALLBACK) return;
  img.src = SPRITE_FALLBACK;
}

// --- Slot ---

interface DexSlotProps {
  readonly id: number;
  readonly name: string;
  readonly caught: boolean;
  readonly selected: boolean;
  readonly catchCount: number;
  readonly label: string;
  readonly tabIndex: number;
  readonly onOpen: (id: number) => void;
}

/**
 * One species slot. Caught and uncaught differ on three independent channels
 * so the state never rests on colour alone (WCAG 1.4.1): the corner cut versus
 * a plain square, the hatch texture on uncaught slots, and the full-colour
 * shiny sprite versus a flat silhouette. Selection adds a fourth, a filled
 * corner tab no other state paints, so it reads apart from both the caught
 * state and the focus ring.
 */
const DexSlot = memo(function DexSlot({
  id,
  name,
  caught,
  selected,
  catchCount,
  label,
  tabIndex,
  onOpen,
}: DexSlotProps) {
  return (
    <li>
      <button
        type="button"
        data-dex-id={id}
        tabIndex={tabIndex}
        aria-label={label}
        aria-current={selected ? "true" : undefined}
        onClick={() => onOpen(id)}
        className={`relative flex h-full w-full min-h-[92px] flex-col items-center justify-center gap-0.5 border p-1 transition-colors ${slotStateClass(caught, selected)}`}
      >
        {selected && (
          <span aria-hidden="true" className="absolute left-0 top-0 h-2 w-2 bg-accent-blue" />
        )}
        {/* The badge is anchored to the sprite, not to the button: the button's
            bottom row is where the species name lives, and at narrow widths a
            corner badge there lands straight on top of it. */}
        <span className="relative inline-flex">
          <img
            src={getDefaultSpriteUrl(id, caught ? "shiny" : "normal")}
            alt=""
            width={96}
            height={96}
            loading="lazy"
            decoding="async"
            onError={handleSpriteError}
            className={`h-12 w-12 object-contain [image-rendering:pixelated] ${caught ? "" : "t-dex-silhouette"}`}
          />
          {/* Only from the second catch on. A "+1" on the very first catch
              would promise a base entry this slot never had, and a lone catch
              needs no hint that the panel holds more than one. */}
          {catchCount > 1 && (
            <span
              aria-hidden="true"
              className="t-label absolute bottom-0 right-0 bg-bg-card tabular-nums"
            >
              ×{catchCount}
            </span>
          )}
        </span>
        <span className="font-mono tabular-nums text-[10px] text-text-faint">
          #{String(id).padStart(4, "0")}
        </span>
        <span className="hidden max-w-full truncate text-[11px] text-text-secondary sm:block">
          {name}
        </span>
      </button>
    </li>
  );
});

// --- Grid sections ---

interface DexSectionProps {
  readonly block: DexGeneration;
  readonly columns: number;
  readonly activeId: number | null;
  readonly selectedId: number | null;
  readonly onOpen: (id: number) => void;
  readonly onKeyDown: (event: React.KeyboardEvent<HTMLUListElement>) => void;
}

/**
 * One generation of the grid. A real list, not `role="grid"`: CSS
 * auto-placement means DOM rows do not exist, and a list hands out set size
 * and find-in-page for free. The explicit `role="list"` is load-bearing,
 * Safari drops list semantics under `list-style: none`.
 */
function DexSection({
  block,
  columns,
  activeId,
  selectedId,
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
            key={slot.id}
            id={slot.id}
            name={slot.name}
            caught={slot.caught}
            selected={slot.id === selectedId}
            catchCount={slot.catchCount}
            label={slot.label}
            tabIndex={slot.id === activeId ? 0 : -1}
            onOpen={onOpen}
          />
        ))}
      </ul>
    </section>
  );
}

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

/** Caught-state options in display order. */
const CAUGHT_FILTERS: { value: CaughtFilter; key: string }[] = [
  { value: "all", key: "dex.filterAll" },
  { value: "caught", key: "dex.filterCaught" },
  { value: "missing", key: "dex.filterMissing" },
];

interface CaughtFilterControlProps {
  readonly value: CaughtFilter;
  readonly onChange: (value: CaughtFilter) => void;
}

/**
 * Three-way caught-state control as a real radio group: one tab stop, arrow
 * keys move and select. The group is named after the state it filters on,
 * which is the only thing all three options have in common.
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
            <span className="truncate">{entry.name}</span>
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
  const { appState } = useCounterStore();
  const searchId = useId();
  const gameId = useId();
  const panelHeadingId = useId();
  const wide = useWideLayout();

  const [mode, setMode] = useState<DexMode>("national");
  const [game, setGame] = useState("");
  const [generationFilter, setGenerationFilter] = useState<ReadonlySet<number>>(new Set());
  const [caughtFilter, setCaughtFilter] = useState<CaughtFilter>("all");
  const [query, setQuery] = useState("");
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
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
  const saveCatchMeta = useCallback(async (id: string, meta: CatchMeta) => {
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

  const index = useMemo(
    () => buildDexIndex(allPokemon, snapshot ?? [], mode, game, gameGeneration),
    [allPokemon, snapshot, mode, game, gameGeneration],
  );

  const slots = useMemo<DexSlotView[]>(() => {
    const speciesById = new Map(allPokemon.map((species) => [species.id, species]));
    return index.entries.map((entry) => {
      const species = speciesById.get(entry.id);
      const name = species ? localizedName(species, locale) : entry.canonical;
      const catchCount = entry.catches.length;
      const variantCount = entry.variants.length;
      return {
        id: entry.id,
        canonical: entry.canonical,
        name,
        generation: entry.generation,
        caught: catchCount > 0,
        catchCount,
        label: slotLabel(t, entry.id, name, catchCount, variantCount),
      };
    });
  }, [index, allPokemon, locale, t]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return slots.filter(
      (slot) =>
        (generationFilter.size === 0 || generationFilter.has(slot.generation)) &&
        matchesCaughtState(slot, caughtFilter) &&
        matchesQuery(slot, needle),
    );
  }, [slots, generationFilter, caughtFilter, query]);

  const totals = useMemo(() => generationTotals(index.entries), [index]);
  const blocks = useMemo(() => groupByGeneration(visible, totals), [visible, totals]);
  const generations = useMemo(() => [...totals.keys()].sort((a, b) => a - b), [totals]);

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

  // Roving tabindex: exactly one slot is tabbable, so Tab passes the whole
  // grid in a single press. Tab lands on the selected slot while the grid has
  // not been entered yet, and falls back to the first visible slot whenever a
  // filter drops both.
  const activeId = useMemo(() => {
    const isVisible = (id: number | null) => id !== null && visible.some((slot) => slot.id === id);
    if (isVisible(focusedId)) return focusedId;
    if (isVisible(selectedId)) return selectedId;
    return visible[0]?.id ?? null;
  }, [focusedId, selectedId, visible]);

  // Selection follows focus: arrowing across the grid pages the detail panel
  // through the entries, which is the whole point of the two-pane layout.
  const focusSlot = useCallback((id: number) => {
    pickedRef.current = true;
    setFocusedId(id);
    setSelectedId(id);
    const el = gridsRef.current?.querySelector<HTMLElement>(`[data-dex-id="${id}"]`);
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
        visible.findIndex((slot) => slot.id === activeId),
      );
      const next = nextIndexFor(event.key, current, visible.length, gridColumns);
      if (next === null) return;
      // Enter and Space are deliberately absent: the slots are real buttons
      // and the browser already turns both into a click.
      event.preventDefault();
      focusSlot(visible[next].id);
    },
    [visible, activeId, focusSlot],
  );

  const handleOpen = useCallback(
    (id: number) => {
      pickedRef.current = true;
      setFocusedId(id);
      setSelectedId(id);
      // Wide viewports already show the detail next to the grid, so only the
      // collapsed layout still needs the dialog.
      if (wide) return;
      setDetailOpen(true);
    },
    [wide],
  );

  const handleCloseDetail = useCallback(() => {
    setDetailOpen(false);
    if (selectedId === null) return;
    // The CRT close transition delays unmount, so the dialog's own focus
    // restoration lands too late. Put it back explicitly.
    gridsRef.current?.querySelector<HTMLElement>(`[data-dex-id="${selectedId}"]`)?.focus();
  }, [selectedId]);

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
          <DexProgress caught={index.caught} total={index.total} />

          <div className="t-panel flex flex-col gap-4 p-4">
            <div className="flex flex-wrap items-center gap-2">
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
              {blocks.map((block) => (
                <DexSection
                  key={block.generation}
                  block={block}
                  columns={columns}
                  activeId={activeId}
                  selectedId={selectedId}
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
          onSubmit={saveCatchMeta}
          onClose={() => setEditCatchId(null)}
        />
      )}
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
 * Builds the complete aria sentence of one slot. The caught variants use
 * their own full-sentence key on purpose; the pieces are never concatenated.
 */
function slotLabel(
  t: (key: string, options?: Record<string, string | number>) => string,
  id: number,
  name: string,
  catchCount: number,
  variantCount: number,
): string {
  if (catchCount === 0) return t("aria.dexSlotUncaught", { num: id, name });
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
