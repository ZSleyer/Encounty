/**
 * templateEditorGeometry.ts -- Coordinate math for the template editor.
 *
 * Converts pointer positions and relative boxes into image and canvas
 * coordinates, and applies the keyboard steps that move or resize a box.
 */
import type React from "react";
import { MatchedRegion } from "../../types";

/** Compute relative mouse/touch position within the snapshot container. */
export function computeRelativePos(
  e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>,
  container: HTMLDivElement | null,
  bounds: { offsetX: number; offsetY: number; renderedW: number; renderedH: number } | null,
): { x: number; y: number } {
  if (!container) return { x: 0, y: 0 };
  const rect = container.getBoundingClientRect();
  const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
  const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;

  if (bounds?.renderedW && bounds.renderedH > 0) {
    const x = Math.max(0, Math.min(1, (clientX - rect.left - bounds.offsetX) / bounds.renderedW));
    const y = Math.max(0, Math.min(1, (clientY - rect.top - bounds.offsetY) / bounds.renderedH));
    return { x, y };
  }

  return {
    x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
  };
}

/** Compute and set image bounds for object-contain letterboxing. */
export function computeImageBounds(
  container: HTMLDivElement | null,
  snapshotW: number,
  snapshotH: number,
  setImageBounds: React.Dispatch<
    React.SetStateAction<{
      offsetX: number;
      offsetY: number;
      renderedW: number;
      renderedH: number;
    } | null>
  >,
) {
  if (!container || snapshotW === 0 || snapshotH === 0) {
    setImageBounds(null);
    return;
  }
  const rect = container.getBoundingClientRect();
  const scale = Math.min(rect.width / snapshotW, rect.height / snapshotH);
  const renderedW = snapshotW * scale;
  const renderedH = snapshotH * scale;
  setImageBounds({
    offsetX: (rect.width - renderedW) / 2,
    offsetY: (rect.height - renderedH) / 2,
    renderedW,
    renderedH,
  });
}

/** Handle arrow key navigation in replay phase. */
export function handleReplayKeyDown(
  e: KeyboardEvent,
  frameCount: number,
  setIndex: React.Dispatch<React.SetStateAction<number>>,
) {
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    const step = e.shiftKey ? 5 : 1;
    setIndex((prev) => Math.max(0, prev - step));
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    const step = e.shiftKey ? 5 : 1;
    setIndex((prev) => Math.min(frameCount - 1, prev + step));
  }
}

/** Convert a relative bounding box to a pixel region, clamped to canvas bounds. */
export function boxToRegion(
  box: { x: number; y: number; w: number; h: number },
  canvas: HTMLCanvasElement,
): MatchedRegion | null {
  const cw = canvas.width;
  const ch = canvas.height;
  // Clamp origin to [0, canvas size)
  const pxX = Math.max(0, Math.min(cw - 1, Math.floor(box.x * cw)));
  const pxY = Math.max(0, Math.min(ch - 1, Math.floor(box.y * ch)));
  // Clamp dimensions so region never exceeds canvas bounds
  const pxW = Math.max(1, Math.min(cw - pxX, Math.floor(box.w * cw)));
  const pxH = Math.max(1, Math.min(ch - pxY, Math.floor(box.h * ch)));
  if (pxW <= 5 || pxH <= 5) return null;
  return { type: "image", expected_text: "", rect: { x: pxX, y: pxY, w: pxW, h: pxH } };
}

/** Step size (relative fraction) applied per arrow-key press when moving or resizing a box. */
const REGION_KEY_STEP = 0.02;

/** Default centered box used when a keyboard user starts drawing with Enter. */
export const REGION_DEFAULT_BOX = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 };

/** Moves a box by one keyboard step in the arrow-key direction, clamped to the 0..1 image area. */
export function moveBoxByKey(
  box: { x: number; y: number; w: number; h: number },
  key: string,
): { x: number; y: number; w: number; h: number } {
  let x = box.x;
  let y = box.y;
  if (key === "ArrowLeft") x -= REGION_KEY_STEP;
  else if (key === "ArrowRight") x += REGION_KEY_STEP;
  else if (key === "ArrowUp") y -= REGION_KEY_STEP;
  else if (key === "ArrowDown") y += REGION_KEY_STEP;
  x = Math.min(Math.max(x, 0), 1 - box.w);
  y = Math.min(Math.max(y, 0), 1 - box.h);
  return { x, y, w: box.w, h: box.h };
}

/** Resizes a box by one keyboard step in the arrow-key direction, clamped within the 0..1 image area. */
export function resizeBoxByKey(
  box: { x: number; y: number; w: number; h: number },
  key: string,
): { x: number; y: number; w: number; h: number } {
  let w = box.w;
  let h = box.h;
  if (key === "ArrowLeft") w -= REGION_KEY_STEP;
  else if (key === "ArrowRight") w += REGION_KEY_STEP;
  else if (key === "ArrowUp") h -= REGION_KEY_STEP;
  else if (key === "ArrowDown") h += REGION_KEY_STEP;
  w = Math.min(Math.max(w, 0.02), 1 - box.x);
  h = Math.min(Math.max(h, 0.02), 1 - box.y);
  return { x: box.x, y: box.y, w, h };
}
