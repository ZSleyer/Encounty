/**
 * AngleDial.tsx: round direction dial with a draggable handle plus a
 * numeric field, the control Photoshop and Photopea use for gradient
 * direction.
 *
 * Degree convention: CSS `linear-gradient` degrees. 0 points up (the
 * gradient runs upward), values grow clockwise, so 90 points right and
 * 180 points down. Every angle that enters or leaves this component uses
 * that convention, and the dial is drawn so the handle sits where the
 * gradient is heading.
 */
import { useCallback, useId, useRef, useState, type JSX } from "react";
import { useI18n } from "../../../contexts/I18nContext";

export interface AngleDialProps {
  /** Current angle in CSS degrees, where 0 points up and values increase clockwise. */
  readonly value: number;
  /** Visible label, already translated. */
  readonly label: string;
  readonly onChange: (angle: number) => void;
  /** Snap increment in degrees while dragging without a modifier. Defaults to 1. */
  readonly step?: number;
}

// --- Constants ---

/** Highest angle the control reports. 360 wraps back to 0, so 359 is the maximum. */
const MAX_ANGLE = 359;

/** Snap increment while Shift is held, both for dragging and for arrow keys. */
const SHIFT_STEP = 15;

/** Increment for PageUp / PageDown. */
const PAGE_STEP = 45;

/** Distance of the handle centre from the dial centre, as a share of the dial size. */
const HANDLE_INSET = "14%";

/** Tick marks drawn on the dial rim as orientation cues (up, right, down, left). */
const TICKS = [0, 90, 180, 270];

// --- Pure helpers ---

/**
 * Wraps any angle into 0 to 359 inclusive instead of clamping it, so 370
 * becomes 10 and -30 becomes 330. Non-finite input falls back to 0.
 */
function normalizeAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  return ((Math.round(angle) % 360) + 360) % 360;
}

/**
 * Maps a keyboard key to its angle delta, or null when the key is not one
 * the dial handles. `stepSize` is the caller's step, already adjusted for
 * the Shift modifier.
 */
function keyDelta(key: string, stepSize: number): number | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return stepSize;
    case "ArrowLeft":
    case "ArrowDown":
      return -stepSize;
    case "PageUp":
      return PAGE_STEP;
    case "PageDown":
      return -PAGE_STEP;
    default:
      return null;
  }
}

// --- Component ---

/**
 * Round angle picker with a draggable handle, arrow-key support and a
 * numeric input. Pointer events drive the drag, so mouse, pen and touch
 * all work and a drag that leaves the dial keeps tracking.
 */
export function AngleDial({
  value,
  label,
  onChange,
  step = 1,
}: Readonly<AngleDialProps>): JSX.Element {
  const { t } = useI18n();
  const labelId = useId();
  const dialRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  // Holds the raw text while the user types, so a half-typed "37" on its way
  // to "370" is not rewritten under the caret. Null means "mirror `value`".
  const [draft, setDraft] = useState<string | null>(null);

  const angle = normalizeAngle(value);
  const baseStep = step > 0 ? step : 1;

  const commit = useCallback((next: number) => onChange(normalizeAngle(next)), [onChange]);

  // --- Pointer drag ---

  const applyPointer = useCallback(
    (clientX: number, clientY: number, shiftKey: boolean) => {
      const el = dialRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const dx = clientX - (rect.left + rect.width / 2);
      const dy = clientY - (rect.top + rect.height / 2);
      // Dead centre has no direction, so keep the previous angle.
      if (dx === 0 && dy === 0) return;
      // atan2(dx, -dy) yields 0 for straight up and grows clockwise because
      // screen Y grows downward. That is exactly the CSS gradient convention.
      const raw = (Math.atan2(dx, -dy) * 180) / Math.PI;
      const snap = shiftKey ? SHIFT_STEP : baseStep;
      commit(Math.round(raw / snap) * snap);
    },
    [baseStep, commit],
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    // jsdom and older engines lack pointer capture; the drag still works
    // inside the dial without it.
    if (typeof el.setPointerCapture === "function") el.setPointerCapture(e.pointerId);
    setDragging(true);
    applyPointer(e.clientX, e.clientY, e.shiftKey);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    applyPointer(e.clientX, e.clientY, e.shiftKey);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (typeof el.releasePointerCapture === "function" && el.hasPointerCapture?.(e.pointerId)) {
      el.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
  };

  // --- Keyboard ---

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Home") {
      e.preventDefault();
      commit(0);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      commit(MAX_ANGLE);
      return;
    }
    const delta = keyDelta(e.key, e.shiftKey ? SHIFT_STEP : baseStep);
    if (delta === null) return;
    e.preventDefault();
    commit(angle + delta);
  };

  // --- Numeric input ---

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setDraft(raw);
    if (raw.trim() === "") return;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) onChange(normalizeAngle(parsed));
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") setDraft(null);
  };

  return (
    <div className="flex flex-col gap-1">
      <span id={labelId} className="text-[10px] 2xl:text-xs text-text-muted">
        {label}
      </span>

      <div className="flex items-center gap-3">
        {/* --- Dial --- */}
        <div
          ref={dialRef}
          role="slider"
          tabIndex={0}
          aria-labelledby={labelId}
          aria-valuenow={angle}
          aria-valuemin={0}
          aria-valuemax={MAX_ANGLE}
          aria-valuetext={t("aria.angleDegrees", { value: angle })}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={handleKeyDown}
          className={`relative w-16 h-16 2xl:w-20 2xl:h-20 shrink-0 rounded-full border bg-bg-primary
            cursor-grab touch-none select-none transition-colors
            focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-blue
            ${dragging ? "cursor-grabbing border-accent-blue" : "border-border-subtle"}`}
        >
          {/* Rim ticks at 0, 90, 180 and 270 degrees. */}
          {TICKS.map((tick) => (
            <span
              key={tick}
              aria-hidden="true"
              className="absolute inset-0"
              style={{ transform: `rotate(${tick}deg)` }}
            >
              <span className="absolute left-1/2 top-[6%] h-[8%] w-px -translate-x-1/2 bg-border-subtle" />
            </span>
          ))}

          {/* Rotating layer: at 0 degrees the line points straight up, and a
              positive CSS rotation turns clockwise, so 90 points right. */}
          <span
            aria-hidden="true"
            className={`absolute inset-0 motion-reduce:transition-none ${
              dragging ? "" : "transition-transform duration-100"
            }`}
            style={{ transform: `rotate(${angle}deg)` }}
          >
            <span
              className="absolute left-1/2 bottom-1/2 w-px -translate-x-1/2 bg-accent-blue"
              style={{ top: HANDLE_INSET }}
            />
            <span
              className="absolute left-1/2 w-2.5 h-2.5 rounded-full bg-accent-blue -translate-x-1/2 -translate-y-1/2"
              style={{ top: HANDLE_INSET }}
            />
          </span>

          {/* Centre pivot. */}
          <span
            aria-hidden="true"
            className="absolute left-1/2 top-1/2 w-1 h-1 rounded-full bg-border-subtle -translate-x-1/2 -translate-y-1/2"
          />
        </div>

        {/* --- Numeric field --- */}
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={draft ?? String(angle)}
            step={baseStep}
            aria-label={t("aria.angleInput")}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            onBlur={() => setDraft(null)}
            className="w-14 min-h-6 bg-bg-primary border border-border-subtle rounded-none px-1.5 py-0.5
              text-[10px] 2xl:text-xs text-text-primary text-center outline-none
              [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span aria-hidden="true" className="text-[10px] 2xl:text-xs text-text-muted">
            °
          </span>
        </div>
      </div>
    </div>
  );
}
