/**
 * GenerationChips.tsx: the generation filter of the Pokédex toolbar.
 */
import { useI18n } from "../../contexts/I18nContext";

interface GenerationChipsProps {
  readonly generations: number[];
  readonly selected: ReadonlySet<number>;
  readonly onToggle: (generation: number) => void;
}

/** Multi-select generation chips; an empty selection means "every generation". */
export function GenerationChips({ generations, selected, onToggle }: GenerationChipsProps) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {generations.map((generation) => {
        const active = selected.has(generation);
        return (
          <button
            key={generation}
            type="button"
            aria-pressed={active}
            aria-label={t("dex.generation", { n: generation })}
            onClick={() => onToggle(generation)}
            // Single digits would fall short of the 24x24 minimum target
            // size (WCAG 2.5.8) without the explicit width.
            className={`t-label min-h-[24px] min-w-[28px] justify-center px-2 transition-colors ${
              active ? "t-label--accent" : "hover:text-text-primary"
            }`}
          >
            {generation}
          </button>
        );
      })}
    </div>
  );
}
