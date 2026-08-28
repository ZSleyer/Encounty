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
import { Pencil } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import { TrimmedBoxSprite } from "../shared/TrimmedBoxSprite";
import { CatchMetaSummary } from "../pokemon/CatchMetaSummary";
import { computePhaseStats } from "../../utils/phase";
import { computeSpecimenPhaseStats, specimenPhaseChildren } from "../../utils/specimenPhase";
import { getDefaultSpriteUrl, resolveSpriteSrc, cachedSpriteSrc, SPRITE_FALLBACK } from "../../utils/sprites";
import { getGameName } from "../../utils/games";
import type { SetOverrideInput } from "../../hooks/useDexOverrides";
import type { DexSpecimen, SpecimenInput } from "../../hooks/useDexSpecimens";
import {
  DexOverrideModal,
  formLabel as overrideFormLabel,
  genderLabel as overrideGenderLabel,
} from "./DexOverrideModal";
import { usePokedex, PokemonThumb, getPkmnName, type PokemonData, type PokemonForm } from "../pokemon/pokemonPicker";
import type { DexOverride } from "../../utils/dex";
import type { GameEntry, Pokemon } from "../../types";
import { pokemonDisplayName } from "../../utils/pokemon";
import { formatTimer } from "../../utils/timer";

// --- Constants ---

/**
 * Games named as chips before the rest collapses into a count. Three keeps the
 * row on one line even in the ~340px side panel, and the newest games are the
 * ones a hunter is still playing.
 */
const GAME_CHIP_LIMIT = 3;

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
  /** Game catalogue used to localize the source game. */
  readonly games: GameEntry[];
  /** Language priority list for game names. */
  readonly languages: string[];
  /** Id of the species-name heading, so a wrapper can point `aria-labelledby` at it. */
  readonly headingId?: string;
  /** Opens the catch-metadata editor for one archived catch. */
  readonly onEditCatch?: (pokemonId: string) => void;
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
   * Every manual override, so the "manually marked" list and the caught flag
   * above both reflect the same state the grid is built from.
   */
  readonly overrides: DexOverride[];
  /**
   * Writes one manual override; shared with the dex grid so a write here
   * updates the grid slot immediately instead of only on the next fetch.
   */
  readonly setOverride: (input: SetOverrideInput) => Promise<void>;
  readonly specimens?: DexSpecimen[];
  /** Writes one specimen and resolves with the persisted row, so a caller can attach children to a freshly created one. */
  readonly saveSpecimen?: (input: SpecimenInput) => Promise<DexSpecimen>;
  readonly removeSpecimen?: (id: number) => Promise<void>;
}

/** Props for {@link DexCatchList}. */
export interface DexCatchListProps {
  /** Catches to list, newest `completed_at` first. */
  readonly catches: Pokemon[];
  /** English PokéAPI slug of the base species. */
  readonly canonical: string;
  /** Full state snapshot, needed to resolve phase parents and children. */
  readonly snapshot: Pokemon[];
  /** Game catalogue used to localize the source game. */
  readonly games: GameEntry[];
  /** Language priority list for game names. */
  readonly languages: string[];
  /** Opens the catch-metadata editor for one archived catch. */
  readonly onEditCatch?: (pokemonId: string) => void;
}

// --- Pure helpers ---

/** Form name of a catch, or the default-form label when it is the base species. */
function formLabel(entry: Pokemon, canonical: string, fallback: string): string {
  if (entry.form_name) return entry.form_name;
  if (entry.canonical_name && entry.canonical_name !== canonical) return entry.canonical_name;
  return fallback;
}

/** Localized game name, falling back to the raw key for unknown games. */
function gameLabel(entry: { game?: string }, games: GameEntry[], languages: string[]): string {
  const game = games.find((g) => g.key === entry.game);
  return game ? getGameName(game, languages) : entry.game ?? "";
}

/** Completion date in the user's locale, empty when the timestamp is unusable. */
function completionDate(entry: { completed_at?: string } | undefined, locale: string): string {
  if (!entry?.completed_at) return "";
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(entry.completed_at);
  const date = parts
    ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))
    : new Date(entry.completed_at);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(locale);
}

/**
 * Localized hunt method. An empty hunt type means the plain encounter, and a
 * type with no translation falls back to it too: a retired or foreign value
 * must never leak its raw i18n key into the UI.
 */
function huntMethodLabel(
  t: (key: string, options?: Record<string, string | number>) => string,
  huntType: string | undefined,
): string {
  const fallback = t("huntType.encounter");
  if (!huntType) return fallback;
  const label = t(`huntType.${huntType}`);
  return label === `huntType.${huntType}` ? fallback : label;
}

/**
 * Phase context of one catch: which phase it froze, or how far the hunt it
 * belongs to has phased. Returns an empty string when phases never came up.
 */
function phaseLabel(
  stats: ReturnType<typeof computePhaseStats>,
  t: (key: string, options?: Record<string, string | number>) => string,
): string {
  if (stats.isPhase) {
    return stats.parent
      ? t("phase.ofHunt", { number: stats.phaseNumber, name: stats.parent.name })
      : t("phase.badge", { number: stats.phaseNumber });
  }
  if (stats.children.length > 0) return t("phase.badge", { number: stats.phaseNumber });
  return "";
}

/**
 * Phase context of one manual specimen. Same wording and the same two i18n
 * keys as {@link phaseLabel}, but a specimen has no name of its own, so the
 * parent has to be named through the pokedex.
 */
function specimenPhaseLabel(
  specimen: DexSpecimen,
  all: DexSpecimen[],
  allPokemon: PokemonData[],
  locale: string,
  t: (key: string, options?: Record<string, string | number>) => string,
): string {
  const stats = computeSpecimenPhaseStats(specimen, all);
  if (!stats.isPhase) return "";
  const parentSpecies = stats.parent
    ? allPokemon.find((entry) => entry.id === stats.parent!.species_id)
    : undefined;
  return parentSpecies
    ? t("phase.ofHunt", { number: stats.phaseNumber, name: getPkmnName(parentSpecies, locale) })
    : t("phase.badge", { number: stats.phaseNumber });
}

/** Number of distinct forms across the catches of one species. */
function countForms(catches: Pokemon[], canonical: string, fallback: string): number {
  return new Set(catches.map((entry) => formLabel(entry, canonical, fallback))).size;
}

/**
 * Distinct source games in catch order, so the newest game comes first and the
 * chip row can be cut from the tail. Deduplication runs on the game key, not
 * on the label: several legacy keys share one display name.
 */
function distinctGames(
  catches: Pokemon[],
  games: GameEntry[],
  languages: string[],
): { key: string; label: string }[] {
  const seen = new Set<string>();
  const result: { key: string; label: string }[] = [];
  for (const entry of catches) {
    if (seen.has(entry.game)) continue;
    seen.add(entry.game);
    result.push({ key: entry.game, label: gameLabel(entry, games, languages) });
  }
  return result;
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

// --- Fact ---

interface FactProps {
  readonly label: string;
  readonly value: string;
  /** Counts render tabular so a column of them keeps its digits aligned. */
  readonly numeric?: boolean;
}

/** One labelled fact inside a card. */
function Fact({ label, value, numeric = false }: FactProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-[0.18em] text-text-faint">{label}</span>
      <span className={`text-sm text-text-secondary ${numeric ? "tabular-nums" : ""}`}>
        {value}
      </span>
    </div>
  );
}

// --- Catch card ---

/**
 * Phases recorded under one entry, with the two totals the dashboard reports
 * for a phased hunt. Rendered on every catch, so the phase history of a hunt
 * tracked in this app is finally visible in the pokedex too.
 */
function PhaseHistory({ children, totals }: {
  readonly children: Pokemon[];
  readonly totals: { encounters: number; timerMs: number };
}) {
  const { t, locale } = useI18n();
  if (children.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 border-t border-border-subtle pt-3">
      <h4 className="t-label w-fit">{t("phase.historyTitle")}</h4>
      <ul role="list" aria-label={t("aria.phaseList")} className="flex flex-col gap-2">
        {children.map((child) => (
          <li key={child.id} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="t-label t-label--accent">{t("phase.badge", { number: child.phase_number ?? 0 })}</span>
              <span className="text-sm text-text-primary">{pokemonDisplayName(child)}</span>
              {child.failed && <span className="t-label t-label--danger">{t("dex.failedTag")}</span>}
            </div>
            <div className="grid grid-cols-2 gap-3 @md:grid-cols-3">
              {completionDate(child, locale) && (
                <Fact label={t("dex.caughtOn")} value={completionDate(child, locale)} />
              )}
              <Fact label={t("dex.encounters")} value={String(child.encounters ?? 0)} numeric />
              <Fact label={t("modal.timerLabel")} value={formatTimer(child.timer_accumulated_ms ?? 0)} numeric />
            </div>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-2 gap-3">
        <Fact label={t("phase.totalEncounters")} value={String(totals.encounters)} numeric />
        <Fact label={t("phase.totalTime")} value={formatTimer(totals.timerMs)} numeric />
      </div>
    </div>
  );
}

interface CatchCardProps {
  readonly entry: Pokemon;
  readonly canonical: string;
  readonly snapshot: Pokemon[];
  readonly games: GameEntry[];
  readonly languages: string[];
  readonly onOpenInDashboard: (pokemonId: string) => void;
  readonly onEditCatch?: (pokemonId: string) => void;
  /** Opens the manual editor; only wired for hand-entered entries. */
  readonly onEditEntry?: (entry: Pokemon) => void;
}

/**
 * One archived catch with its facts, phase context and catch metadata. Two
 * catches of the same species in the same game are told apart by exactly these
 * fields, so date, encounters and the metadata all stay on the card.
 */
function CatchCard({
  entry,
  canonical,
  snapshot,
  games,
  languages,
  onOpenInDashboard,
  onEditCatch,
  onEditEntry,
}: CatchCardProps) {
  const { t, locale } = useI18n();
  const { allPokemon } = usePokedex();
  const stats = computePhaseStats(entry, snapshot);
  const date = completionDate(entry, locale);
  const phase = phaseLabel(stats, t);
  const currentEvolution = entry.catch?.evolutions?.[entry.catch.evolutions.length - 1];
  const isManual = entry.entry_source === "manual";
  // A hand-entered catch records no image of its own, so the canonical box
  // sprite has to be resolved through the pokedex instead.
  const spriteSpecies = entry.sprite_url
    ? undefined
    : allPokemon.find((candidate) =>
        candidate.canonical === entry.canonical_name ||
        candidate.forms?.some((form) => form.canonical === entry.canonical_name));
  const spriteForm = spriteSpecies?.forms?.find((form) => form.canonical === entry.canonical_name);
  const timerMs = entry.timer_accumulated_ms ?? 0;

  return (
    <div className="t-panel flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {/* The recorded sprite, not a canonical-derived box sprite: a hunter
            may have picked a custom image, and the whole point here is to
            tell forms apart at a glance by what was actually caught. */}
        {currentEvolution ? (
          <CurrentEvolutionSprite
            canonical={currentEvolution.canonical_name}
            gender={currentEvolution.gender}
            allPokemon={allPokemon}
          />
        ) : (
          <img
            src={resolveSpriteSrc(entry.sprite_url)}
            alt=""
            className="h-8 w-8 shrink-0 object-contain"
            onError={(e) => {
              e.currentTarget.onerror = null;
              e.currentTarget.src = SPRITE_FALLBACK;
            }}
          />
        )}
        {!currentEvolution && !entry.sprite_url && spriteSpecies && (
          <PokemonThumb
            spriteId={spriteForm?.sprite_id ?? spriteSpecies.id}
            canonical={entry.canonical_name}
            spriteSlug={spriteForm?.sprite_slug}
            gender={spriteForm?.gender}
            alt=""
            className="h-8 w-8 shrink-0 object-contain"
          />
        )}
        <span className="text-sm font-semibold text-text-primary">
          {entry.nickname?.trim() ? pokemonDisplayName(entry) : formLabel(entry, canonical, t("dex.defaultForm"))}
          {entry.gender && ` · ${t(entry.gender === "male" ? "catchMeta.genderMale" : "catchMeta.genderFemale")}`}
        </span>
        {isManual && <span className="t-label t-label--accent">{t("dex.manualBadge")}</span>}
        {phase && <span className="t-label">{phase}</span>}
        {entry.failed && <span className="t-label t-label--danger">{t("dex.failedTag")}</span>}
      </div>

      {/* Container query, not a viewport one: the narrow side panel and the
          wide modal render this very card at completely different widths. */}
      <div className="grid grid-cols-2 gap-3 @md:grid-cols-4">
        {entry.game && <Fact label={t("dex.sourceGame")} value={gameLabel(entry, games, languages)} />}
        {date && <Fact label={t(entry.failed ? "dex.failedOn" : "dex.caughtOn")} value={date} />}
        <Fact label={t("huntType.label")} value={huntMethodLabel(t, entry.hunt_type)} />
        <Fact label={t("dex.encounters")} value={String(entry.encounters ?? 0)} numeric />
        {timerMs > 0 && <Fact label={t("modal.timerLabel")} value={formatTimer(timerMs)} numeric />}
      </div>

      <PhaseHistory children={stats.children} totals={{ encounters: stats.totalEncounters, timerMs: stats.totalTimerMs }} />

      <CatchMetaSummary
        meta={entry.catch}
        gender={entry.gender}
        originCanonical={entry.canonical_name}
        onEdit={onEditCatch ? () => onEditCatch(entry.id) : undefined}
      />

      {/* A hand-entered catch has no dashboard record to open, so it offers
          its editor instead. */}
      <div>
        {isManual ? (
          onEditEntry && (
            <button
              type="button"
              onClick={() => onEditEntry(entry)}
              className="t-cut min-h-[24px] border border-border-subtle px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-accent-blue hover:text-text-primary"
            >
              {t("aria.dexOverrideEdit")}
            </button>
          )
        ) : (
          <button
            type="button"
            onClick={() => onOpenInDashboard(entry.id)}
            className="t-cut min-h-[24px] border border-border-subtle px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-accent-blue hover:text-text-primary"
          >
            {t("dex.openInDashboard")}
          </button>
        )}
      </div>
    </div>
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
          />
        </li>
      ))}
    </ul>
  );
}

// --- Game chips ---

interface GameChipsProps {
  readonly games: { key: string; label: string }[];
}

/** The source games of a species, collapsed to the newest few plus a count. */
function GameChips({ games }: GameChipsProps) {
  const { t } = useI18n();
  const shown = games.slice(0, GAME_CHIP_LIMIT);
  const hidden = games.length - shown.length;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((game) => (
        <span key={game.key} className="t-label">
          {game.label}
        </span>
      ))}
      {hidden > 0 && (
        <span className="t-label tabular-nums">{t("dex.moreGames", { count: hidden })}</span>
      )}
    </div>
  );
}

// --- Aggregate card ---

interface SpeciesFactsProps {
  readonly catches: Pokemon[];
  readonly canonical: string;
  readonly games: GameEntry[];
  readonly languages: string[];
}

/**
 * What the whole slot amounts to: how often, in how many forms, out of which
 * games, and over which stretch of time. The first-catch date is dropped when
 * it would only repeat the last one.
 */
function SpeciesFacts({ catches, canonical, games, languages }: SpeciesFactsProps) {
  const { t, locale } = useI18n();
  const newest = completionDate(catches[0], locale);
  const oldest = completionDate(catches[catches.length - 1], locale);
  const sources = distinctGames(catches, games, languages);

  const facts = [
    { key: "count", label: t("dex.catchCount"), value: String(catches.length), numeric: true },
    {
      key: "forms",
      label: t("dex.variants"),
      value: String(countForms(catches, canonical, t("dex.defaultForm"))),
      numeric: true,
    },
  ];
  if (oldest && oldest !== newest) {
    facts.push({ key: "first", label: t("dex.firstCatch"), value: oldest, numeric: false });
  }
  if (newest) {
    facts.push({ key: "last", label: t("dex.latestCatch"), value: newest, numeric: false });
  }

  return (
    <div className="t-panel flex flex-col gap-3 p-4">
      <div className="grid grid-cols-2 gap-3 @md:grid-cols-4">
        {facts.map((entry) => (
          <Fact key={entry.key} label={entry.label} value={entry.value} numeric={entry.numeric} />
        ))}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] uppercase tracking-[0.18em] text-text-faint">
          {t("dex.games")}
        </span>
        <GameChips games={sources} />
      </div>
    </div>
  );
}

// --- Species header ---

/** Props for {@link SpeciesHeader}. */
export interface SpeciesHeaderProps {
  readonly id: number;
  readonly canonical: string;
  readonly name: string;
  readonly generation: number;
  readonly caught: boolean;
  readonly headingId?: string;
}

/** Sprite, padded dex number, localized name and generation chip. */
export function SpeciesHeader({
  id,
  canonical,
  name,
  generation,
  caught,
  headingId,
}: SpeciesHeaderProps) {
  const { t } = useI18n();

  return (
    <div className="flex items-center gap-4">
      <TrimmedBoxSprite
        canonicalName={canonical}
        spriteType={caught ? "shiny" : "normal"}
        alt=""
        fitPx={64}
        // Pokésprite is a gen8 set and 404s for every Gen 9 species, so
        // the PokeAPI default sprite stands in instead of a pokéball.
        fallbackSrc={cachedSpriteSrc(getDefaultSpriteUrl(id, caught ? "shiny" : "normal"))}
        className={caught ? "" : "t-dex-silhouette"}
      />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-mono text-xs tabular-nums text-text-faint">
          #{String(id).padStart(4, "0")}
        </span>
        <h2 id={headingId} className="text-base font-semibold text-text-primary">
          {name}
        </h2>
        <span className="t-label w-fit">{t("dex.generation", { n: generation })}</span>
      </div>
    </div>
  );
}

// --- Manual entry card ---

/** Sprite identity for an override's scope: its own form when set, the base
 * species otherwise. Mirrors how a real catch's `canonical_name` picks the
 * sprite, so a manual entry's card looks the same as an archived one. */
function spriteForOverride(
  o: DexOverride,
  forms: PokemonForm[],
  speciesId: number,
  speciesCanonical: string,
): { spriteId: number; canonical: string; spriteSlug?: string; gender?: "male" | "female" } {
  const form = o.formCanonical ? forms.find((f) => f.canonical === o.formCanonical) : undefined;
  if (form) {
    return {
      spriteId: form.sprite_id,
      canonical: form.canonical,
      spriteSlug: form.sprite_slug,
      gender: form.gender,
    };
  }
  return { spriteId: speciesId, canonical: speciesCanonical };
}

function CurrentEvolutionSprite({ canonical, gender, allPokemon }: Readonly<{
  canonical: string;
  gender?: "male" | "female" | "genderless";
  allPokemon: PokemonData[];
}>) {
  const species = allPokemon.find((entry) => entry.canonical === canonical || entry.forms?.some((form) => form.canonical === canonical));
  const form = species?.forms?.find((entry) => entry.canonical === canonical);
  return (
    <PokemonThumb
      spriteId={form?.sprite_id ?? species?.id ?? 0}
      canonical={canonical}
      spriteSlug={form?.sprite_slug}
      gender={form?.gender ?? (gender === "male" || gender === "female" ? gender : undefined)}
      alt=""
      className="h-8 w-8 shrink-0 object-contain"
    />
  );
}

interface ManualEntryCardProps {
  readonly override: DexOverride;
  readonly forms: PokemonForm[];
  readonly speciesId: number;
  readonly speciesCanonical: string;
  readonly originCanonical?: string;
  readonly specimen?: DexSpecimen;
  /** Phases recorded under this entry, in ascending order. */
  readonly phases?: DexSpecimen[];
  /** "Phase n of X" when this entry is itself a phase of another hunt. */
  readonly phaseLabel?: string;
  readonly games: GameEntry[];
  readonly languages: string[];
  /** Opens the details editor directly (the summary panel's own pencil). */
  readonly onEditDetails: () => void;
  /**
   * Opens the full override editor (form/gender scope, caught/seen, remove)
   * pre-scoped to this exact entry. The species-level "add manually" button
   * only ever starts a fresh, unscoped entry; this is the only way back into
   * an existing one's own scope without picking it again from that button.
   */
  readonly onEditScope: () => void;
}

/**
 * One manual override styled exactly like {@link CatchCard}, so a hunt logged
 * through the app and a species marked by hand read as the same kind of
 * thing at a glance. The "manually marked" badge is the one thing that tells
 * them apart, since a manual entry has no game/date/hunt-method facts and no
 * dashboard record to open.
 */
function ManualEntryCard({
  override: o,
  forms,
  speciesId,
  speciesCanonical,
  originCanonical,
  specimen,
  phases = [],
  phaseLabel: phaseChip,
  games,
  languages,
  onEditDetails,
  onEditScope,
}: ManualEntryCardProps) {
  const { t, locale } = useI18n();
  const { allPokemon } = usePokedex();
  const sprite = spriteForOverride(o, forms, speciesId, speciesCanonical);
  const currentEvolution = o.meta?.evolutions?.[o.meta.evolutions.length - 1];

  return (
    <div className="t-panel flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {currentEvolution ? <CurrentEvolutionSprite canonical={currentEvolution.canonical_name} gender={currentEvolution.gender} allPokemon={allPokemon} /> : <PokemonThumb
          spriteId={sprite.spriteId}
          canonical={sprite.canonical}
          spriteSlug={sprite.spriteSlug}
          gender={sprite.gender}
          alt=""
          className="h-8 w-8 shrink-0 object-contain"
        />}
        <span className="text-sm font-semibold text-text-primary">
          {o.meta?.nickname?.trim() || overrideFormLabel(o, forms, locale, t)}
          {o.gender && ` · ${overrideGenderLabel(o, t)}`}
        </span>
        <span className="t-label t-label--accent">{t("dex.manualBadge")}</span>
        {phaseChip && <span className="t-label">{phaseChip}</span>}
        <span className="t-label">{o.caught ? t("dex.overrideCaught") : t("dex.overrideSeen")}</span>
        <button
          type="button"
          onClick={onEditScope}
          aria-label={t("aria.dexOverrideEdit")}
          className="relative ml-auto after:absolute after:-inset-2 after:content-[''] t-label text-text-muted hover:text-text-primary transition-colors"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </div>

      {specimen && (
        <div className="grid grid-cols-2 gap-3 @md:grid-cols-4">
          {specimen.game && <Fact label={t("dex.sourceGame")} value={gameLabel(specimen, games, languages)} />}
          {specimen.completed_at && <Fact label={t("dex.caughtOn")} value={completionDate(specimen, locale)} />}
          {specimen.hunt_type && <Fact label={t("huntType.label")} value={huntMethodLabel(t, specimen.hunt_type)} />}
          <Fact label={t("dex.encounters")} value={String(specimen.encounters ?? 0)} numeric />
          <Fact label={t("modal.timerLabel")} value={formatTimer(specimen.timer_accumulated_ms ?? 0)} numeric />
        </div>
      )}

      {phases.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-border-subtle pt-3">
          <h4 className="t-label w-fit">{t("phase.historyTitle")}</h4>
          <ul role="list" className="flex flex-col gap-2">
            {phases.map((phase) => {
              const phaseSpecies = allPokemon.find((entry) => entry.id === phase.species_id);
              const phaseForm = phaseSpecies?.forms?.find((form) => form.canonical === phase.form_canonical);
              return (
                <li key={phase.id} className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="t-label t-label--accent">{t("phase.badge", { number: phase.phase_number ?? 0 })}</span>
                    <span className="text-sm text-text-primary">
                      {phaseSpecies ? getPkmnName(phaseForm ?? phaseSpecies, locale, t("dex.genderFormFemale")) : ""}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 @md:grid-cols-3">
                    {phase.completed_at && <Fact label={t("dex.caughtOn")} value={completionDate(phase, locale)} />}
                    <Fact label={t("dex.encounters")} value={String(phase.encounters ?? 0)} numeric />
                    <Fact label={t("modal.timerLabel")} value={formatTimer(phase.timer_accumulated_ms ?? 0)} numeric />
                  </div>
                </li>
              );
            })}
          </ul>
          {specimen && (
            <div className="grid grid-cols-2 gap-3">
              <Fact label={t("phase.totalEncounters")} value={String(computeSpecimenPhaseStats(specimen, [specimen, ...phases]).totalEncounters)} numeric />
              <Fact label={t("phase.totalTime")} value={formatTimer(computeSpecimenPhaseStats(specimen, [specimen, ...phases]).totalTimerMs)} numeric />
            </div>
          )}
        </div>
      )}

      <CatchMetaSummary meta={o.meta} gender={o.gender as "male" | "female" || undefined} originCanonical={originCanonical ?? (o.formCanonical || speciesCanonical)} onEdit={onEditDetails} />
    </div>
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
  overrides,
  setOverride,
  specimens = [],
  saveSpecimen,
  removeSpecimen = async () => {},
}: DexSpeciesDetailProps) {
  const { t, locale } = useI18n();
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
  const speciesSpecimens = useMemo(() => {
    const selected = allPokemon.find((entry) => entry.id === id);
    const canonicals = new Set([selected?.canonical, ...(selected?.forms ?? []).map((form) => form.canonical)].filter(Boolean));
    return specimens.filter((specimen) => {
      if (specimen.species_id === id) return true;
      const origin = specimen.form_canonical || allPokemon.find((entry) => entry.id === specimen.species_id)?.canonical;
      return Boolean(origin && canonicals.has(origin)) || (specimen.meta?.evolutions ?? []).some((step) => canonicals.has(step.canonical_name));
    });
  }, [specimens, allPokemon, id]);
  const forms = useMemo(
    () => allPokemon.find((p) => p.id === id)?.forms ?? [],
    [allPokemon, id],
  );

  /** Which scope the override modal opens into: `null` closed, `""`/`""` for
   * the species-level "add manually" entry point, an existing row's own
   * scope (with `autoOpenDetails`) when opened from that row's edit button. */
  const [overrideModalOpen, setOverrideModalOpen] = useState<{
    formCanonical: string;
    gender: string;
    autoOpenDetails: boolean;
    specimenId?: number;
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
              games={games}
              languages={languages}
              onEditDetails={() => editOverrideDetails(o)}
              onEditScope={() => editOverrideScope(o)}
            />
          ))}
        </section>
      )}

      {speciesSpecimens.length > 0 && (
        <section aria-labelledby={manualId} className="flex flex-col gap-2">
          <h3 className="t-label w-fit">{t("dex.overrideExisting")}</h3>
          {speciesSpecimens.map((specimen) => (
            (() => {
              // A phase whose parent is listed right here would otherwise show
              // up twice, once nested under it and once on its own.
              if (specimen.phase_of && speciesSpecimens.some((entry) => entry.id === specimen.phase_of)) return null;
              const originSpecies = allPokemon.find((entry) => entry.id === specimen.species_id);
              const originCanonical = specimen.form_canonical || originSpecies?.canonical || canonical;
              return (
            <ManualEntryCard
              key={`specimen-${specimen.id}`}
              override={{ id: specimen.id, speciesId: specimen.species_id, formCanonical: specimen.form_canonical ?? "", gender: specimen.gender ?? "", game: specimen.game ?? "", caught: true, seen: true, meta: specimen.meta }}
              forms={originSpecies?.forms ?? []}
              speciesId={specimen.species_id}
              speciesCanonical={originSpecies?.canonical ?? canonical}
              originCanonical={originCanonical}
              specimen={specimen}
              phases={specimenPhaseChildren(specimens, specimen.id)}
              phaseLabel={specimenPhaseLabel(specimen, specimens, allPokemon, locale, t)}
              games={games}
              languages={languages}
              onEditDetails={() => setOverrideModalOpen({ formCanonical: specimen.form_canonical ?? "", gender: specimen.gender ?? "", autoOpenDetails: true, specimenId: specimen.id })}
              onEditScope={() => setOverrideModalOpen({ formCanonical: specimen.form_canonical ?? "", gender: specimen.gender ?? "", autoOpenDetails: false, specimenId: specimen.id })}
            />
              );
            })()
          ))}
        </section>
      )}

      {/* Visible whether or not the species has any real catches: marking a
          species that was never hunted through this app at all is the whole
          point of the feature. */}
      <button
        ref={markManuallyRef}
        type="button"
        onClick={() => setOverrideModalOpen({ formCanonical: "", gender: "", autoOpenDetails: false })}
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
          specimens={specimens}
          saveSpecimen={saveSpecimen}
          removeSpecimen={removeSpecimen}
          onClose={handleCloseOverrideModal}
          initialFormCanonical={overrideModalOpen.formCanonical}
          initialGender={overrideModalOpen.gender}
          autoOpenDetails={overrideModalOpen.autoOpenDetails}
          initialSpecimenId={overrideModalOpen.specimenId}
        />
      )}
    </div>
  );
}
