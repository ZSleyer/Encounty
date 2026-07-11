/**
 * regionDelta.ts — Region pixel snapshot helpers for region-based hysteresis.
 *
 * In 3D games the whole frame changes constantly, so the score-based
 * hysteresis exit (score drops below precision * hysteresisFactor) is noisy
 * and the whole-frame pixel delta never lets adaptive polling slow down.
 * Region mode instead freezes the winning template's region pixels when a
 * match confirms and compares later frames against that snapshot: only a
 * real change of the region content ends the hysteresis phase.
 */
import { clamp01, fitDimensions, pixelDelta } from "./math";

/** Downscaled grayscale pixels of one template region extracted from a video frame. */
export interface RegionGray {
  /** Grayscale pixels in [0, 1], row-major. */
  data: Float32Array;
  width: number;
  height: number;
}

/**
 * Extract downscaled grayscale crops of the given template regions from the
 * current video frame.
 *
 * Rects are given in template-image pixel coordinates and are scaled to video
 * coordinates via videoWidth / templateDims.width (and the height analog),
 * then clamped to the video bounds. Each region is drawn into the scratch
 * canvas downscaled so its longer side is at most maxDim (aspect preserved)
 * and converted to BT.601 grayscale normalized to [0, 1].
 *
 * Returns null when the 2d context is unavailable, the video or template has
 * no dimensions, or any rect is degenerate (empty after clamping), so callers
 * can fall back to the score-based hysteresis exit.
 */
export function extractRegionGrays(
  video: HTMLVideoElement,
  templateDims: { width: number; height: number },
  rects: Array<{ x: number; y: number; w: number; h: number }>,
  scratchCanvas: HTMLCanvasElement,
  maxDim = 64,
): RegionGray[] | null {
  if (video.videoWidth <= 0 || video.videoHeight <= 0) return null;
  if (templateDims.width <= 0 || templateDims.height <= 0) return null;
  const ctx = scratchCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  const scaleX = video.videoWidth / templateDims.width;
  const scaleY = video.videoHeight / templateDims.height;
  const result: RegionGray[] = [];

  for (const rect of rects) {
    // Scale from template-image coordinates to video coordinates, then clamp
    // to the video bounds so partially off-screen rects still sample pixels.
    const x0 = Math.max(0, rect.x * scaleX);
    const y0 = Math.max(0, rect.y * scaleY);
    const x1 = Math.min(video.videoWidth, (rect.x + rect.w) * scaleX);
    const y1 = Math.min(video.videoHeight, (rect.y + rect.h) * scaleY);
    const sw = x1 - x0;
    const sh = y1 - y0;
    if (sw < 1 || sh < 1) return null;

    const [dw, dh] = fitDimensions(Math.round(sw), Math.round(sh), maxDim);
    scratchCanvas.width = dw;
    scratchCanvas.height = dh;
    ctx.drawImage(video, x0, y0, sw, sh, 0, 0, dw, dh);
    const image = ctx.getImageData(0, 0, dw, dh);

    const gray = new Float32Array(dw * dh);
    for (let i = 0; i < gray.length; i++) {
      const o = i * 4;
      // BT.601 luma, normalized to [0, 1].
      gray[i] =
        (0.299 * image.data[o] + 0.587 * image.data[o + 1] + 0.114 * image.data[o + 2]) / 255;
    }
    result.push({ data: gray, width: dw, height: dh });
  }

  return result;
}

/**
 * Mean normalized pixel delta across two matching sets of region grays.
 *
 * Returns the mean over region pairs of pixelDelta(a.data, b.data), a value
 * in [0, 1] where 0 means identical content. Any structural mismatch (empty
 * sets, different region counts or dimensions) returns 1 (maximum change) so
 * a broken snapshot fails open: the hysteresis exits instead of deadlocking.
 */
export function regionSetDelta(a: RegionGray[], b: RegionGray[]): number {
  if (a.length === 0 || a.length !== b.length) return 1;

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i].width !== b[i].width || a[i].height !== b[i].height) return 1;
    // pixelDelta normalizes assuming 0-255 pixel values; region grays are
    // stored in [0, 1], so rescale to keep the result a true [0, 1] mean
    // absolute difference comparable against REGION_EXIT_DELTA.
    sum += clamp01(pixelDelta(a[i].data, b[i].data) * 255);
  }
  return sum / a.length;
}
