/**
 * cpuScoring.ts -- CPU reference scoring for the GPU equivalence run.
 *
 * Mirrors the node test suite's CPU path. The resampling here is deliberately
 * nearest-neighbor and the grayscale conversion is its own copy: unifying
 * either with the shipped engine would move the reference scores this test
 * exists to compare against.
 */
import {
  fitDimensions,
  adaptiveBlockSizeForRegion,
  scoreRegionHybrid,
  andLogicAcrossRegions,
} from "../../../engine/math";
import { DELTA_GRAY_SIZE } from "./fixtures";

/** BT.601 grayscale conversion (0-255 range) from RGBA pixel data. */
export function toGrayscale(pixels: Uint8ClampedArray, w: number, h: number): Float32Array {
  const n = w * h;
  const gray = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    gray[i] = 0.299 * pixels[i * 4] + 0.587 * pixels[i * 4 + 1] + 0.114 * pixels[i * 4 + 2];
  }
  return gray;
}

/**
 * Downsamples a grayscale buffer to a small square via nearest-neighbor.
 * Deliberately cheap: the result only feeds the polling policy's frame delta
 * (pixelDelta), which needs coarse scene-change information, not fidelity.
 */
export function downsampleGray(
  src: Float32Array,
  srcW: number,
  srcH: number,
  size: number = DELTA_GRAY_SIZE,
): Float32Array {
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / size));
    for (let x = 0; x < size; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / size));
      out[y * size + x] = src[sy * srcW + sx];
    }
  }
  return out;
}

/** Crop and resample a rectangular region from a grayscale buffer. */
function cropAndResample(
  src: Float32Array,
  srcW: number,
  srcH: number,
  region: { x: number; y: number; w: number; h: number },
  dw: number,
  dh: number,
): Float32Array {
  const out = new Float32Array(dw * dh);
  const sx = region.w / dw;
  const sy = region.h / dh;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const idx =
        Math.min(Math.floor(y * sy) + region.y, srcH - 1) * srcW +
        Math.min(Math.floor(x * sx) + region.x, srcW - 1);
      out[y * dw + x] = src[idx];
    }
  }
  return out;
}

/** CPU region scoring matching the vitest approach. */
function cpuScoreRegion(
  frameGray: Float32Array,
  frameW: number,
  frameH: number,
  tmplGray: Float32Array,
  tmplW: number,
  tmplH: number,
  region: { x: number; y: number; w: number; h: number },
): number {
  const scaleX = frameW / tmplW;
  const scaleY = frameH / tmplH;
  const baseX = Math.round(region.x * scaleX);
  const baseY = Math.round(region.y * scaleY);
  const frw = Math.max(4, Math.round(region.w * scaleX));
  const frh = Math.max(4, Math.round(region.h * scaleY));

  const [dw, dh] = fitDimensions(region.w, region.h, 512);
  const bs = adaptiveBlockSizeForRegion(dw, dh);

  const tmplCrop = cropAndResample(tmplGray, tmplW, tmplH, region, dw, dh);

  // Sliding window: try small offsets around region center, keep best
  let bestScore = 0;
  const step = 4;
  const maxOffset = 4;

  for (let dy = -maxOffset; dy <= maxOffset; dy += step) {
    for (let dx = -maxOffset; dx <= maxOffset; dx += step) {
      const frx = Math.max(0, Math.min(baseX + dx, frameW - frw));
      const fry = Math.max(0, Math.min(baseY + dy, frameH - frh));

      const frameCrop = cropAndResample(
        frameGray,
        frameW,
        frameH,
        { x: frx, y: fry, w: frw, h: frh },
        dw,
        dh,
      );

      const hybrid = scoreRegionHybrid(frameCrop, tmplCrop, dw, dh, bs);
      if (hybrid > bestScore) bestScore = hybrid;
    }
  }

  return bestScore;
}

/** CPU score across all regions (AND-logic: minimum). */
export function cpuScoreFrame(
  frameGray: Float32Array,
  frameW: number,
  frameH: number,
  tmplGray: Float32Array,
  tmplW: number,
  tmplH: number,
  regions: Array<{ x: number; y: number; w: number; h: number }>,
): number {
  const scores = regions.map((region) =>
    cpuScoreRegion(frameGray, frameW, frameH, tmplGray, tmplW, tmplH, region),
  );
  return andLogicAcrossRegions(scores);
}
