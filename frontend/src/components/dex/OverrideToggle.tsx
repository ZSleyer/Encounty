/**
 * OverrideToggle.tsx: the caught/seen switch of the Pokédex override modal.
 */
interface OverrideToggleProps {
  readonly label: string;
  readonly ariaLabel: string;
  readonly pressed: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}

/** One independent caught/seen toggle button, mirroring the dex mode switch. */
export function OverrideToggle({
  label,
  ariaLabel,
  pressed,
  disabled,
  onClick,
}: OverrideToggleProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={`min-h-[32px] flex-1 rounded-none border px-3 py-1.5 text-xs font-medium uppercase tracking-[0.18em] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        pressed
          ? "border-accent-blue/50 bg-accent-blue/10 text-accent-blue"
          : "border-border-subtle text-text-muted hover:text-text-primary"
      }`}
    >
      {label}
    </button>
  );
}
