/**
 * Toggle, pill-shaped on/off switch.
 *
 * Fully round, while the rest of the UI follows the radius scale: its
 * silhouette alone reads as "independent on/off state", not a member of a
 * mutually-exclusive button group, so it stays visually unmistakable from
 * `aria-pressed` mode buttons and radio groups.
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
        enabled ? color : "bg-bg-hover border border-border-input"
      }`}
    >
      <div
        // The knob's position is the state indicator, so its edge needs 3:1
        // against the track (WCAG 1.4.11). A shadow alone does not carry that
        // on the light off-track, where white on bg-hover is about 1.2:1.
        className={`w-4 h-4 bg-white border border-border-input rounded-full transition-transform ${enabled ? "translate-x-6" : "translate-x-0"}`}
      />
    </button>
  );
}
