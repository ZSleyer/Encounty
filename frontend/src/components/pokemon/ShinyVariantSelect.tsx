/**
 * ShinyVariantSelect.tsx: Three-way picker for the Sword/Shield shiny variant
 * (any, star sparkles, square sparkles). Used by the hunt form, the catch
 * details and the Pokedex filter, which all need the same three states.
 */
import { useI18n } from "../../contexts/I18nContext";
import type { ShinyVariant } from "../../types";

/** Selectable values in display order. The empty string is the "any" state. */
const VARIANT_OPTIONS: ("" | ShinyVariant)[] = ["", "star", "square"];

interface ShinyVariantSelectProps {
  readonly value: "" | ShinyVariant;
  readonly onChange: (value: "" | ShinyVariant) => void;
  /** Accessible name of the group, e.g. t("aria.shinyVariant"). */
  readonly ariaLabel: string;
  /** Label of the "any" option. Defaults to the neutral hunt-form wording. */
  readonly anyLabelKey?: string;
}

/**
 * Radio group for the shiny variant. One tab stop, arrow keys move and select,
 * mirroring the Pokedex filter controls.
 */
export function ShinyVariantSelect({
  value,
  onChange,
  ariaLabel,
  anyLabelKey = "shinyVariant.any",
}: ShinyVariantSelectProps) {
  const { t } = useI18n();

  const labelFor = (option: "" | ShinyVariant) =>
    option === "" ? t(anyLabelKey) : t(`shinyVariant.${option}`);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const current = VARIANT_OPTIONS.indexOf(value);
    const next = (current + step + VARIANT_OPTIONS.length) % VARIANT_OPTIONS.length;
    onChange(VARIANT_OPTIONS[next]);
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className="flex flex-wrap items-center gap-1.5"
    >
      {VARIANT_OPTIONS.map((option) => {
        const active = option === value;
        return (
          <button
            key={option || "any"}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option)}
            className={`t-label min-h-[24px] px-2 transition-colors ${
              active ? "t-label--accent" : "hover:text-text-primary"
            }`}
          >
            {labelFor(option)}
          </button>
        );
      })}
    </div>
  );
}
