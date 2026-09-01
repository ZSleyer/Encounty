import { useEffect } from "react";

/**
 * useFocusShortcut focuses an input when the user presses Ctrl+K (Cmd+K on
 * macOS), the search shortcut both the dashboard and the settings page offer.
 *
 * The listener sits on the window rather than on a container so the shortcut
 * works while focus is anywhere on the page, including inside a scrolled list.
 */
export function useFocusShortcut(ref: React.RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, [ref]);
}
