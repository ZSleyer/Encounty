/**
 * Toggle, pill-shaped on/off switch.
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
  /**
   * DOM id of the switch. A `<button>` is a labelable element, so a sibling
   * `<label htmlFor>` both names the switch and stays a click target for it.
   */
  readonly id?: string;
  /** Id of an element describing the switch, wired up as aria-describedby. */
  readonly describedBy?: string;
}

export function Toggle({
  enabled,
  onChange,
  label,
  color = "bg-accent-blue/80",
  id,
  describedBy,
}: ToggleProps) {
  return (
    <button
      // Explicit type: the switch is used inside forms, where a bare <button>
      // would default to submit and save the surrounding form on every toggle.
      type="button"
      id={id}
      onClick={onChange}
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      aria-describedby={describedBy}
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
