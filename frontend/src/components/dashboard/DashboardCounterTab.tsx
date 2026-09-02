/**
 * DashboardCounterTab.tsx: Hero panel of the counter tab.
 */

import { Minus, Pencil, Plus, RotateCcw, Split } from "lucide-react";
import { Pokemon } from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { pokemonDisplayName } from "../../utils/pokemon";
import { computePhaseStats } from "../../utils/phase";
import { resolveSpriteSrc } from "../../utils/sprites";
import { FreezableSprite } from "../shared/FreezableSprite";
import { CaughtBanner } from "./CaughtBanner";
import { PhaseHistory } from "./PhaseHistory";
import { PhaseTotalTimer } from "./PhaseTotalTimer";
import { PokemonTimer } from "./PokemonTimer";
import { isNewestPhase } from "./phaseHelpers";
import {
  formatGame,
  getBaseAndFormName,
  heroCounterFontSize,
  resolveSpriteUrl,
  stepLabel,
} from "./presentation";

/** Counter tab content: one cohesive hero panel with status, identity, big number, chips, and actions. */
export function DashboardCounterTab({
  pokemon,
  allPokemon,
  imgError,
  oddsDisplay,
  send,
  onImgError,
  onDecrement,
  onIncrement,
  onReset,
  onSetEncounter,
  onEndPhase,
  onUndoPhase,
  onOpenEntry,
  timerStartBlocked = false,
}: Readonly<{
  pokemon: Pokemon;
  allPokemon: Pokemon[];
  imgError: Record<string, string>;
  oddsDisplay: string;
  send: (type: string, payload: unknown) => void;
  onImgError: (id: string, src: string) => void;
  onDecrement: (id: string) => void;
  onIncrement: (id: string) => void;
  onReset: (id: string) => void;
  onSetEncounter: (p: Pokemon) => void;
  onEndPhase: (p: Pokemon) => void;
  onUndoPhase: (child: Pokemon) => void;
  onOpenEntry: (target: Pokemon) => void;
  timerStartBlocked?: boolean;
}>) {
  const { t } = useI18n();
  const spriteUrl = resolveSpriteUrl(pokemon.id, pokemon.sprite_url, imgError);
  const step = stepLabel(pokemon);
  const hasCustomStep = pokemon.step && pokemon.step > 1;
  const isCompleted = !!pokemon.completed_at;
  const [baseName, formName] = getBaseAndFormName(pokemon);
  // Secondary identity line: form and game, dot-separated, both optional.
  const metaLine = [formName, pokemon.game ? formatGame(pokemon.game) : ""]
    .filter(Boolean)
    .join(" \u00b7 ");
  const phase = computePhaseStats(pokemon, allPokemon);
  // Everything derived from phases stays hidden until a phase actually exists,
  // so a plain hunt keeps exactly the numbers it had before the feature.
  const hasPhases = phase.children.length > 0;
  const canEndPhase = !isCompleted && !phase.isPhase;

  return (
    <>
      {isCompleted && (
        <CaughtBanner
          pokemon={pokemon}
          parent={phase.parent}
          canUndo={isNewestPhase(pokemon, allPokemon)}
          onOpenEntry={onOpenEntry}
          onUndoPhase={onUndoPhase}
        />
      )}

      {/* Hero identity: large full sprite (never the box-trimmed variant)
          and name, stacked above the panel instead of inside it. */}
      <div
        className="flex flex-col items-center gap-1 mt-8"
        style={{ width: "min(100%, clamp(420px, 40vw, 620px))" }}
      >
        <FreezableSprite
          src={spriteUrl}
          alt={pokemonDisplayName(pokemon)}
          onError={() => onImgError(pokemon.id, resolveSpriteSrc(pokemon.sprite_url))}
          className="pokemon-sprite object-contain transition-transform duration-300 hover:scale-110"
          style={{ width: "clamp(160px, 17vw, 216px)", height: "clamp(160px, 17vw, 216px)" }}
        />
        <span className="text-[clamp(32px,3.4vw,46px)] font-extrabold text-text-primary capitalize leading-tight text-center">
          {baseName}
        </span>
        {metaLine && (
          <span className="text-sm text-text-muted capitalize truncate">{metaLine}</span>
        )}
      </div>

      <section
        className="t-panel t-hatch p-5 md:p-6 mt-4"
        style={{ width: "min(100%, clamp(420px, 40vw, 620px))" }}
      >
        {/* Header row: hunt status label left, timer controls right */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            {isCompleted ? (
              <span className="t-label">{t("dash.tabArchive")}</span>
            ) : (
              <span
                className={`t-label t-label--accent ${pokemon.is_active ? "" : "invisible"}`}
                title={pokemon.is_active ? t("dash.tooltipSetActive") : undefined}
                aria-hidden={!pokemon.is_active}
              >
                {t("dash.hotkeyBadge")}
              </span>
            )}
            {hasPhases && (
              <span className="t-label border border-accent-purple/40 text-accent-purple px-1.5">
                {t("phase.badge", { number: phase.phaseNumber })}
              </span>
            )}
          </div>
          <PokemonTimer
            pokemon={pokemon}
            send={send}
            disabled={isCompleted}
            timerStartBlocked={timerStartBlocked}
          />
        </div>

        {/* Big number. Raw integer on purpose: no thousands separator, fluid clamp size. */}
        <div className="relative text-center my-3" aria-live="polite">
          <div
            className="font-black tabular-nums leading-none tracking-tight text-text-primary break-all"
            style={{ fontSize: heroCounterFontSize(pokemon.encounters) }}
          >
            {pokemon.encounters}
          </div>
          {!isCompleted && (
            <button
              onClick={() => onSetEncounter(pokemon)}
              className="absolute top-0 right-0 p-1.5 rounded-none hover:bg-bg-hover text-text-faint hover:text-text-primary transition-colors"
              title={t("dash.setEncounters")}
              aria-label={t("dash.setEncounters")}
            >
              <Pencil className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Chips row: odds micro label, plus the phase totals once phases exist */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="t-label t-label--accent gap-1" title={t("aria.odds")}>
            {t("dash.odds") || "Odds"}
            <span className="tabular-nums">{oddsDisplay}</span>
          </span>
          {hasPhases && (
            <>
              <span className="t-label gap-1">
                {t("phase.totalEncounters")}
                <span className="tabular-nums">{phase.totalEncounters}</span>
              </span>
              <PhaseTotalTimer pokemon={pokemon} totalTimerMs={phase.totalTimerMs} />
            </>
          )}
        </div>

        {/* Action row: minus (secondary), plus (primary accent), reset (ghost) */}
        <div className="flex items-center justify-center gap-2 mt-5">
          <button
            onClick={() => !isCompleted && onDecrement(pokemon.id)}
            disabled={isCompleted}
            aria-label={`\u2212${step}`}
            className="flex items-center justify-center h-11 w-11 rounded-none bg-bg-card border border-border-subtle text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={`\u2212${step}`}
          >
            {hasCustomStep ? (
              <span className="text-base font-bold">&minus;{pokemon.step}</span>
            ) : (
              <Minus className="w-5 h-5" />
            )}
          </button>
          <button
            onClick={() => !isCompleted && onIncrement(pokemon.id)}
            disabled={isCompleted}
            aria-label={`+${step}`}
            className="t-cut flex items-center justify-center h-11 min-w-32 px-8 rounded-none bg-accent-blue text-bg-primary font-bold hover:bg-accent-blue/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={`+${step}`}
          >
            {hasCustomStep ? (
              <span className="text-lg font-bold">+{pokemon.step}</span>
            ) : (
              <Plus className="w-6 h-6 stroke-[2.5px]" />
            )}
          </button>
          {!isCompleted && (
            <button
              onClick={() => onReset(pokemon.id)}
              className="flex items-center justify-center h-11 w-11 rounded-none text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors"
              title={t("tooltip.common.reset")}
              aria-label={t("tooltip.common.reset")}
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
          {canEndPhase && (
            <button
              type="button"
              onClick={() => onEndPhase(pokemon)}
              className="flex items-center justify-center gap-1.5 h-11 px-3 rounded-none bg-bg-card border border-border-subtle text-text-secondary hover:border-accent-purple/50 hover:text-accent-purple transition-colors"
              title={t("phase.end")}
              aria-label={t("phase.end")}
            >
              <Split className="w-4 h-4" />
              <span className="text-xs font-semibold">{t("phase.end")}</span>
            </button>
          )}
        </div>
      </section>

      {hasPhases && (
        <PhaseHistory
          entries={phase.children}
          imgError={imgError}
          onImgError={onImgError}
          onOpenEntry={onOpenEntry}
        />
      )}
    </>
  );
}
