/**
 * HelpPopover.tsx: a small "?" toggle that reveals a short explanation.
 *
 * Meant for terms that are obvious to experienced hunters and opaque to
 * everyone else (phasing, for example): the explanation costs no permanent
 * layout space and is one click away where the term is used. This is a plain
 * disclosure, not a dialog. It never traps focus, and it closes on Escape, on a
 * click outside and on a second press of the toggle. Inside a native <dialog>
 * the Escape key is swallowed while the panel is open, so the first Escape
 * closes the explanation and the second one the dialog.
 */
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useI18n } from "../../contexts/I18nContext";

/** Props for {@link HelpPopover}. */
export interface HelpPopoverProps {
  /** Accessible name of the toggle, e.g. "Explain phasing". */
  readonly label: string;
  /** Heading of the panel; also the visible summary of the explanation. */
  readonly title: string;
  /** Explanation body, usually one or two short paragraphs. */
  readonly children: ReactNode;
  /** Side the panel is anchored to, defaults to "left". */
  readonly align?: "left" | "right";
}

/**
 * Renders the "?" toggle and, while open, its explanation panel.
 *
 * The toggle is one of the few round elements in the Tempest geometry: it is a
 * dot, not a panel. The panel itself keeps the square corners of the theme.
 */
export function HelpPopover({ label, title, children, align = "left" }: HelpPopoverProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  // useId() yields colons, which are not valid in a CSS dashed-ident.
  const anchorName = `--help-${panelId.replace(/[^a-zA-Z0-9]/g, "-")}`;

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // preventDefault keeps a surrounding <dialog> open: Escape belongs to the
      // topmost thing on screen, and that is this panel.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      toggleRef.current?.focus();
    };
    const handlePointerDown = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open]);

  return (
    <span ref={wrapperRef} className="inline-flex">
      <button
        ref={toggleRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        // anchorName is CSS anchor positioning, which React's CSSProperties
        // does not know yet, hence the cast.
        style={{ anchorName } as CSSProperties}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label}
        title={label}
        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue ${
          open
            ? "border-accent-blue text-accent-blue"
            : "border-border-subtle text-text-muted hover:border-text-muted hover:text-text-primary"
        }`}
      >
        ?
      </button>

      {open && (
        <span
          id={panelId}
          // Fixed instead of absolute: the popover is used inside scrollable
          // modal bodies, and an absolutely positioned panel gets clipped by
          // that overflow ancestor. A fixed box escapes the clip, and CSS
          // anchor positioning keeps it glued to the toggle without JS
          // measuring. The properties are not in React's CSSProperties yet.
          style={
            {
              positionAnchor: anchorName,
              positionArea: align === "right" ? "block-end span-inline-start" : "block-end span-inline-end",
              // Without a fallback the panel only ever opens downwards and runs
              // off the bottom of short windows. flip-block moves it above the
              // toggle when there is no room below.
              positionTryFallbacks: "flip-block",
              marginBlockStart: "0.5rem",
            } as CSSProperties
          }
          className="fixed z-50 block max-h-[min(18rem,60vh)] w-[min(20rem,70vw)] overflow-y-auto rounded-none border border-border-subtle bg-bg-card p-3 text-left shadow-lg"
        >
          <span className="block text-xs font-bold text-text-primary">{title}</span>
          <span className="mt-1 block text-[11px] leading-relaxed text-text-secondary">
            {children}
          </span>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              toggleRef.current?.focus();
            }}
            className="mt-2 inline-flex min-h-[24px] items-center rounded-none border border-border-subtle px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
          >
            {t("common.close")}
          </button>
        </span>
      )}
    </span>
  );
}
