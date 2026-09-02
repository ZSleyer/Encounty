/**
 * Animation controls of the overlay property panel: one labeled `<select>` per
 * channel, and the fieldset that collects an element's continuous and one-shot
 * rows under a single heading.
 */
import { Play, RotateCcw } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import type { ElementKey } from "../../utils/overlayElements";
import { SELECT_CLASS } from "./panelStyles";
import type { AnimationOption } from "./propertyPanelTypes";

/**
 * Labeled animation select. The two one-shot rows also carry a test button that
 * plays the animation once, forward for an encounter and backwards for a
 * correction.
 */
function AnimationRow({
  id,
  label,
  value,
  options,
  test,
  onChange,
  onTest,
}: Readonly<{
  id: string;
  label: string;
  value: string;
  options: readonly AnimationOption[];
  /** Omitted for the continuous row, which has nothing to fire once. */
  test?: "play" | "rewind";
  onChange: (value: string) => void;
  onTest?: () => void;
}>) {
  const { t } = useI18n();
  const buttonClass =
    test === "rewind"
      ? "bg-accent-red/15 hover:bg-accent-red/40 text-accent-red"
      : "bg-accent-blue/20 hover:bg-accent-blue/40 text-accent-blue";
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-0.5 min-h-6">
        <label htmlFor={id} className="text-xs text-text-muted">
          {label}
        </label>
        {test && (
          <button
            type="button"
            onClick={onTest}
            aria-label={t("aria.testAnimation", { name: label })}
            className={`flex items-center gap-1 px-2 py-1 rounded-none text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue ${buttonClass}`}
          >
            {test === "rewind" ? (
              <RotateCcw className="w-2.5 h-2.5 2xl:w-3 2xl:h-3" aria-hidden="true" />
            ) : (
              <Play className="w-2.5 h-2.5 2xl:w-3 2xl:h-3" aria-hidden="true" />
            )}{" "}
            Test
          </button>
        )}
      </div>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={SELECT_CLASS}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * fireTestFor binds the test callback to one element. The forward run passes
 * only the element key, the backwards run adds the reverse flag.
 */
export function fireTestFor(
  fireTest: (element: ElementKey, reverse?: boolean) => void,
  key: ElementKey,
): (reverse?: boolean) => void {
  return (reverse) => (reverse ? fireTest(key, true) : fireTest(key));
}

/** One animation channel: current value, the options offered and its setter. */
export interface AnimationChannel {
  readonly value: string;
  readonly options: readonly AnimationOption[];
  readonly onChange: (value: string) => void;
}

/**
 * AnimationGroup collects the animation rows of one element under a single
 * heading. Without the shared heading the renamed rows ("Always running", "On
 * encounter") would read as three unrelated settings.
 */
export function AnimationGroup({
  idPrefix,
  idle,
  trigger,
  decrement,
  onTest,
}: Readonly<{
  /** Element key the row ids are derived from, so they stay unique per layer. */
  idPrefix: string;
  idle: AnimationChannel;
  /** Omitted for elements that tick on their own, such as the timers. */
  trigger?: AnimationChannel;
  decrement?: AnimationChannel;
  onTest: (reverse?: boolean) => void;
}>) {
  const { t } = useI18n();
  return (
    <fieldset className="border border-border-subtle rounded-none px-2.5 pb-2.5 space-y-2">
      <legend className="px-1 text-xs 2xl:text-sm text-text-secondary">
        {t("overlay.animationGroup")}
      </legend>
      <AnimationRow
        id={`${idPrefix}-idle-animation`}
        label={t("overlay.idleAnimation")}
        value={idle.value}
        options={idle.options}
        onChange={idle.onChange}
      />
      {trigger && (
        <AnimationRow
          id={`${idPrefix}-trigger-animation`}
          label={t("overlay.triggerAnimation")}
          value={trigger.value}
          options={trigger.options}
          test="play"
          onChange={trigger.onChange}
          onTest={() => onTest()}
        />
      )}
      {decrement && (
        <AnimationRow
          id={`${idPrefix}-trigger-decrement-animation`}
          label={t("overlay.triggerAnimationDecrement")}
          value={decrement.value}
          options={decrement.options}
          test="rewind"
          onChange={decrement.onChange}
          onTest={() => onTest(true)}
        />
      )}
    </fieldset>
  );
}
