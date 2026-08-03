/**
 * TutorialOverlay.tsx: shared shell for the step-based walkthroughs.
 *
 * It dims the page, cuts a hole around the element the current step points at,
 * and places a tooltip with the step text next to it. The overlay editor and
 * the auto-detection panel each bring their own step list, so the focus trap,
 * the step announcement and the Escape handling only have to exist once.
 *
 * Steps address their target through a data attribute (`data-tutorial` in the
 * editor, `data-detector-tutorial` in the detector). A step whose target is not
 * in the DOM still renders: the tooltip moves to the centre of the screen and
 * the cutout is dropped, so a walkthrough can never trap the user behind an
 * opaque backdrop with nothing to read.
 *
 * A step may point at something that only exists inside a modal. The host opens
 * that modal from `onStepChange`, and because the app's modals are native
 * `<dialog>`s in the top layer, no z-index can cover them. The shell is
 * therefore a native modal `<dialog>` itself and re-enters the top layer once
 * the step's target turns up inside another open dialog: the last dialog opened
 * paints on top and stays interactive, the one underneath goes inert.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../contexts/I18nContext";
import { useModalA11y } from "../../hooks/useModalA11y";

/** One step of a walkthrough: the element it points at plus its two texts. */
export interface TutorialStep {
  /** Value of the tutorial data attribute carried by the highlighted element. */
  readonly target: string;
  readonly titleKey: string;
  readonly textKey: string;
}

/** Props for {@link TutorialOverlay}. */
export interface TutorialOverlayProps {
  readonly steps: readonly TutorialStep[];
  /** Data attribute the targets carry, for example `data-tutorial`. */
  readonly attribute: string;
  /** i18n prefix of the shell's own labels, for example `editorTutorial`. */
  readonly namespace: string;
  /**
   * Runs before a step is measured. Hosts use it to reveal the step's target,
   * for instance by selecting the layer whose rows the step talks about or by
   * opening the modal the step points into.
   */
  readonly onStepChange?: (index: number) => void;
  /** Called when the walkthrough is finished, skipped or dismissed. */
  readonly onComplete: () => void;
}

/** Gap in px between the highlighted element and the edge of the cutout. */
const PAD = 8;

/**
 * Height in px the tooltip is assumed to take when deciding whether it still
 * fits below the highlight. Overshooting only flips the tooltip above the
 * target one step too early, which is harmless; measuring for real would cost a
 * second render per step.
 */
const TOOLTIP_HEIGHT = 180;

/** Width in px the tooltip is kept away from the right edge of the viewport. */
const TOOLTIP_WIDTH = 340;

/**
 * Frames a step waits for its target to turn up before giving up on it. A step
 * can ask the host to reveal its target first, and that goes through a React
 * state update whose render is scheduled independently of the animation frame,
 * so the element is regularly still missing one or two frames later.
 */
const MEASURE_RETRY_FRAMES = 12;

/**
 * TutorialOverlay renders one walkthrough step at a time: a dimmed backdrop
 * with a cutout around the step's target and a tooltip carrying the text.
 */
export function TutorialOverlay({
  steps,
  attribute,
  namespace,
  onStepChange,
  onComplete,
}: Readonly<TutorialOverlayProps>) {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  // useId embeds colons, which have no place in an SVG fragment reference.
  const uid = useId().replaceAll(":", "");
  const titleId = `${namespace}-title-${uid}`;
  const textId = `${namespace}-text-${uid}`;
  const maskId = `${namespace}-mask-${uid}`;
  // The walkthrough is only mounted while it runs, so it is always "open".
  // showModal() gives the same trap natively, but not in the tests' jsdom, and
  // the hook is what turns Escape into onComplete on both.
  const dialogRef = useModalA11y<HTMLDialogElement>({ isOpen: true, onClose: onComplete });

  // Every host passes an inline arrow, so keeping the callback in a ref stops
  // the measuring effect from re-running on unrelated re-renders of the host.
  const stepChangeRef = useRef(onStepChange);
  stepChangeRef.current = onStepChange;

  const target = steps[step].target;

  const findTarget = useCallback(
    () => document.querySelector(`[${attribute}="${target}"]`),
    [attribute, target],
  );

  /**
   * Enters the top layer, or re-enters it if the shell is already open. Two
   * modal dialogs paint in the order they were opened, so the modal a step
   * opens would otherwise cover the walkthrough that asked for it.
   */
  const raiseToTop = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog?.isConnected) return;
    const focused = document.activeElement as HTMLElement | null;
    if (dialog.open) dialog.close();
    dialog.showModal();
    // showModal() re-runs the dialog focusing steps and would otherwise throw
    // the user back to the first button in the middle of a step.
    if (focused && dialog.contains(focused)) focused.focus();
  }, [dialogRef]);

  useEffect(() => {
    raiseToTop();
    const dialog = dialogRef.current;
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, [dialogRef, raiseToTop]);

  useEffect(() => {
    stepChangeRef.current?.(step);
    let frames = 0;
    let raf = 0;
    const tick = () => {
      const el = findTarget();
      // A target inside a modal has no usable box before that modal is open, so
      // the retry loop keeps waiting for it rather than measuring a zero rect.
      const host = el?.closest("dialog") ?? null;
      const inModal = host !== null && host !== dialogRef.current;
      if (el && (!inModal || host.open)) {
        // Getting back on top has to happen after the modal opened, which is
        // exactly the moment its content became measurable.
        if (inModal) raiseToTop();
        // The property panel and the template rail both scroll, so a target can
        // sit outside its container's viewport. Absent in jsdom, hence optional.
        el.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        setRect(el.getBoundingClientRect());
        return;
      }
      if (frames++ < MEASURE_RETRY_FRAMES) {
        raf = requestAnimationFrame(tick);
        return;
      }
      // The step stays readable and dismissible with the tooltip centred, even
      // when its modal never showed up.
      setRect(null);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [dialogRef, findTarget, raiseToTop, step]);

  useEffect(() => {
    const handler = () => {
      const el = findTarget();
      setRect(el ? el.getBoundingClientRect() : null);
    };
    globalThis.addEventListener("resize", handler);
    return () => globalThis.removeEventListener("resize", handler);
  }, [findTarget]);

  const isLast = step === steps.length - 1;
  const next = () => (isLast ? onComplete() : setStep((s) => s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  const current = steps[step];

  const tooltipStyle: React.CSSProperties = rect
    ? {
        position: "fixed",
        left: Math.max(8, Math.min(rect.left, globalThis.innerWidth - TOOLTIP_WIDTH)),
        top:
          rect.bottom + PAD + 8 + TOOLTIP_HEIGHT > globalThis.innerHeight
            ? Math.max(8, rect.top - PAD - 8 - TOOLTIP_HEIGHT)
            : rect.bottom + PAD + 8,
        zIndex: 10002,
        maxWidth: "min(320px, 85vw)",
      }
    : {
        // No anchor on screen: centre the card rather than hide it, so the step
        // can still be read, skipped and finished.
        position: "fixed",
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 10002,
        maxWidth: "min(320px, 85vw)",
      };

  const buttonBase =
    "px-3 py-1 rounded-none text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue";

  return createPortal(
    <dialog
      ref={dialogRef}
      // Escape is answered by useModalA11y, which also has to work in jsdom
      // where no `cancel` event exists. Letting the UA close the shell as well
      // would tear it down before the host can unmount it and clean up.
      onCancel={(e) => e.preventDefault()}
      aria-labelledby={titleId}
      aria-describedby={textId}
      tabIndex={-1}
      className="tutorial-shell"
    >
      {/* Dimmed backdrop with a hole punched around the current target */}
      <svg className="absolute inset-0 w-full h-full" style={{ zIndex: 10000 }} aria-hidden="true">
        <defs>
          <mask id={maskId}>
            <rect width="100%" height="100%" fill="white" />
            {rect && (
              <rect
                x={rect.left - PAD}
                y={rect.top - PAD}
                width={rect.width + PAD * 2}
                height={rect.height + PAD * 2}
                rx={0}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.8)" mask={`url(#${maskId})`} />
      </svg>

      {/* Highlight border around the cutout */}
      {rect && (
        <div
          aria-hidden="true"
          className="absolute border-2 border-accent-blue rounded-none pointer-events-none"
          style={{
            left: rect.left - PAD,
            top: rect.top - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            zIndex: 10001,
            boxShadow: "0 0 0 4px rgba(90, 171, 255, 0.2)",
          }}
        />
      )}

      <div style={tooltipStyle}>
        {/* The dialog role and the modality live on the <dialog> shell; a second
            role="dialog" in here would announce a dialog inside a dialog. */}
        <div className="bg-bg-secondary border border-border-subtle rounded-none shadow-lg p-4">
          {/* Live region so a step change is announced without moving focus. */}
          <div role="status">
            <p className="sr-only">
              {t("tutorial.stepAnnounce", { current: step + 1, total: steps.length })}
            </p>
            <p id={titleId} className="text-sm font-semibold text-text-primary mb-1">
              {t(current.titleKey)}
            </p>
            <p id={textId} className="text-xs text-text-secondary mb-3">
              {t(current.textKey)}
            </p>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-text-muted tabular-nums" aria-hidden="true">
              {step + 1}/{steps.length}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onComplete}
                className={`${buttonBase} text-text-secondary hover:text-text-primary hover:bg-bg-hover border border-border-subtle`}
              >
                {t(`${namespace}.skip`)}
              </button>
              {step > 0 && (
                <button
                  type="button"
                  onClick={back}
                  className={`${buttonBase} text-text-secondary hover:text-text-primary hover:bg-bg-hover border border-border-subtle`}
                >
                  {t("tutorial.back")}
                </button>
              )}
              <button
                type="button"
                onClick={next}
                className={`${buttonBase} bg-accent-blue text-white hover:bg-accent-blue/80`}
              >
                {isLast ? t(`${namespace}.finish`) : t(`${namespace}.next`)}
              </button>
            </div>
          </div>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
