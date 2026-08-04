/**
 * DexSpeciesDetail.tsx: per-species detail body of the Pokédex.
 *
 * Shows every archived catch that resolved onto one species slot, newest
 * first, with its form, source game, date, hunt method, encounters, phase
 * context and recorded catch metadata. An uncaught species still renders: the
 * silhouette plus a "not caught yet" line is the honest empty state.
 *
 * The same markup serves both presentations of the dex detail: the permanent
 * side panel on wide viewports and {@link DexDetailModal} on narrow ones. It
 * is a container query context, so the facts grid reflows off the width it
 * actually gets instead of the viewport width.
 */
import { useNavigate } from "react-router";
import { useI18n } from "../../contexts/I18nContext";
import { TrimmedBoxSprite } from "../shared/TrimmedBoxSprite";
import { CatchMetaSummary } from "../pokemon/CatchMetaSummary";
import { computePhaseStats } from "../../utils/phase";
import { getDefaultSpriteUrl } from "../../utils/sprites";
import { getGameName } from "../../utils/games";
import type { GameEntry, Pokemon } from "../../types";

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
}

// --- Pure helpers ---

/** Form name of a catch, or the default-form label when it is the base species. */
function formLabel(entry: Pokemon, canonical: string, fallback: string): string {
  if (entry.form_name) return entry.form_name;
  if (entry.canonical_name && entry.canonical_name !== canonical) return entry.canonical_name;
  return fallback;
}

/** Localized game name, falling back to the raw key for unknown games. */
function gameLabel(entry: Pokemon, games: GameEntry[], languages: string[]): string {
  const game = games.find((g) => g.key === entry.game);
  return game ? getGameName(game, languages) : entry.game;
}

/** Completion date in the user's locale, empty when the timestamp is unusable. */
function completionDate(entry: Pokemon, locale: string): string {
  if (!entry.completed_at) return "";
  const date = new Date(entry.completed_at);
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

// --- Catch card ---

/** One labelled fact inside a catch card. */
function Fact({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-[0.18em] text-text-faint">{label}</span>
      <span className="text-sm text-text-secondary">{value}</span>
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
}

/** One archived catch with its facts, phase context and catch metadata. */
function CatchCard({
  entry,
  canonical,
  snapshot,
  games,
  languages,
  onOpenInDashboard,
  onEditCatch,
}: CatchCardProps) {
  const { t, locale } = useI18n();
  const stats = computePhaseStats(entry, snapshot);
  const date = completionDate(entry, locale);
  const phase = phaseLabel(stats, t);

  return (
    <li className="t-panel flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-text-primary">
          {formLabel(entry, canonical, t("dex.defaultForm"))}
        </span>
        {phase && <span className="t-label">{phase}</span>}
      </div>

      {/* Container query, not a viewport one: the narrow side panel and the
          wide modal render this very card at completely different widths. */}
      <div className="grid grid-cols-2 gap-3 @md:grid-cols-4">
        <Fact label={t("dex.sourceGame")} value={gameLabel(entry, games, languages)} />
        {date && <Fact label={t("dex.caughtOn")} value={date} />}
        <Fact label={t("huntType.label")} value={huntMethodLabel(t, entry.hunt_type)} />
        <Fact label={t("dex.encounters")} value={String(entry.encounters ?? 0)} />
      </div>

      <CatchMetaSummary
        meta={entry.catch}
        onEdit={onEditCatch ? () => onEditCatch(entry.id) : undefined}
      />

      <div>
        <button
          type="button"
          onClick={() => onOpenInDashboard(entry.id)}
          className="t-cut border border-border-subtle px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-accent-blue hover:text-text-primary"
        >
          {t("dex.openInDashboard")}
        </button>
      </div>
    </li>
  );
}

// --- Detail body ---

/**
 * Species detail of the Pokédex. Reads nothing itself; every catch it renders
 * was already resolved onto this species by the dex index.
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
}: DexSpeciesDetailProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const caught = catches.length > 0;

  const openInDashboard = (pokemonId: string) => {
    // A router navigation, never history.replaceState: rewriting the entry
    // by hand wipes the data router's own idx/key bookkeeping.
    navigate("/", { state: { openEntryId: pokemonId } });
  };

  return (
    <div className="@container flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <TrimmedBoxSprite
          canonicalName={canonical}
          spriteType={caught ? "shiny" : "normal"}
          alt=""
          fitPx={64}
          // Pokésprite is a gen8 set and 404s for every Gen 9 species, so
          // the PokeAPI default sprite stands in instead of a pokéball.
          fallbackSrc={getDefaultSpriteUrl(id, caught ? "shiny" : "normal")}
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

      {caught ? (
        <ul role="list" className="flex flex-col gap-3">
          {catches.map((entry) => (
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
        </ul>
      ) : (
        <p className="text-sm text-text-muted">{t("dex.notCaughtYet")}</p>
      )}
    </div>
  );
}
