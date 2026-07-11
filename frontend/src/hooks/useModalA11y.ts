/**
 * useModalA11y.ts — Focus management for non-native modal overlays.
 * Native `<dialog>` elements get a focus trap and Escape handling for free via
 * `showModal()`. Overlays built as plain portal-rendered `<div>`s (update
 * banners, tutorial walkthroughs, confirmation blockers) don't, so this hook
 * reproduces the same behavior for them: move focus in on open, trap Tab
 * inside the container, handle Escape, and restore focus to the trigger on
 * close.
 */
import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null,
  );
}

interface UseModalA11yOptions {
  /** Whether the modal is currently open. Focus is trapped only while true. */
  readonly isOpen: boolean;
  /** Called when the user presses Escape inside the modal. */
  readonly onClose: () => void;
}

/**
 * useModalA11y moves focus into the returned container ref when `isOpen`
 * becomes true, traps Tab/Shift+Tab within it, calls `onClose` on Escape, and
 * restores focus to whatever was focused before the modal opened once it
 * closes or unmounts.
 *
 * The container element must be able to receive focus itself as a fallback
 * (add `tabIndex={-1}`) for the case where it has no focusable children yet.
 */
export function useModalA11y<T extends HTMLElement>({
  isOpen,
  onClose,
}: UseModalA11yOptions) {
  const containerRef = useRef<T>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const container = containerRef.current;
    if (!container) return;

    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const initialFocusables = getFocusable(container);
    (initialFocusables[0] ?? container).focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const focusables = getFocusable(container);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus?.();
    };
  }, [isOpen, onClose]);

  return containerRef;
}
