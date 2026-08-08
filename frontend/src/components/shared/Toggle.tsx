/**
 * Toggle — pill-shaped on/off switch.
 *
 * The one deliberate round shape in an otherwise square-cornered design
 * (see design-system): its silhouette alone reads as "independent on/off
 * state", not a member of a mutually-exclusive button group, so it stays
 * visually unmistakable from `aria-pressed` mode buttons and radio groups.
 */
interface ToggleProps {
  readonly enabled: boolean;
  readonly onChange: () => void;
  readonly label?: string;
  readonly color?: string;
}

export function Toggle({ enabled, onChange, label, color = "bg-accent-blue/80" }: ToggleProps) {
  return (
    <button
      onClick={onChange}
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      className={`relative w-12 h-6 2xl:w-14 2xl:h-7 rounded-full transition-colors flex items-center px-1 shrink-0 ${
        enabled ? color : "bg-bg-secondary border border-border-subtle"
      }`}
    >
      <div
        className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${enabled ? "translate-x-6" : "translate-x-0"}`}
      />
    </button>
  );
}
