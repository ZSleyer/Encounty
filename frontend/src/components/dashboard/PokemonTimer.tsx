/**
 * PokemonTimer.tsx: Timer readout and controls in the counter panel header.
 */

import { useState } from "react";
import { Play, RotateCcw, Square } from "lucide-react";
import { Pokemon } from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { useSecondTick } from "../../hooks/useSecondTick";
import { computeTimerMs, formatTimer } from "../../utils/timer";
import { ConfirmModal } from "../shared/ConfirmModal";
import { SetTimerModal } from "../shared/SetTimerModal";

/** PokemonTimer renders a compact monospace timer with play/pause/reset controls for the hero panel header. */
export function PokemonTimer({
  pokemon,
  send,
  disabled = false,
  timerStartBlocked = false,
}: Readonly<{
  pokemon: Pokemon;
  send: (type: string, payload: unknown) => void;
  disabled?: boolean;
  timerStartBlocked?: boolean;
}>) {
  const { t } = useI18n();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const isRunning = !!pokemon.timer_started_at;
  const timeText = formatTimer(computeTimerMs(pokemon));

  useSecondTick(isRunning);

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => setEditOpen(true)}
        className="text-sm font-mono tabular-nums text-text-primary hover:text-accent-blue transition-colors cursor-pointer px-1"
        title={t("timer.editTitle")}
        aria-label={`${t("aria.timerEdit")}: ${timeText}`}
      >
        {timeText}
      </button>
      <div className="flex gap-0.5">
        {isRunning ? (
          <button
            onClick={() => send("timer_stop", { pokemon_id: pokemon.id })}
            className="p-1.5 rounded-none text-accent-yellow hover:bg-bg-hover transition-colors"
            title={t("timer.stop")}
            aria-label={t("aria.timerPause")}
          >
            <Square className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            onClick={() => send("timer_start", { pokemon_id: pokemon.id })}
            disabled={disabled || timerStartBlocked}
            className="p-1.5 rounded-none text-accent-blue hover:bg-bg-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={timerStartBlocked ? t("detector.errNoSource") : t("timer.start")}
            aria-label={t("aria.timerStart")}
          >
            <Play className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={() => setConfirmResetOpen(true)}
          disabled={disabled}
          className="p-1.5 rounded-none text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title={t("timer.reset")}
          aria-label={t("aria.timerReset")}
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>
      {editOpen && (
        <SetTimerModal
          currentMs={computeTimerMs(pokemon)}
          onSave={(ms) => send("timer_set", { pokemon_id: pokemon.id, ms })}
          onClose={() => setEditOpen(false)}
        />
      )}
      {confirmResetOpen && (
        <ConfirmModal
          title={t("confirm.timerResetTitle")}
          message={t("confirm.timerResetMsg")}
          isDestructive
          onConfirm={() => send("timer_reset", { pokemon_id: pokemon.id })}
          onClose={() => setConfirmResetOpen(false)}
        />
      )}
    </div>
  );
}
