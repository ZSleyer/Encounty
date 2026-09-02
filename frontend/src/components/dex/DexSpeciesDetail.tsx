/**
 * DexSpeciesDetail.tsx: per-species detail body of the Pokédex.
 *
 * One species is one calm summary card, no matter how often it was caught:
 * the header, the aggregate facts over every catch on the slot, and the newest
 * catch inline, because that is the one a hunter usually wants. Everything
 * older lives behind a single control that opens the full list in a dialog. A
 * species caught 42 times used to stack 42 full cards into the panel, which is
 * a scroll region nobody can work with.
 *
 * An uncaught species still renders: the silhouette plus a "not caught yet"
 * line is the honest empty state.
 *
 * The same markup serves both presentations of the dex detail: the permanent
 * side panel on wide viewports and {@link DexDetailModal} on narrow ones. It
 * is a container query context, so the facts grid reflows off the width it
 * actually gets instead of the viewport width.
 */
import { useCallback, useId, useMemo, useRef, useState, type Ref } from "react";
import { useNavigate } from "react-router";
import { useI18n } from "../../contexts/I18nContext";
import type { SetOverrideInput } from "../../hooks/useDexOverrides";
import { DexOverrideModal } from "./DexOverrideModal";
import { usePokedex } from "../pokemon/pokemonPicker";
import type { DexOverride } from "../../utils/dex";
import type { GameEntry, Pokemon } from "../../types";
import { CatchCard } from "./CatchCard";
import { ManualEntryCard } from "./ManualEntryCard";
import { SpeciesFacts } from "./SpeciesFacts";
import { SpeciesHeader } from "./SpeciesHeader";
import { startedHere } from "./dexDetailHelpers";

// --- Props ---

/** Props for {@link DexSpeciesDetail}. */
export interface DexSpeciesDetailProps {
  /** National Dex number of the species. */
  readonly id: number;
  /** English PokéAPI slug of the base species. */
  readonly canonical: string;
  /** Localized species name. */
  readonly name: string;
  /** Generation the species was introduced in. */
  readonly generation: number;
  /** Catches on this slot, newest `completed_at` first. */
  readonly catches: Pokemon[];
  /** Full state snapshot, needed to resolve phase parents and children. */
  readonly snapshot: Pokemon[];
  /** Game catalog used to localize the source game. */
  readonly games: GameEntry[];
  /** Language priority list for game names. */
  readonly languages: string[];
  /** Id of the species-name heading, so a wrapper can point `aria-labelledby` at it. */
  readonly headingId?: string;
  /** Opens the catch-metadata editor for one archived catch. */
  readonly onEditCatch?: (pokemonId: string) => void;
  /** Opens the manual editor for a hand-entered catch. */
  readonly onEditEntry?: (entry: Pokemon) => void;
  /**
   * Opens the full catch list. The control stays out of the DOM without it,
   * and also when the species carries a single catch: the inline card already
   * is the whole story then.
   */
  readonly onShowAllCatches?: () => void;
  /** Ref on that control, so an opener can hand the focus back to it. */
  readonly showAllRef?: Ref<HTMLButtonElement>;
  /**
   * Whether this slot counts as caught, exactly as the dex grid computes it: a
   * completed catch OR a manual override, never `catches.length` alone. Passed
   * down rather than re-derived here so the header/silhouette and the grid
   * slot can never disagree about a species that was only ever marked caught
   * through the override modal, not through a real hunt.
   */
  readonly caught: boolean;
  /**
   * Whether the active Pokédex counts an evolved catch on its current stage
   * only. The projection then puts every entry on exactly one slot, so the
   * catches/evolved split has nothing left to separate and is dropped: the
   * tile badge and this card would otherwise report different numbers for the
   * very same entry.
   */
  readonly livingDex?: boolean;
  /**
   * Every manual override, so the "manually marked" list and the caught flag
   * above both reflect the same state the grid is built from.
   */
  readonly overrides: DexOverride[];
  /**
   * Writes one manual override; shared with the dex grid so a write here
   * updates the grid slot immediately instead of only on the next fetch.
   */
  readonly setOverride: (input: SetOverrideInput) => Promise<void>;
}

/** Props for {@link DexCatchList}. */
export interface DexCatchListProps {
  /** Catches to list, newest `completed_at` first. */
  readonly catches: Pokemon[];
  /** English PokéAPI slug of the base species. */
  readonly canonical: string;
  /** Full state snapshot, needed to resolve phase parents and children. */
  readonly snapshot: Pokemon[];
  /** Game catalog used to localize the source game. */
  readonly games: GameEntry[];
  /** Language priority list for game names. */
  readonly languages: string[];
  /** Opens the catch-metadata editor for one archived catch. */
  readonly onEditCatch?: (pokemonId: string) => void;
  /** Opens the manual editor for a hand-entered catch. */
  readonly onEditEntry?: (entry: Pokemon) => void;
}

/**
 * Opens one archived catch on the dashboard. A router navigation, never
 * history.replaceState: rewriting the entry by hand wipes the data router's
 * own idx/key bookkeeping.
 */
function useOpenInDashboard(): (pokemonId: string) => void {
  const navigate = useNavigate();
  return useCallback(
    (pokemonId: string) => navigate("/", { state: { openEntryId: pokemonId } }),
    [navigate],
  );
}

// --- Catch list ---

/**
 * Every catch of one species as its own card, in the order it was handed
 * (newest `completed_at` first). A real list, so a screen reader announces the
 * set size before the hunter walks 42 of them; each card is plain flow content
 * and stays keyboard reachable through its own buttons.
 */
export function DexCatchList({
  catches,
  canonical,
  snapshot,
  games,
  languages,
  onEditCatch,
  onEditEntry,
}: DexCatchListProps) {
  const openInDashboard = useOpenInDashboard();

  return (
    // Its own container context: this list is rendered inside a dialog, far
    // wider than the side panel the summary card sits in.
    <ul role="list" className="@container flex flex-col gap-3">
      {catches.map((entry) => (
        <li key={entry.id}>
          <CatchCard
            entry={entry}
            canonical={canonical}
            snapshot={snapshot}
            games={games}
            languages={languages}
            onOpenInDashboard={openInDashboard}
            onEditCatch={onEditCatch}
            onEditEntry={onEditEntry}
          />
        </li>
      ))}
    </ul>
  );
}

// --- Detail body ---

/**
 * Species summary of the Pokédex. Reads nothing itself; every catch it
 * aggregates was already resolved onto this species by the dex index.
 */
export function DexSpeciesDetail({
  id,
  canonical,
  name,
  generation,
  catches,
  snapshot,
  games,
  languages,
  headingId,
  onEditCatch,
  onShowAllCatches,
  showAllRef,
  caught,
  livingDex = false,
  overrides,
  setOverride,
}: DexSpeciesDetailProps) {
  const { t } = useI18n();
  const openInDashboard = useOpenInDashboard();
  const latestId = useId();
  const seenId = useId();
  const manualId = useId();
  // A failed attempt was never caught: it belongs in its own "seen" section,
  // not folded into the catch facts/history a hunter actually wants to see
  // "latest catch" answer.
  const realCatches = useMemo(() => catches.filter((c) => !c.failed), [catches]);
  const failedCatches = useMemo(() => catches.filter((c) => c.failed), [catches]);
  // A single catch needs no way "to the others": the inline card is all there
  // is, and a "1 catch" button would promise a list that does not exist.
  const showAll = Boolean(onShowAllCatches) && realCatches.length > 1;

  const speciesOverrides = useMemo(
    () => overrides.filter((o) => o.speciesId === id),
    [overrides, id],
  );
  const { allPokemon } = usePokedex();
  const species = useMemo(() => allPokemon.find((p) => p.id === id), [allPokemon, id]);
  const forms = useMemo(() => species?.forms ?? [], [species]);
  // A catch that only evolved into this species is reported separately from
  // the ones actually caught here, so the slot's own tally stays honest. A
  // living dex has nothing to separate: it already puts each entry on exactly
  // one slot, and splitting there would leave the card at "0 catches" for an
  // entry the tile counts as one.
  const evolvedCount = useMemo(
    () =>
      livingDex ? 0 : realCatches.filter((entry) => !startedHere(entry, species, canonical)).length,
    [realCatches, species, canonical, livingDex],
  );

  /** Which scope the override modal opens into: `null` closed, `""`/`""` for
   * the species-level "add manually" entry point, an existing row's own
   * scope (with `autoOpenDetails`) when opened from that row's edit button. */
  const [overrideModalOpen, setOverrideModalOpen] = useState<{
    formCanonical: string;
    gender: string;
    autoOpenDetails: boolean;
    /** Id of the hand-entered catch being edited, if any. */
    entryId?: string;
  } | null>(null);
  const markManuallyRef = useRef<HTMLButtonElement>(null);
  const handleCloseOverrideModal = useCallback(() => {
    setOverrideModalOpen(null);
    markManuallyRef.current?.focus();
  }, []);
  /** Straight into the details editor, from the entry card's own pencil. */
  const editOverrideDetails = useCallback(
    (o: DexOverride) =>
      setOverrideModalOpen({
        formCanonical: o.formCanonical,
        gender: o.gender,
        autoOpenDetails: true,
      }),
    [],
  );
  /** Into the full editor (scope, caught/seen, remove), pre-scoped to this
   * entry so switching to an existing one never needs the species-level "add
   * manually" button, which only ever starts a fresh, unscoped entry. */
  const editOverrideScope = useCallback(
    (o: DexOverride) =>
      setOverrideModalOpen({
        formCanonical: o.formCanonical,
        gender: o.gender,
        autoOpenDetails: false,
      }),
    [],
  );

  return (
    <div className="@container flex flex-col gap-4">
      <SpeciesHeader
        id={id}
        canonical={canonical}
        name={name}
        generation={generation}
        caught={caught}
        headingId={headingId}
      />

      {realCatches.length > 0 && (
        <>
          <SpeciesFacts
            catches={realCatches}
            canonical={canonical}
            games={games}
            languages={languages}
            evolvedCount={evolvedCount}
          />

          <section aria-labelledby={latestId} className="flex flex-col gap-2">
            <h3 id={latestId} className="t-label w-fit">
              {t("dex.latestCatchTitle")}
            </h3>
            <CatchCard
              entry={realCatches[0]}
              canonical={canonical}
              snapshot={snapshot}
              games={games}
              languages={languages}
              onOpenInDashboard={openInDashboard}
              onEditCatch={onEditCatch}
              onEditEntry={(entry) =>
                setOverrideModalOpen({
                  formCanonical:
                    entry.canonical_name === canonical ? "" : (entry.canonical_name ?? ""),
                  gender: entry.gender ?? "",
                  autoOpenDetails: false,
                  entryId: entry.id,
                })
              }
            />
          </section>

          {showAll && (
            <button
              ref={showAllRef}
              type="button"
              onClick={onShowAllCatches}
              className="t-cut min-h-[32px] w-full border border-border-subtle px-3 py-2 text-xs text-text-muted transition-colors hover:border-accent-blue hover:text-text-primary"
            >
              {t("dex.showAllCatches", { count: realCatches.length })}
            </button>
          )}
        </>
      )}

      {failedCatches.length > 0 && (
        // A shiny that got away is "seen", never a catch: its own section
        // keeps it out of the catch facts/history above, which count and
        // date actual catches only.
        <section aria-labelledby={seenId} className="flex flex-col gap-2">
          <h3 id={seenId} className="t-label w-fit">
            {t("dex.filterSeen")}
          </h3>
          {failedCatches.map((entry) => (
            <CatchCard
              key={entry.id}
              entry={entry}
              canonical={canonical}
              snapshot={snapshot}
              games={games}
              languages={languages}
              onOpenInDashboard={openInDashboard}
              onEditCatch={onEditCatch}
              onEditEntry={(entry) =>
                setOverrideModalOpen({
                  formCanonical:
                    entry.canonical_name === canonical ? "" : (entry.canonical_name ?? ""),
                  gender: entry.gender ?? "",
                  autoOpenDetails: false,
                  entryId: entry.id,
                })
              }
            />
          ))}
        </section>
      )}

      {realCatches.length === 0 &&
        failedCatches.length === 0 &&
        // caught-via-override-only (no real catches) has no dedicated copy: the
        // header sprite already reads as caught, and the "manually marked" list
        // below states why. Repeating "not caught yet" next to a caught sprite
        // would contradict it.
        !caught && <p className="text-sm text-text-muted">{t("dex.notCaughtYet")}</p>}

      {speciesOverrides.length > 0 && (
        <section aria-labelledby={manualId} className="flex flex-col gap-2">
          <h3 id={manualId} className="t-label w-fit">
            {t("dex.overrideExisting")}
          </h3>
          {speciesOverrides.map((o) => (
            <ManualEntryCard
              key={`${o.formCanonical}|${o.gender}|${o.game}`}
              override={o}
              forms={forms}
              speciesId={id}
              speciesCanonical={canonical}
              onEditDetails={() => editOverrideDetails(o)}
              onEditScope={() => editOverrideScope(o)}
            />
          ))}
        </section>
      )}

      {/* Visible whether or not the species has any real catches: marking a
          species that was never hunted through this app at all is the whole
          point of the feature. */}
      <button
        ref={markManuallyRef}
        type="button"
        onClick={() =>
          setOverrideModalOpen({ formCanonical: "", gender: "", autoOpenDetails: false })
        }
        className="t-cut min-h-[32px] w-full border border-border-subtle px-3 py-2 text-xs text-text-muted transition-colors hover:border-accent-blue hover:text-text-primary"
      >
        {t("dex.markManually")}
      </button>

      {overrideModalOpen && (
        <DexOverrideModal
          speciesId={id}
          canonical={canonical}
          name={name}
          generation={generation}
          caught={caught}
          overrides={speciesOverrides}
          setOverride={setOverride}
          entries={snapshot}
          onClose={handleCloseOverrideModal}
          initialFormCanonical={overrideModalOpen.formCanonical}
          initialGender={overrideModalOpen.gender}
          autoOpenDetails={overrideModalOpen.autoOpenDetails}
          initialEntryId={overrideModalOpen.entryId}
        />
      )}
    </div>
  );
}
