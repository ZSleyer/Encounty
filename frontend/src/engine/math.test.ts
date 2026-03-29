/**
 * Comprehensive unit tests for engine/math.ts.
 *
 * All tests use synthetic Float32Array data and have zero browser API
 * dependencies (no Canvas, WebGPU, Video, or DOM).
 */

import { describe, it, expect } from "vitest";
import type { TemplateData } from "./WebGPUDetector";
import {
  fitDimensions,
  clamp01,
  adaptiveBlockSizeForRegion,
  pixelDelta,
  pearsonCorrelation,
  histogramCorrelation,
  madSimilarity,
  blockSSIM,
  buildIntegralImages,
  crossCorrelation,
  ncc,
  downscaleTemplate,
  cropTemplateGray,
  matchMultiScale,
  matchWholeTemplate,
} from "./math";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a grayscale Float32Array with a per-pixel fill function. */
function makeGray(width: number, height: number, fill: (x: number, y: number) => number): Float32Array {
  const arr = new Float32Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      arr[y * width + x] = fill(x, y);
  return arr;
}

/** Create a minimal TemplateData object suitable for CPU matching. */
function makeTemplate(
  width: number,
  height: number,
  gray: Float32Array,
): TemplateData {
  const n = width * height;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += gray[i];
  const mean = sum / n;
  let varSum = 0;
  for (let i = 0; i < n; i++) {
    const d = gray[i] - mean;
    varSum += d * d;
  }
  const stdDev = Math.sqrt(varSum / n);
  return { gray, width, height, mean, stdDev, pixelCount: n, regions: [] };
}

// ---------------------------------------------------------------------------
// fitDimensions
// ---------------------------------------------------------------------------

describe("fitDimensions", () => {
  it("scales landscape image to fit maxDim", () => {
    expect(fitDimensions(1920, 1080, 320)).toEqual([320, 180]);
  });

  it("scales portrait image to fit maxDim", () => {
    expect(fitDimensions(1080, 1920, 320)).toEqual([180, 320]);
  });

  it("scales square image to fit maxDim", () => {
    expect(fitDimensions(500, 500, 320)).toEqual([320, 320]);
  });

  it("returns original dimensions when already within maxDim", () => {
    expect(fitDimensions(100, 200, 320)).toEqual([100, 200]);
  });

  it("handles very small dimensions without producing zero", () => {
    const [w, h] = fitDimensions(3000, 1, 320);
    expect(w).toBe(320);
    expect(h).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// clamp01
// ---------------------------------------------------------------------------

describe("clamp01", () => {
  it("clamps negative to 0", () => expect(clamp01(-1)).toBe(0));
  it("keeps 0 as 0", () => expect(clamp01(0)).toBe(0));
  it("keeps 0.5 as 0.5", () => expect(clamp01(0.5)).toBe(0.5));
  it("keeps 1 as 1", () => expect(clamp01(1)).toBe(1));
  it("clamps above 1 to 1", () => expect(clamp01(2)).toBe(1));
});

// ---------------------------------------------------------------------------
// adaptiveBlockSizeForRegion
// ---------------------------------------------------------------------------

describe("adaptiveBlockSizeForRegion", () => {
  it("returns 8 for small regions", () => {
    expect(adaptiveBlockSizeForRegion(32, 32)).toBe(8);
  });

  it("returns 16 for medium regions", () => {
    expect(adaptiveBlockSizeForRegion(128, 128)).toBe(16);
  });

  it("returns 32 for large regions", () => {
    expect(adaptiveBlockSizeForRegion(512, 512)).toBe(32);
  });
});

// ---------------------------------------------------------------------------
// pixelDelta
// ---------------------------------------------------------------------------

describe("pixelDelta", () => {
  it("returns 0 for identical buffers", () => {
    const a = makeGray(10, 10, () => 100);
    expect(pixelDelta(a, a)).toBe(0);
  });

  it("returns ~1 for maximally different buffers (0 vs 255)", () => {
    const a = makeGray(10, 10, () => 0);
    const b = makeGray(10, 10, () => 255);
    expect(pixelDelta(a, b)).toBeCloseTo(1, 2);
  });

  it("returns partial difference correctly", () => {
    const a = makeGray(10, 10, () => 0);
    const b = makeGray(10, 10, () => 127.5);
    expect(pixelDelta(a, b)).toBeCloseTo(0.5, 2);
  });

  it("returns 0 for empty buffers", () => {
    expect(pixelDelta(new Float32Array(0), new Float32Array(0))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// pearsonCorrelation
// ---------------------------------------------------------------------------

describe("pearsonCorrelation", () => {
  it("returns ~1.0 for identical data", () => {
    const a = makeGray(10, 10, (x, y) => x * 10 + y);
    expect(pearsonCorrelation(a, a)).toBeCloseTo(1, 4);
  });

  it("returns 0 for zero-variance data", () => {
    const a = makeGray(10, 10, () => 42);
    const b = makeGray(10, 10, (x) => x);
    expect(pearsonCorrelation(a, b)).toBe(0);
  });

  it("returns ~1.0 for linearly scaled data (a*2+10)", () => {
    const a = makeGray(10, 10, (x, y) => x * 10 + y);
    const b = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) b[i] = a[i] * 2 + 10;
    expect(pearsonCorrelation(a, b)).toBeCloseTo(1, 4);
  });
});

// ---------------------------------------------------------------------------
// histogramCorrelation
// ---------------------------------------------------------------------------

describe("histogramCorrelation", () => {
  it("returns ~1.0 for identical distributions", () => {
    const a = makeGray(20, 20, (x, y) => (x + y) * 5);
    expect(histogramCorrelation(a, a)).toBeCloseTo(1, 2);
  });

  it("returns low correlation for very different distributions", () => {
    // One image entirely dark, another entirely bright
    const a = makeGray(20, 20, () => 10);
    const b = makeGray(20, 20, () => 245);
    expect(histogramCorrelation(a, b)).toBeLessThan(0.3);
  });
});

// ---------------------------------------------------------------------------
// madSimilarity
// ---------------------------------------------------------------------------

describe("madSimilarity", () => {
  it("returns 1.0 for identical buffers", () => {
    const a = makeGray(8, 8, () => 100);
    expect(madSimilarity(a, a)).toBeCloseTo(1, 6);
  });

  it("returns 0.0 when average difference is >= 128", () => {
    const a = makeGray(8, 8, () => 0);
    const b = makeGray(8, 8, () => 128);
    expect(madSimilarity(a, b)).toBeCloseTo(0, 6);
  });

  it("returns 0 for empty buffers", () => {
    expect(madSimilarity(new Float32Array(0), new Float32Array(0))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// blockSSIM
// ---------------------------------------------------------------------------

describe("blockSSIM", () => {
  it("returns ~1.0 for identical blocks", () => {
    const w = 32;
    const h = 32;
    const a = makeGray(w, h, (x, y) => (x * 8 + y * 3) % 256);
    expect(blockSSIM(a, a, w, h, 32)).toBeCloseTo(1, 2);
  });

  it("returns low score for completely different blocks", () => {
    const w = 32;
    const h = 32;
    const a = makeGray(w, h, () => 20);
    const b = makeGray(w, h, () => 240);
    expect(blockSSIM(a, b, w, h, 32)).toBeLessThan(0.5);
  });

  it("returns 0 for empty input (w/h too small for any block)", () => {
    expect(blockSSIM(new Float32Array(0), new Float32Array(0), 0, 0, 32)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildIntegralImages
// ---------------------------------------------------------------------------

describe("buildIntegralImages", () => {
  it("computes correct sums for a known 3x3 image", () => {
    // Image:
    // 1  2  3
    // 4  5  6
    // 7  8  9
    const frame = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const { ii, ii2, stride } = buildIntegralImages(frame, 3, 3);

    expect(stride).toBe(4); // fw + 1

    // Bottom-right corner of ii should equal total pixel sum = 45
    expect(ii[3 * stride + 3]).toBeCloseTo(45, 6);

    // Bottom-right corner of ii2 should equal sum of squares = 1+4+9+16+25+36+49+64+81 = 285
    expect(ii2[3 * stride + 3]).toBeCloseTo(285, 6);
  });
});

// ---------------------------------------------------------------------------
// crossCorrelation
// ---------------------------------------------------------------------------

describe("crossCorrelation", () => {
  it("returns high cross-correlation for an exact match at known position", () => {
    // 8x8 frame with a 4x4 patch embedded at (2, 2)
    const frame = makeGray(8, 8, () => 50);
    const patchFill = (x: number, y: number) => 100 + x * 10 + y * 20;
    // Embed the patch into the frame
    for (let py = 0; py < 4; py++)
      for (let px = 0; px < 4; px++)
        frame[(2 + py) * 8 + (2 + px)] = patchFill(px, py);

    const patchGray = makeGray(4, 4, patchFill);
    let patchSum = 0;
    for (let i = 0; i < 16; i++) patchSum += patchGray[i];
    const patchMean = patchSum / 16;

    // Compute patch mean in frame at position (2, 2)
    let framePatchSum = 0;
    for (let py = 0; py < 4; py++)
      for (let px = 0; px < 4; px++)
        framePatchSum += frame[(2 + py) * 8 + (2 + px)];
    const pMean = framePatchSum / 16;

    let patchStdSum = 0;
    for (let i = 0; i < 16; i++) {
      const d = patchGray[i] - patchMean;
      patchStdSum += d * d;
    }

    const tmpl = { gray: patchGray, width: 4, height: 4, mean: patchMean, stdDev: Math.sqrt(patchStdSum / 16) };
    const cc = crossCorrelation(frame, 8, tmpl, 2, 2, pMean);
    // Since the patch matches exactly, cross-correlation should be positive and large
    expect(cc).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// ncc
// ---------------------------------------------------------------------------

describe("ncc", () => {
  it("returns high score when template is in the frame", () => {
    // Place a distinctive pattern in an otherwise uniform frame
    const frame = makeGray(16, 16, () => 50);
    const tmplGray = makeGray(4, 4, (x, y) => 100 + x * 20 + y * 30);
    // Embed template at position (6, 6)
    for (let ty = 0; ty < 4; ty++)
      for (let tx = 0; tx < 4; tx++)
        frame[(6 + ty) * 16 + (6 + tx)] = tmplGray[ty * 4 + tx];

    let s = 0;
    for (let i = 0; i < 16; i++) s += tmplGray[i];
    const mean = s / 16;
    let vs = 0;
    for (let i = 0; i < 16; i++) { const d = tmplGray[i] - mean; vs += d * d; }
    const stdDev = Math.sqrt(vs / 16);

    const score = ncc(frame, 16, 16, { gray: tmplGray, width: 4, height: 4, mean, stdDev });
    expect(score).toBeGreaterThan(0.9);
  });

  it("returns low score when template does not match", () => {
    const frame = makeGray(16, 16, (x, y) => (x * 7 + y * 13) % 256);
    const tmplGray = makeGray(4, 4, (x, y) => 255 - (x * 50 + y * 60));

    let s = 0;
    for (let i = 0; i < 16; i++) s += tmplGray[i];
    const mean = s / 16;
    let vs = 0;
    for (let i = 0; i < 16; i++) { const d = tmplGray[i] - mean; vs += d * d; }
    const stdDev = Math.sqrt(vs / 16);

    const score = ncc(frame, 16, 16, { gray: tmplGray, width: 4, height: 4, mean, stdDev });
    expect(score).toBeLessThan(0.8);
  });

  it("returns 0 when template is larger than frame", () => {
    const frame = makeGray(4, 4, () => 128);
    const tmplGray = makeGray(8, 8, () => 128);
    const score = ncc(frame, 4, 4, { gray: tmplGray, width: 8, height: 8, mean: 128, stdDev: 0 });
    expect(score).toBe(0);
  });

  it("returns 0 for zero-variance template", () => {
    const frame = makeGray(8, 8, (x) => x * 30);
    const tmplGray = makeGray(4, 4, () => 100);
    const score = ncc(frame, 8, 8, { gray: tmplGray, width: 4, height: 4, mean: 100, stdDev: 0 });
    expect(score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// downscaleTemplate
// ---------------------------------------------------------------------------

describe("downscaleTemplate", () => {
  it("returns same dimensions when template already fits", () => {
    const gray = makeGray(50, 40, (x, y) => x + y);
    const tmpl = makeTemplate(50, 40, gray);
    const result = downscaleTemplate(tmpl, 100);
    expect(result.width).toBe(50);
    expect(result.height).toBe(40);
    expect(result.gray).toBe(gray); // same reference
  });

  it("downscales and recomputes mean/stdDev", () => {
    const gray = makeGray(200, 100, (x, y) => (x + y) % 256);
    const tmpl = makeTemplate(200, 100, gray);
    const result = downscaleTemplate(tmpl, 50);
    expect(result.width).toBe(50);
    expect(result.height).toBe(25);
    expect(result.gray.length).toBe(50 * 25);
    // stdDev should be recomputed and positive for varied data
    expect(result.stdDev).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// cropTemplateGray
// ---------------------------------------------------------------------------

describe("cropTemplateGray", () => {
  it("crops a region from template gray data", () => {
    const gray = makeGray(20, 20, (x, y) => x * 10 + y);
    const tmpl = makeTemplate(20, 20, gray);
    const cropped = cropTemplateGray(tmpl, 5, 5, 10, 10, 10, 10);
    expect(cropped).not.toBeNull();
    expect(cropped!.length).toBe(100);
    // Top-left of crop should be pixel at (5, 5) in the original
    expect(cropped![0]).toBe(gray[5 * 20 + 5]);
  });

  it("returns null when rw < 4", () => {
    const gray = makeGray(20, 20, () => 100);
    const tmpl = makeTemplate(20, 20, gray);
    expect(cropTemplateGray(tmpl, 0, 0, 3, 10, 10, 10)).toBeNull();
  });

  it("returns null when gray is missing", () => {
    const tmpl: TemplateData = { width: 20, height: 20, mean: 0, stdDev: 0, pixelCount: 400, regions: [] };
    expect(cropTemplateGray(tmpl, 0, 0, 10, 10, 10, 10)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// matchMultiScale
// ---------------------------------------------------------------------------

describe("matchMultiScale", () => {
  it("returns high score for a template embedded in a larger frame", () => {
    // Create a 32x32 frame with a known pattern region
    const frame = makeGray(32, 32, (x, y) => (x * 3 + y * 7) % 256);
    // Use a 10x10 crop from the frame as the template
    const tmplGray = makeGray(10, 10, (x, y) => ((x + 5) * 3 + (y + 5) * 7) % 256);
    const tmpl = makeTemplate(10, 10, tmplGray);

    const score = matchMultiScale(frame, 32, 32, tmpl);
    // At one of the scales, the template should match well
    expect(score).toBeGreaterThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// matchWholeTemplate
// ---------------------------------------------------------------------------

describe("matchWholeTemplate", () => {
  it("uses matchMultiScale for small templates (<= 128)", () => {
    const frame = makeGray(32, 32, (x, y) => (x * 3 + y * 7) % 256);
    const tmplGray = makeGray(10, 10, (x, y) => ((x + 5) * 3 + (y + 5) * 7) % 256);
    const tmpl = makeTemplate(10, 10, tmplGray);

    const score = matchWholeTemplate({ gray: frame, width: 32, height: 32 }, tmpl, 64);
    // Small template path (matchMultiScale)
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it("uses ncc for large templates (> 128)", () => {
    // Create a 200x200 template (larger than 128 threshold)
    const frame = makeGray(64, 64, (x, y) => (x * 5 + y * 11) % 256);
    const tmplGray = makeGray(200, 200, (x, y) => (x * 5 + y * 11) % 256);
    const tmpl = makeTemplate(200, 200, tmplGray);

    const score = matchWholeTemplate({ gray: frame, width: 64, height: 64 }, tmpl, 64);
    // This goes through the downscale + ncc path
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
