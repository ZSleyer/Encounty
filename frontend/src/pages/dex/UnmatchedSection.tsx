/**
 * UnmatchedSection.tsx: the catches the Pokédex could not resolve onto a slot.
 */
import { useId } from "react";
import { useI18n } from "../../contexts/I18nContext";
import type { Pokemon } from "../../types";
import { pokemonDisplayName } from "../../utils/pokemon";

interface UnmatchedSectionProps {
  readonly entries: Pokemon[];
}

/** Completed catches that resolve onto no species slot. Never hidden. */
export function UnmatchedSection({ entries }: UnmatchedSectionProps) {
  const { t } = useI18n();
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="t-panel flex flex-col gap-2 p-4">
      <h2
        id={headingId}
        className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary"
      >
        {t("dex.unmatched")}
      </h2>
      <p className="text-xs text-text-muted">{t("dex.unmatchedHint")}</p>
      <ul role="list" className="flex flex-col gap-1">
        {entries.map((entry) => (
          <li key={entry.id} className="flex items-center gap-2 text-sm text-text-secondary">
            <span className="truncate">{pokemonDisplayName(entry)}</span>
            <span className="t-label shrink-0">{entry.canonical_name || "?"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
