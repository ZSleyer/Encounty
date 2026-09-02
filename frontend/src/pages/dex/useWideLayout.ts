/**
 * useWideLayout.ts: the two-pane breakpoint of the Pokédex page.
 */
import { useEffect, useState } from "react";

/**
 * Viewport width from which grid and detail panel sit side by side. Mirrors
 * Tailwind's `lg`, the narrowest breakpoint where a ~340px panel still leaves
 * the grid enough room for a useful number of columns.
 */
const WIDE_LAYOUT_QUERY = "(min-width: 1024px)";

/**
 * True while the viewport is wide enough for the two-pane layout. Environments
 * without `matchMedia` (jsdom) report narrow, which keeps the modal path as the
 * conservative default: it works at every width.
 */
export function useWideLayout(): boolean {
  const [wide, setWide] = useState(false);

  useEffect(() => {
    const query = window.matchMedia?.(WIDE_LAYOUT_QUERY);
    if (!query) return;
    setWide(query.matches);
    const onChange = (event: MediaQueryListEvent) => setWide(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return wide;
}
