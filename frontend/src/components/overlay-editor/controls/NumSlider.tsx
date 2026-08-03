/** Numeric input with +/- buttons and an optional labeled slider variant. */

import { useI18n } from "../../../contexts/I18nContext";

/** Compact numeric input with decrement/increment buttons and an optional unit. */
export function NumInput({
  value,
  min,
  max,
  step = 1,
  onChange,
  className,
  ariaLabel,
  unit,
}: Readonly<{
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  className?: string;
  ariaLabel?: string;
  /** Unit shown after the number, e.g. "px" or "%". Also joins the accessible name. */
  unit?: string;
}>) {
  const { t } = useI18n();
  // The unit is visible next to the number, so it has to travel with the
  // accessible name as well, otherwise a screen reader hears a bare figure.
  const baseName = ariaLabel ?? `${value}`;
  const accessibleName = unit ? `${baseName} (${unit})` : baseName;
  const clamp = (v: number) => {
    let n = v;
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    return n;
  };
  return (
    <div
      className={`flex items-center border border-border-subtle rounded-none overflow-hidden bg-bg-primary ${className ?? ""}`}
    >
      <button
        type="button"
        title={t("tooltip.common.decrement")}
        onClick={() => onChange(clamp(value - step))}
        className="px-2.5 self-stretch flex items-center text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors text-sm leading-none shrink-0"
      >
        −
      </button>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        aria-label={accessibleName}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 min-w-6 min-h-6 bg-transparent text-[10px] 2xl:text-xs text-text-primary text-center outline-none py-0.5 2xl:py-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      {unit && (
        <span className="pr-1 shrink-0 select-none text-[10px] 2xl:text-xs text-text-muted leading-none">
          {unit}
        </span>
      )}
      <button
        type="button"
        title={t("tooltip.common.increment")}
        onClick={() => onChange(clamp(value + step))}
        className="px-2.5 self-stretch flex items-center text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors text-sm leading-none shrink-0"
      >
        +
      </button>
    </div>
  );
}

/** Labeled slider with an inline NumInput for precise value entry. */
export function NumSlider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  unit,
}: Readonly<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  /** Unit shown after the number, e.g. "px" or "%". */
  unit?: string;
}>) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <label className="text-[10px] 2xl:text-xs text-text-muted">{label}</label>
        <NumInput
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={onChange}
          ariaLabel={label}
          unit={unit}
          className="w-20 2xl:w-24 shrink-0"
        />
      </div>
      <input
        type="range"
        title={label}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1 accent-accent-blue cursor-pointer"
      />
    </div>
  );
}

/**
 * PercentSlider shows a stored 0..1 fraction the way an image editor does, as
 * whole percent. Only the presentation changes: onChange still reports the
 * fraction, so the value written to the overlay settings stays untouched.
 */
export function PercentSlider({
  label,
  value,
  onChange,
  step = 5,
}: Readonly<{
  label: string;
  /** Stored fraction between 0 and 1. */
  value: number;
  onChange: (v: number) => void;
  /** Slider step in percent points. */
  step?: number;
}>) {
  return (
    <NumSlider
      label={label}
      unit="%"
      value={Math.round(value * 100)}
      min={0}
      max={100}
      step={step}
      onChange={(percent) => onChange(Math.min(1, Math.max(0, percent / 100)))}
    />
  );
}
