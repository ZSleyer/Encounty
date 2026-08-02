/**
 * overlayElements.ts: single source of truth for the overlay element keys.
 *
 * The editor (canvas, property panel, layer list) and the snapping hook all
 * need the same set of keys. Keeping them here means adding another overlay
 * element is a one-line change instead of touching four unions and five lists.
 */

/**
 * DRAGGABLE_ELEMENT_KEYS lists every element that can be moved and resized on
 * the canvas, in default layer order. The order is the one the editor renders
 * and cycles through, so appending keeps existing keyboard order intact.
 */
export const DRAGGABLE_ELEMENT_KEYS = [
  "sprite",
  "name",
  "title",
  "counter",
  "timer",
  "odds",
  "phase",
  "total_counter",
  "total_timer",
] as const;

/** DraggableElementKey is a key of a positionable element inside OverlaySettings. */
export type DraggableElementKey = (typeof DRAGGABLE_ELEMENT_KEYS)[number];

/**
 * ELEMENT_KEYS are the selectable targets in the editor: every draggable
 * element plus the canvas itself, which owns the background properties.
 */
export const ELEMENT_KEYS = [...DRAGGABLE_ELEMENT_KEYS, "canvas"] as const;

/** ElementKey is any selectable editor target, including the canvas. */
export type ElementKey = (typeof ELEMENT_KEYS)[number];
