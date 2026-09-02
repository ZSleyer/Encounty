/**
 * CatchCard.tsx: one archived catch as it appears in the Pokédex.
 *
 * The same card serves the inline "latest catch" of the species panel and every
 * row of the full catch list, so both presentations of one hunt stay identical.
 */
import { Pencil } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import { CatchMetaSummary } from "../pokemon/CatchMetaSummary";
import { computePhaseStats } from "../../utils/phase";
import { resolveSpriteSrc, SPRITE_FALLBACK } from "../../utils/sprites";
import { usePokedex, PokemonThumb } from "../pokemon/pokemonPicker";
import type { GameEntry, Pokemon } from "../../types";
import { pokemonDisplayName } from "../../utils/pokemon";
import { formatTimer } from "../../utils/timer";
import { Fact } from "./Fact";
import { PhaseHistory } from "./PhaseHistory";
import { CurrentEvolutionSprite } from "./CurrentEvolutionSprite";
import {
  completionDate,
  formLabel,
  gameLabel,
  huntMethodLabel,
  phaseLabel,
} from "./dexDetailHelpers";

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
export function CatchCard({
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
    : allPokemon.find(
        (candidate) =>
          candidate.canonical === entry.canonical_name ||
          candidate.forms?.some((form) => form.canonical === entry.canonical_name),
      );
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
          {entry.nickname?.trim()
            ? pokemonDisplayName(entry)
            : formLabel(entry, canonical, t("dex.defaultForm"))}
          {entry.gender &&
            ` · ${t(entry.gender === "male" ? "catchMeta.genderMale" : "catchMeta.genderFemale")}`}
        </span>
        {isManual && <span className="t-label t-label--accent">{t("dex.manualBadge")}</span>}
        {phase && <span className="t-label">{phase}</span>}
        {entry.failed && <span className="t-label t-label--danger">{t("dex.failedTag")}</span>}
      </div>

      {/* Container query, not a viewport one: the narrow side panel and the
          wide modal render this very card at completely different widths. */}
      <div className="grid grid-cols-2 gap-3 @md:grid-cols-4">
        {entry.game && (
          <Fact label={t("dex.sourceGame")} value={gameLabel(entry, games, languages)} />
        )}
        {date && <Fact label={t(entry.failed ? "dex.failedOn" : "dex.caughtOn")} value={date} />}
        <Fact label={t("huntType.label")} value={huntMethodLabel(t, entry.hunt_type)} />
        <Fact label={t("dex.encounters")} value={String(entry.encounters ?? 0)} numeric />
        {timerMs > 0 && <Fact label={t("modal.timerLabel")} value={formatTimer(timerMs)} numeric />}
      </div>

      <PhaseHistory
        children={stats.children}
        totals={{ encounters: stats.totalEncounters, timerMs: stats.totalTimerMs }}
      />

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
              aria-label={t("aria.dexOverrideEdit")}
              className="relative t-cut min-h-[24px] min-w-[24px] border border-border-subtle px-3 py-1.5 text-text-muted transition-colors after:absolute after:-inset-2 after:content-[''] hover:border-accent-blue hover:text-text-primary"
            >
              <Pencil className="h-3 w-3" />
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
