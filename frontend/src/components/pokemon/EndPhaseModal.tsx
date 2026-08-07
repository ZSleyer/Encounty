/**
 * EndPhaseModal.tsx: dialog for ending the current phase of a running hunt.
 *
 * A phase ends when a shiny shows up that is not the hunted species. The only
 * question this modal asks is which species that was: game, language, hunt
 * method, sprite style and the encounter count are all inherited from the
 * parent hunt, and the caught species is always shiny. The parent's phase
 * targets are offered as one-click chips, everything else is reachable through
 * the shared species search.
 */
import { useId, useState } from "react";
import { useI18n } from "../../contexts/I18nContext";
import type { PhaseTarget, Pokemon } from "../../types";
import { ModalShell } from "../shared/ModalShell";
import { formatTimer } from "../../utils/timer";
import {
  getSpriteUrl,
  resolveSpriteSrc,
  SPRITE_FALLBACK,
} from "../../utils/sprites";
import {
  getPkmnName,
  usePokedex,
  PokemonSearchPicker,
  type SearchResult,
} from "./pokemonPicker";

// --- Types ---

/** Payload sent to POST /api/pokemon/{parentId}/phase. */
export interface PhaseCatchData {
  /** English PokeAPI slug of the caught species; empty for free-text entries. */
  canonical_name: string;
  /** Localized display name; the only field the backend requires. */
  name: string;
  /** Base species name when a form was picked. */
  base_name?: string;
  /** Form label when a form was picked. */
  form_name?: string;
  /** Resolved shiny sprite URL in the parent's sprite style. */
  sprite_url: string;
}

/** Props for {@link EndPhaseModal}. */
export interface EndPhaseModalProps {
  /** The running hunt whose phase is being closed. */
  readonly parent: Pokemon;
  /** Number of the phase that is being closed (1-based). */
  readonly phaseNumber: number;
  /** Encounters accumulated in this phase. */
  readonly encounters: number;
  /** Duration of this phase in milliseconds. */
  readonly timerMs: number;
  /** Sends the phase catch; awaited before the modal closes. */
  readonly onSubmit: (data: PhaseCatchData) => Promise<void> | void;
  /** Called after the close transition finishes; unmount the modal here. */
  readonly onClose: () => void;
}

// --- Component ---

/**
 * Renders the end-phase dialog and reports the caught species upwards.
 *
 * Initial focus sits on the first phase-target chip so the common case (one of
 * the preselected species) is a single keypress away; without targets the
 * search field takes the focus instead. Both are marked with `data-autofocus`,
 * which ModalShell honours after showModal() has run its own focusing steps.
 */
export function EndPhaseModal({
  parent,
  phaseNumber,
  encounters,
  timerMs,
  onSubmit,
  onClose,
}: EndPhaseModalProps) {
  const { t } = useI18n();
  const { allPokemon, games } = usePokedex();
  const targetsLabelId = useId();

  const [selection, setSelection] = useState<PhaseCatchData | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const targets = parent.phase_targets ?? [];
  const hasTargets = targets.length > 0;
  // Everything but the species itself is inherited from the parent hunt.
  const spriteStyle = parent.sprite_style || "box";
  const language = parent.language || "en";

  // --- Selection ---

  const pickTarget = (target: PhaseTarget) => {
    setSelection({
      canonical_name: target.canonical_name,
      name: target.name,
      sprite_url: target.sprite_url,
    });
  };

  const pickSearchResult = (entry: SearchResult) => {
    setSelection({
      canonical_name: entry.canonical,
      name: getPkmnName(entry, language),
      base_name: entry.baseName || undefined,
      form_name: entry.formName || undefined,
      sprite_url: getSpriteUrl(
        entry.spriteId.toString(),
        parent.game,
        "shiny",
        spriteStyle,
        entry.canonical,
        entry.spriteSlug,
        entry.baseCanonical,
      ),
    });
  };

  const handleConfirm = async (requestClose: () => void) => {
    if (!selection || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(selection);
      requestClose();
    } catch {
      // Keep the dialog open so the pick survives a failed request; the caller
      // owns the error message.
    } finally {
      setSubmitting(false);
    }
  };

  // --- Render ---

  const footer = (requestClose: () => void) => (
    <div className="flex gap-3">
      <button
        type="button"
        onClick={requestClose}
        className="flex-1 px-4 py-2 rounded-none border border-border-subtle text-text-muted hover:text-text-primary hover:border-text-muted transition-colors text-sm whitespace-nowrap"
      >
        {t("common.cancel")}
      </button>
      <button
        type="button"
        onClick={() => void handleConfirm(requestClose)}
        disabled={!selection || submitting}
        className="flex-1 px-4 py-2 t-cut rounded-none font-semibold text-sm transition-colors shadow-sm whitespace-nowrap bg-accent-blue hover:bg-accent-blue/80 text-bg-primary disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {t("phase.confirm")}
      </button>
    </div>
  );

  return (
    <ModalShell title={t("phase.endTitle")} onClose={onClose} size="md" footer={footer}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-muted tabular-nums">
          {t("phase.summary", {
            number: phaseNumber,
            encounters,
            duration: formatTimer(timerMs),
          })}
        </p>

        {hasTargets && (
          <div className="flex flex-col gap-1.5">
            <span id={targetsLabelId} className="text-xs text-text-muted">
              {t("phase.targetsTitle")}
            </span>
            <div
              role="group"
              aria-labelledby={targetsLabelId}
              className="flex flex-wrap gap-1.5"
            >
              {targets.map((target, index) => (
                <TargetChip
                  key={target.canonical_name || target.name}
                  initialFocus={index === 0}
                  target={target}
                  active={selection?.canonical_name === target.canonical_name}
                  onSelect={() => pickTarget(target)}
                />
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5 border-t border-border-subtle pt-4">
          <span className="text-xs text-text-muted">{t("phase.otherSpecies")}</span>
          <PokemonSearchPicker
            allPokemon={allPokemon}
            games={games}
            selectedGame={parent.game}
            language={language}
            placeholder={t("phase.searchPlaceholder")}
            inputLabel={t("aria.phaseSearch")}
            selectedCanonical={selection?.canonical_name}
            autoFocus={!hasTargets}
            onPick={pickSearchResult}
          />
        </div>
      </div>
    </ModalShell>
  );
}

// --- Target chip ---

interface TargetChipProps {
  readonly target: PhaseTarget;
  readonly active: boolean;
  readonly onSelect: () => void;
  /** Marks this chip as the element ModalShell focuses after showModal(). */
  readonly initialFocus?: boolean;
}

/**
 * One preselected phase target as a toggle button with its shiny sprite.
 *
 * A plain button, not a chip wrapper with nested controls: the end-phase list
 * is select-only, so there is no remove action that would have to sit beside
 * the label (see TagChip for that pattern).
 */
function TargetChip({ target, active, onSelect, initialFocus }: TargetChipProps) {
  const { t } = useI18n();
  return (
    <button
      data-autofocus={initialFocus ? true : undefined}
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      aria-label={t("aria.phaseSelectTarget", { name: target.name })}
      className={`flex items-center gap-1.5 min-h-[24px] px-2 py-1 rounded-none border text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue ${
        active
          ? "border-accent-blue/40 bg-accent-blue/10 text-accent-blue"
          : "border-border-subtle text-text-muted hover:text-text-primary"
      }`}
    >
      <img
        src={resolveSpriteSrc(target.sprite_url)}
        alt=""
        className="h-6 w-6 object-contain shrink-0"
        onError={(e) => {
          e.currentTarget.src = SPRITE_FALLBACK;
        }}
      />
      <span className="capitalize truncate max-w-[10rem]">{target.name}</span>
    </button>
  );
}
