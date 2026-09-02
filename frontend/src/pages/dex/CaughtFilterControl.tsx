/**
 * CaughtFilterControl.tsx: the caught-state radio group of the Pokédex toolbar.
 */
import { useI18n } from "../../contexts/I18nContext";
import type { CaughtFilter } from "./types";

/** Caught-state options in display order, from fully done to never encountered. */
const CAUGHT_FILTERS: { value: CaughtFilter; key: string }[] = [
  { value: "all", key: "dex.filterAll" },
  { value: "caught", key: "dex.filterCaught" },
  { value: "seen", key: "dex.filterSeen" },
  { value: "missing", key: "dex.filterMissing" },
];

interface CaughtFilterControlProps {
  readonly value: CaughtFilter;
  readonly onChange: (value: CaughtFilter) => void;
}

/**
 * Caught-state control as a real radio group: one tab stop, arrow keys move
 * and select. The group is named after the state it filters on, which is the
 * only thing all options have in common.
 */
export function CaughtFilterControl({ value, onChange }: CaughtFilterControlProps) {
  const { t } = useI18n();

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const current = CAUGHT_FILTERS.findIndex((option) => option.value === value);
    const next = (current + step + CAUGHT_FILTERS.length) % CAUGHT_FILTERS.length;
    onChange(CAUGHT_FILTERS[next].value);
  };

  return (
    <div
      role="radiogroup"
      aria-label={t("dex.caught")}
      onKeyDown={handleKeyDown}
      className="flex flex-wrap items-center gap-1.5"
    >
      {CAUGHT_FILTERS.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={`t-label min-h-[24px] px-2 transition-colors ${
              active ? "t-label--accent" : "hover:text-text-primary"
            }`}
          >
            {t(option.key)}
          </button>
        );
      })}
    </div>
  );
}
