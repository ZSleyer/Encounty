/**
 * Helpers for menus and popovers positioned with CSS anchor positioning.
 *
 * The app runs on Electron, so Chromium's anchor positioning is always
 * available and replaces hand-rolled getBoundingClientRect() maths. The two
 * things every floating menu needs are covered here: escaping the overflow of
 * a scrolling ancestor (position: fixed) and flipping to the other side of the
 * trigger when there is no room below (position-try-fallbacks).
 *
 * Both properties are still missing from React's CSSProperties, hence the casts
 * at the call sites.
 */
import { useId, type CSSProperties } from "react";

/** Vertical space a menu may occupy, as a share of the viewport. */
const MAX_MENU_BLOCK_SIZE = "min(20rem, 60vh)";

/**
 * Returns a CSS dashed-ident that is unique per component instance, usable as
 * an anchor name. useId() yields colons, which a dashed-ident may not contain.
 */
export function useAnchorName(prefix: string): string {
  const id = useId();
  return `--${prefix}-${id.replace(/[^a-zA-Z0-9]/g, "-")}`;
}

/** Style for the trigger element that the menu anchors itself to. */
export function anchorTriggerStyle(anchorName: string): CSSProperties {
  return { anchorName } as CSSProperties;
}

/** Which side of the trigger a menu opens towards, and which edge it lines up with. */
export type MenuPlacement = "below-start" | "below-end" | "above-start" | "above-end";

const PLACEMENT_AREAS: Record<MenuPlacement, string> = {
  "below-start": "block-end span-inline-end",
  "below-end": "block-end span-inline-start",
  "above-start": "block-start span-inline-end",
  "above-end": "block-start span-inline-start",
};

/**
 * Style for the floating menu itself. Pair with `position: fixed` and an
 * `overflow-y-auto` class on the same element.
 *
 * @param anchorName name returned by {@link useAnchorName}
 * @param placement preferred side; the menu flips to the opposite side when it
 *   does not fit, which is what keeps it reachable on short windows
 * @param matchTriggerWidth stretch the menu to the trigger's width, for
 *   combobox-style lists where a narrower popup would look detached
 */
export function anchoredMenuStyle(
  anchorName: string,
  placement: MenuPlacement = "below-start",
  matchTriggerWidth = false,
): CSSProperties {
  return {
    positionAnchor: anchorName,
    positionArea: PLACEMENT_AREAS[placement],
    positionTryFallbacks: "flip-block",
    maxBlockSize: MAX_MENU_BLOCK_SIZE,
    marginBlockStart: placement.startsWith("below") ? "0.25rem" : undefined,
    marginBlockEnd: placement.startsWith("above") ? "0.25rem" : undefined,
    ...(matchTriggerWidth ? { width: "anchor-size(width)" } : {}),
  } as CSSProperties;
}
