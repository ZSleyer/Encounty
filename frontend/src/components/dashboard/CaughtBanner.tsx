/**
 * CaughtBanner.tsx: Archive header of a completed or failed entry.
 */

import { Trophy, Undo2, XCircle } from "lucide-react";
import { Pokemon } from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { phaseOriginLabel } from "./phaseHelpers";

/**
 * CaughtBanner is the archive header of a completed entry. For a phase entry it
 * additionally links back to its parent hunt and offers the undo action on the
 * most recent phase.
 */
export function CaughtBanner({
  pokemon,
  parent,
  canUndo,
  onOpenEntry,
  onUndoPhase,
}: Readonly<{
  pokemon: Pokemon;
  parent: Pokemon | null;
  canUndo: boolean;
  onOpenEntry: (target: Pokemon) => void;
  onUndoPhase: (child: Pokemon) => void;
}>) {
  const { t } = useI18n();
  const originLabel = phaseOriginLabel(pokemon, parent?.name, t);
  const failed = !!pokemon.failed;
  return (
    <div
      className={`flex flex-wrap items-center gap-2.5 px-6 py-2 rounded-none text-sm mb-2 border shadow-sm mt-8 ${
        failed
          ? "bg-accent-red/10 text-accent-red border-accent-red/30"
          : "bg-accent-green/10 text-accent-green border-accent-green/30"
      }`}
    >
      {failed ? <XCircle className="w-4 h-4" /> : <Trophy className="w-4 h-4" />}
      <span className="font-bold">{failed ? t("dash.failedBanner") : t("dash.caughtBanner")}</span>
      <span className={`w-px h-3 ${failed ? "bg-accent-red/30" : "bg-accent-green/30"}`} />
      <span
        className={`text-xs font-medium ${failed ? "text-accent-red/80" : "text-accent-green/80"}`}
      >
        {new Date(pokemon.completed_at!).toLocaleDateString("de-DE", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })}
      </span>
      {originLabel && parent && (
        <button
          type="button"
          onClick={() => onOpenEntry(parent)}
          aria-label={t("aria.phaseGoToParent", { name: parent.name })}
          className="t-label min-h-6 px-1.5 gap-1 hover:text-accent-blue transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
        >
          {originLabel}
        </button>
      )}
      {originLabel && !parent && <span className="t-label px-1.5">{originLabel}</span>}
      {canUndo && (
        <button
          type="button"
          onClick={() => onUndoPhase(pokemon)}
          title={t("phase.undo")}
          aria-label={t("phase.undo")}
          className="min-h-6 flex items-center gap-1 px-1.5 rounded-none text-text-muted hover:text-accent-red transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
        >
          <Undo2 className="w-3.5 h-3.5" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em]">
            {t("phase.undo")}
          </span>
        </button>
      )}
    </div>
  );
}
