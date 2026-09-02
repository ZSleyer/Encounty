/**
 * NoPokemonPanel.tsx: Empty state of the right main panel.
 *
 * Rendered when neither a single Pokemon nor a group is being viewed. Besides
 * the hint text it offers a shortcut into the synthetic "ungrouped" overview,
 * which the caller suppresses when that bucket would be empty.
 */

import { LayoutGrid, Sparkles } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";

/** Renders the right main panel when no Pokemon is selected. */
export function NoPokemonPanel({
  hasUngrouped,
  onShowOverview,
}: Readonly<{
  /** Whether the shortcut into the ungrouped overview is offered. */
  hasUngrouped: boolean;
  /** Opens the ungrouped overview. */
  onShowOverview: () => void;
}>) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center h-full text-center relative z-10 w-full max-w-4xl mx-auto">
      <Sparkles className="w-8 h-8 text-text-faint mb-6" />
      <h2 className="text-2xl font-semibold text-text-primary mb-2">{t("dash.noActive")}</h2>
      <p className="text-text-muted text-sm max-w-xs">{t("dash.noActiveHint")}</p>
      {hasUngrouped && (
        <p className="flex items-center flex-wrap justify-center gap-x-1.5 gap-y-1 text-text-faint text-xs mt-6">
          {t("dash.overviewHintBefore")}
          <button
            type="button"
            onClick={onShowOverview}
            title={t("group.viewOverview")}
            aria-label={t("group.viewOverview")}
            className="inline-flex items-center justify-center min-w-6 min-h-6 border border-border-subtle text-text-secondary hover:border-accent-blue/50 hover:text-accent-blue transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue align-middle"
          >
            <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          {t("dash.overviewHintAfter")}
        </p>
      )}
    </div>
  );
}
