/**
 * PhaseHistory.tsx: List of the finished phases of a hunt.
 */

import { Pokemon } from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { formatTimer } from "../../utils/timer";
import { resolveSpriteSrc } from "../../utils/sprites";
import { FreezableSprite } from "../shared/FreezableSprite";
import { resolveSpriteUrl } from "./presentation";

/**
 * PhaseHistory lists the finished phases of a hunt. Each row is a real button
 * that opens the phase entry in the main panel.
 */
export function PhaseHistory({
  entries,
  imgError,
  onImgError,
  onOpenEntry,
}: Readonly<{
  entries: Pokemon[];
  imgError: Record<string, string>;
  onImgError: (id: string, src: string) => void;
  onOpenEntry: (target: Pokemon) => void;
}>) {
  const { t } = useI18n();
  return (
    <section
      className="t-panel p-4 mt-3"
      style={{ width: "min(100%, clamp(420px, 40vw, 620px))" }}
      aria-label={t("phase.historyTitle")}
    >
      <span className="t-label">{t("phase.historyTitle")}</span>
      <ul className="flex flex-col gap-0.5 mt-2">
        {entries.map((entry) => {
          const number = entry.phase_number ?? 0;
          return (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => onOpenEntry(entry)}
                aria-label={t("aria.phaseHistoryEntry", { number, name: entry.name })}
                className="w-full min-h-8 flex items-center gap-2 px-2 py-1 rounded-none text-left hover:bg-bg-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
              >
                <FreezableSprite
                  src={resolveSpriteUrl(entry.id, entry.sprite_url, imgError)}
                  alt={entry.name}
                  decorative
                  onError={() => onImgError(entry.id, resolveSpriteSrc(entry.sprite_url))}
                  className="pokemon-sprite w-6 h-6 shrink-0 object-contain"
                />
                <span className="t-label shrink-0">{t("phase.short", { number })}</span>
                <span className="flex-1 min-w-0 truncate text-xs text-text-primary capitalize">
                  {entry.name}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-text-secondary">
                  {entry.encounters}
                </span>
                <span className="shrink-0 text-xs font-mono tabular-nums text-text-muted">
                  {formatTimer(entry.timer_accumulated_ms ?? 0)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
