/**
 * PhaseTargetsSection.tsx: editor for the phase targets of a hunt.
 *
 * Phase targets are the species a hunter expects to phase on. They are purely
 * optional metadata: the end-phase dialog offers them as quick picks and the
 * overlay can cycle their sprites. The section is embedded in the Pokémon form
 * modal and travels to the backend with the regular pokemon payload.
 */

import { useI18n } from "../../contexts/I18nContext";
import { HelpPopover } from "../shared/HelpPopover";
import { GameEntry, PhaseTarget } from "../../types";
import {
  getSpriteUrl,
  safeSpriteSrc,
  SpriteStyle,
  SPRITE_FALLBACK,
} from "../../utils/sprites";
import { X } from "lucide-react";
import {
  PokemonData,
  PokemonSearchPicker,
  SearchResult,
  buildFormStrip,
  getPkmnName,
  type PickOrigin,
} from "./pokemonPicker";

// --- Types ---

export interface PhaseTargetsSectionProps {
  /** Currently selected targets, in insertion order. */
  readonly targets: readonly PhaseTarget[];
  /** Called with the full next list whenever a target is added or removed. */
  readonly onChange: (targets: PhaseTarget[]) => void;
  /** Pokedex entries to search in (typically from `usePokedex`). */
  readonly allPokemon: PokemonData[];
  /** Game metadata, used to hide forms that do not exist in `selectedGame`. */
  readonly games: GameEntry[];
  /** Game key of the hunt; empty disables form filtering. */
  readonly selectedGame: string;
  /** Pokemon language code used for display names. */
  readonly language: string;
  /** Sprite style of the hunt, so target sprites match the rest of the entry. */
  readonly spriteStyle: SpriteStyle;
}

// --- Helpers ---

/**
 * Convert a picked search entry into a phase target. Targets are always shiny:
 * a phase only ends when a shiny that is not the hunted species shows up.
 */
function toPhaseTarget(
  entry: SearchResult,
  selectedGame: string,
  spriteStyle: SpriteStyle,
  language: string,
): PhaseTarget {
  return {
    canonical_name: entry.canonical,
    name: getPkmnName(entry, language),
    sprite_url: getSpriteUrl(
      entry.spriteId.toString(),
      selectedGame,
      "shiny",
      spriteStyle,
      entry.canonical,
      entry.spriteSlug,
      entry.baseCanonical,
    ),
  };
}

// --- Component ---

/**
 * Multi-select list of phase targets: chips for the current selection plus a
 * species picker to add more. Picking a species that is already in the list is
 * silently ignored, so re-selecting a chip's species is a no-op rather than an
 * error the user has to understand.
 */
export function PhaseTargetsSection({
  targets,
  onChange,
  allPokemon,
  games,
  selectedGame,
  language,
  spriteStyle,
}: Readonly<PhaseTargetsSectionProps>) {
  const { t } = useI18n();

  const addTarget = (entry: SearchResult, origin: PickOrigin) => {
    // Picking from the search list is also what reveals the form strip, so for
    // a species that has one the pick is not a decision yet: adding here would
    // land the base species in the list of everyone who was after a form. The
    // strip leads with the base, so committing to it stays one click away.
    const base = allPokemon.find((p) => p.id === entry.id);
    const hasStrip =
      !!base && buildFormStrip(base, selectedGame, games, language).length > 0;
    if (origin === "search" && hasStrip) return;
    if (targets.some((target) => target.canonical_name === entry.canonical)) return;
    onChange([...targets, toPhaseTarget(entry, selectedGame, spriteStyle, language)]);
  };

  const removeTarget = (canonicalName: string) => {
    onChange(targets.filter((target) => target.canonical_name !== canonicalName));
  };

  return (
    <div className="flex flex-col gap-2">
      <div>
        <div className="flex items-center gap-1.5">
          <h3 className="text-xs text-text-secondary font-medium">{t("phase.targetsTitle")}</h3>
          {/* The section is the first place the word "phase" shows up for someone
              who has never phased, so the definition sits right next to it. */}
          <HelpPopover label={t("aria.phaseHelp")} title={t("phase.helpTitle")}>
            {t("phase.helpText")}
          </HelpPopover>
        </div>
        <p className="text-[11px] text-text-muted mt-0.5">{t("phase.targetsHint")}</p>
      </div>

      {targets.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5 list-none p-0 m-0">
          {targets.map((target) => (
            <li
              key={target.canonical_name}
              className="inline-flex items-center gap-1 min-h-[24px] pl-1.5 pr-1 py-0.5 rounded-none border border-border-subtle bg-bg-secondary text-xs text-text-secondary"
            >
              <img
                src={safeSpriteSrc(target.sprite_url)}
                alt=""
                className="h-5 w-5 object-contain shrink-0 pokemon-sprite"
                onError={(e) => {
                  const img = e.currentTarget;
                  if (img.src !== SPRITE_FALLBACK) img.src = SPRITE_FALLBACK;
                }}
              />
              <span className="capitalize truncate max-w-[10rem]">{target.name}</span>
              {/* Sibling button, never nested inside another interactive element. */}
              <button
                type="button"
                onClick={() => removeTarget(target.canonical_name)}
                aria-label={t("aria.phaseRemoveTarget", { name: target.name })}
                className="p-1 min-w-[24px] min-h-[24px] flex items-center justify-center rounded-none text-text-muted hover:text-accent-red transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
              >
                <X className="w-3 h-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-text-faint">{t("phase.targetsEmpty")}</p>
      )}

      <PokemonSearchPicker
        allPokemon={allPokemon}
        games={games}
        selectedGame={selectedGame}
        language={language}
        placeholder={t("phase.searchPlaceholder")}
        inputLabel={t("aria.phaseSearch")}
        onPick={addTarget}
      />
    </div>
  );
}
