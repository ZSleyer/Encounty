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
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
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
    <span ref={wrapperRef} className="relative inline-flex">
      <button
        ref={toggleRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
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
          className={`absolute top-8 z-50 block w-[min(20rem,70vw)] rounded-none border border-border-subtle bg-bg-card p-3 text-left shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
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
