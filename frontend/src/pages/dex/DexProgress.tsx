/**
 * DexProgress.tsx: the completion header of the Pokédex page.
 */
import { useI18n } from "../../contexts/I18nContext";

interface DexProgressProps {
  readonly caught: number;
  readonly total: number;
}

/**
 * Completion header. The count line is the only live region on the page: the
 * filtered result count deliberately stays out of it, otherwise every
 * keystroke in the search field would queue an announcement.
 */
export function DexProgress({ caught, total }: DexProgressProps) {
  const { t } = useI18n();
  const summary = t("dex.caughtOf", { caught, total });
  const percent = total > 0 ? Math.round((caught / total) * 100) : 0;

  return (
    <div className="t-panel flex flex-col gap-3 p-4">
      <h1 className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
        {t("dex.title")}
      </h1>
      <div aria-live="polite" aria-atomic="true" className="flex flex-col gap-1">
        {/* Hidden from the announcement: the sentence below already spells the
            same number out in words. */}
        <span
          aria-hidden="true"
          className="font-mono leading-none tabular-nums text-text-primary"
          style={{ fontSize: "clamp(28px, 4vw, 48px)" }}
        >
          {caught}
        </span>
        <span className="text-xs text-text-muted">{summary}</span>
      </div>
      <div className="h-1 w-full bg-border-subtle">
        <div
          role="progressbar"
          aria-label={t("aria.dexProgress")}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={caught}
          aria-valuetext={summary}
          style={{ width: `${percent}%` }}
          className="h-full bg-accent-green transition-[width] duration-300"
        />
      </div>
    </div>
  );
}
