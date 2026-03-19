/**
 * useSnapping.ts — Snap-to-grid and snap-to-element alignment helpers for
 * the overlay canvas editor. Returns two functions:
 * - getGuides: returns visible alignment guide lines for the current drag position.
 * - snap: snaps x/y to the nearest grid line (bypassed when Shift is held).
 */
import { OverlaySettings } from "../types";

type ElementKey = "sprite" | "name" | "title" | "counter";

export interface Guide {
  type: "h" | "v";
  position: number;
}

const SNAP_THRESHOLD = 5;

/**
 * useSnapping provides snap-to-grid and snap-to-element logic for the
 * drag/resize interactions in the overlay editor canvas.
 *
 * @param settings - Current overlay settings (used to read sibling element bounds).
 * @param enabled - Whether snapping is active.
 * @param gridSize - Grid cell size in canvas pixels.
 */
export function useSnapping(
  settings: OverlaySettings,
  enabled: boolean,
  gridSize: number,
) {
  const getGuides = (
    activeKey: ElementKey,
    x: number,
    y: number,
    w: number,
    h: number,
  ): Guide[] => {
    if (!enabled) return [];
    const guides: Guide[] = [];
    const cw = settings.canvas_width;
    const ch = settings.canvas_height;

    // Canvas center alignment
    if (Math.abs(x + w / 2 - cw / 2) < SNAP_THRESHOLD) {
      guides.push({ type: "v", position: cw / 2 });
    }
    if (Math.abs(y + h / 2 - ch / 2) < SNAP_THRESHOLD) {
      guides.push({ type: "h", position: ch / 2 });
    }
    // Canvas edges
    if (Math.abs(x) < SNAP_THRESHOLD) guides.push({ type: "v", position: 0 });
    if (Math.abs(x + w - cw) < SNAP_THRESHOLD) guides.push({ type: "v", position: cw });
    if (Math.abs(y) < SNAP_THRESHOLD) guides.push({ type: "h", position: 0 });
    if (Math.abs(y + h - ch) < SNAP_THRESHOLD) guides.push({ type: "h", position: ch });

    // Other element alignment
    for (const key of ["sprite", "name", "title", "counter"] as ElementKey[]) {
      if (key === activeKey) continue;
      const el = settings[key];
      const ex = el.x, ey = el.y, ew = el.width, eh = el.height;

      // Vertical guides (left/center/right of other element)
      if (Math.abs(x - ex) < SNAP_THRESHOLD) guides.push({ type: "v", position: ex });
      if (Math.abs(x + w / 2 - (ex + ew / 2)) < SNAP_THRESHOLD) guides.push({ type: "v", position: ex + ew / 2 });
      if (Math.abs(x + w - (ex + ew)) < SNAP_THRESHOLD) guides.push({ type: "v", position: ex + ew });

      // Horizontal guides (top/center/bottom of other element)
      if (Math.abs(y - ey) < SNAP_THRESHOLD) guides.push({ type: "h", position: ey });
      if (Math.abs(y + h / 2 - (ey + eh / 2)) < SNAP_THRESHOLD) guides.push({ type: "h", position: ey + eh / 2 });
      if (Math.abs(y + h - (ey + eh)) < SNAP_THRESHOLD) guides.push({ type: "h", position: ey + eh });
    }

    return guides;
  };

  const snap = (
    x: number,
    y: number,
    _w: number,
    _h: number,
    shiftKey: boolean,
  ): { x: number; y: number } => {
    if (shiftKey || !enabled) return { x, y };
    const snappedX = Math.round(x / gridSize) * gridSize;
    const snappedY = Math.round(y / gridSize) * gridSize;
    return { x: snappedX, y: snappedY };
  };

  return { getGuides, snap };
}
