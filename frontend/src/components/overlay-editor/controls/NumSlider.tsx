/** Numeric input with +/- buttons and an optional labeled slider variant. */

import { useI18n } from "../../../contexts/I18nContext";

/** Compact numeric input with decrement/increment buttons. */
export function NumInput({
  value,
  min,
  max,
  step = 1,
  onChange,
  className,
  ariaLabel,
}: Readonly<{
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  className?: string;
  ariaLabel?: string;
}>) {
  const { t } = useI18n();
  const clamp = (v: number) => {
    let n = v;
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    return n;
  };
  return (
    <div
      className={`flex items-center border border-border-subtle rounded overflow-hidden bg-bg-primary ${className ?? ""}`}
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
        aria-label={ariaLabel ?? `${value}`}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 min-w-6 min-h-6 bg-transparent text-[10px] 2xl:text-xs text-text-primary text-center outline-none py-0.5 2xl:py-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
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
}: Readonly<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}>) {
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <label className="text-[10px] 2xl:text-xs text-text-muted">{label}</label>
        <NumInput
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={onChange}
          ariaLabel={label}
          className="w-20 2xl:w-24"
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
