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
 *
 * The parts of it live in pages/dex/: the slot and its grid section, the
 * toolbar, the pure filter logic and the two hooks this view needs.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useI18n } from "../contexts/I18nContext";
import { useCounterStore } from "../hooks/useCounterState";
import { useDexOverrides } from "../hooks/useDexOverrides";
import { usePokedex } from "../components/pokemon/pokemonPicker";
import { buildDexIndex, type DexMode } from "../utils/dex";
import { DexCatchesModal } from "../components/dex/DexCatchesModal";
import { DexDetailModal } from "../components/dex/DexDetailModal";
import { DexSpeciesDetail } from "../components/dex/DexSpeciesDetail";
import { CatchMetaModal } from "../components/pokemon/CatchMetaModal";
import { apiUrl } from "../utils/api";
import type { CatchMetaUpdate } from "../types";
import { useUserPokedexes } from "../hooks/useUserPokedexes";
import { speciesInPokedex, type UserPokedex } from "../utils/userPokedex";
import { PokedexSettingsModal } from "../components/dex/PokedexSettingsModal";
import { buildDexSlots } from "./dex/buildDexSlots";
import { DexProgress } from "./dex/DexProgress";
import { DexSection } from "./dex/DexSection";
import { DexToolbar } from "./dex/DexToolbar";
import { UnmatchedSection } from "./dex/UnmatchedSection";
import { useSpriteUnloading } from "./dex/useSpriteUnloading";
import { useWideLayout } from "./dex/useWideLayout";
import {
  defaultSelectionId,
  generationOfKey,
  generationTotals,
  groupByGeneration,
  matchesCaughtState,
  matchesQuery,
  matchesShinyVariant,
  nextIndexFor,
} from "./dex/dexFilters";
import type { CaughtFilter, VariantFilter } from "./dex/types";

// --- Layout constants ---

/** Gap between two slots, mirrors the `gap` of `.dex-grid`. */
const GRID_GAP = 8;
/** Narrowest slot plus the gap; the pitch the column math counts in. */
const SLOT_PITCH = 88;

// --- Page ---

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

  const [mode, setMode] = useState<DexMode>("national");
  const [game, setGame] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<UserPokedex | null>(null);
  const [generationFilter, setGenerationFilter] = useState<ReadonlySet<number>>(new Set());
  const [caughtFilter, setCaughtFilter] = useState<CaughtFilter>("all");
  const [variantFilter, setVariantFilter] = useState<VariantFilter>("all");
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

  const scopedPokemon = useMemo(
    () => allPokemon.filter((species) => speciesInPokedex(species, userPokedexes.active, games)),
    [allPokemon, userPokedexes.active, games],
  );
  const scopedCatches = useMemo(
    () =>
      (snapshot ?? []).filter(
        (pokemon) =>
          (pokemon.pokedex_ids ?? ["default"]).includes(userPokedexes.active.id) &&
          (userPokedexes.active.catch_games.length === 0 ||
            userPokedexes.active.catch_games.includes(pokemon.game)),
      ),
    [snapshot, userPokedexes.active],
  );
  const index = useMemo(
    () =>
      buildDexIndex(
        scopedPokemon,
        scopedCatches,
        mode,
        game,
        gameGeneration,
        overrides,
        userPokedexes.active.living_dex,
      ),
    [
      scopedPokemon,
      scopedCatches,
      mode,
      game,
      gameGeneration,
      overrides,
      userPokedexes.active.living_dex,
    ],
  );

  const slots = useMemo(
    () =>
      buildDexSlots({
        index,
        allPokemon,
        locale,
        t,
        pokedex: userPokedexes.active,
        mode,
        game,
        games,
      }),
    [index, allPokemon, locale, t, userPokedexes.active, mode, game, games],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return slots.filter(
      (slot) =>
        (generationFilter.size === 0 || generationFilter.has(slot.generation)) &&
        matchesCaughtState(slot, caughtFilter) &&
        matchesShinyVariant(slot, variantFilter) &&
        matchesQuery(slot, needle),
    );
  }, [slots, generationFilter, caughtFilter, variantFilter, query]);

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
    const isVisible = (key: string | null) =>
      key !== null && visible.some((slot) => slot.slotKey === key);
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
    setVariantFilter("all");
    setQuery("");
  };

  const hasShinyVariants = useMemo(
    () => slots.some((slot) => slot.shinyVariants.length > 0),
    [slots],
  );
  const filtersActive =
    generationFilter.size > 0 ||
    caughtFilter !== "all" ||
    variantFilter !== "all" ||
    query.trim().length > 0;
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

          <DexToolbar
            userPokedexes={userPokedexes}
            mode={mode}
            setMode={setMode}
            game={game}
            setGame={setGame}
            games={games}
            gameLanguages={gameLanguages}
            searchId={searchId}
            gameId={gameId}
            query={query}
            setQuery={setQuery}
            caughtFilter={caughtFilter}
            setCaughtFilter={setCaughtFilter}
            hasShinyVariants={hasShinyVariants}
            variantFilter={variantFilter}
            setVariantFilter={setVariantFilter}
            filtersActive={filtersActive}
            clearFilters={clearFilters}
            generations={generations}
            generationFilter={generationFilter}
            toggleGeneration={toggleGeneration}
            setSettingsDraft={setSettingsDraft}
            setSettingsOpen={setSettingsOpen}
          />

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

            {wide &&
              selected && (
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
                    livingDex={userPokedexes.active.living_dex}
                    overrides={overrides}
                    setOverride={setOverride}
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
          livingDex={userPokedexes.active.living_dex}
          overrides={overrides}
          setOverride={setOverride}
        />
      )}

      {catchesOpen && selected && (
        <DexCatchesModal
          name={selectedName}
          canonical={selected.canonical}
          // "All catches of X" means catches. A failed attempt has its own
          // "seen" section in the summary, and listing it here would
          // contradict the button that opened this list, which counts the
          // real catches only.
          catches={selected.catches.filter((entry) => !entry.failed)}
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
      {settingsOpen && settingsDraft && (
        <PokedexSettingsModal
          pokedex={settingsDraft}
          games={games}
          onSave={userPokedexes.save}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </main>
  );
}
