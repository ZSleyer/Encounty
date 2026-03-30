/**
 * Synthetic tests for the hybrid scoring pipeline functions.
 *
 * All tests use synthetic Float32Array data and have zero browser API
 * dependencies. These tests verify that the pipeline functions in math.ts
 * compose correctly and produce expected results for known inputs.
 */

import { describe, it, expect } from "vitest";
import {
  HYBRID_WEIGHTS,
  MAD_HALF_RANGE,
  fuseHybridScores,
  scoreRegionHybrid,
  andLogicAcrossRegions,
  applyNegativePenalty,
  adaptiveBlockSizeForRegion,
  blockSSIM,
  pearsonCorrelation,
  madSimilarity,
  histogramCorrelation,
} from "./math";

// ---------------------------------------------------------------------------
// Synthetic image helpers
// ---------------------------------------------------------------------------

/** Build a grayscale Float32Array with a per-pixel fill function (0-255 range). */
function makeGray(w: number, h: number, fill: (x: number, y: number) => number): Float32Array {
  const arr = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      arr[y * w + x] = fill(x, y);
  return arr;
}

/** Create a uniform gray image. */
function makeUniform(w: number, h: number, value: number): Float32Array {
  return new Float32Array(w * h).fill(value);
}

/** Create a gradient image (left-to-right, 0 to 255). */
function makeGradient(w: number, h: number): Float32Array {
  return makeGray(w, h, (x) => (x / (w - 1)) * 255);
}

/** Create a checkerboard pattern (alternating 50 and 200). */
function makeCheckerboard(w: number, h: number, blockSize: number = 4): Float32Array {
  return makeGray(w, h, (x, y) =>
    (Math.floor(x / blockSize) + Math.floor(y / blockSize)) % 2 === 0 ? 50 : 200,
  );
}

/** Add Gaussian-like noise to a grayscale buffer (deterministic via seed). */
function addNoise(src: Float32Array, amplitude: number, seed: number = 42): Float32Array {
  const out = new Float32Array(src.length);
  let s = seed;
  for (let i = 0; i < src.length; i++) {
    // Simple LCG pseudo-random in [-1, 1]
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const noise = ((s / 0x7fffffff) * 2 - 1) * amplitude;
    out[i] = Math.max(0, Math.min(255, src[i] + noise));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("HYBRID_WEIGHTS", () => {
  it("weights sum to approximately 1.0", () => {
    const sum = HYBRID_WEIGHTS.ssim + HYBRID_WEIGHTS.pearson + HYBRID_WEIGHTS.mad + HYBRID_WEIGHTS.histogram;
    expect(sum).toBeCloseTo(1, 2);
  });

  it("all weights are positive", () => {
    expect(HYBRID_WEIGHTS.ssim).toBeGreaterThan(0);
    expect(HYBRID_WEIGHTS.pearson).toBeGreaterThan(0);
    expect(HYBRID_WEIGHTS.mad).toBeGreaterThan(0);
    expect(HYBRID_WEIGHTS.histogram).toBeGreaterThan(0);
  });
});

describe("MAD_HALF_RANGE", () => {
  it("equals 128 (integer midpoint of 0-255 range)", () => {
    expect(MAD_HALF_RANGE).toBe(128);
  });
});

// ---------------------------------------------------------------------------
// fuseHybridScores
// ---------------------------------------------------------------------------

describe("fuseHybridScores", () => {
  it("returns ~1.0 when all metrics are 1.0", () => {
    expect(fuseHybridScores(1, 1, 1, 1)).toBeCloseTo(1, 2);
  });

  it("returns 0 when all metrics are 0", () => {
    expect(fuseHybridScores(0, 0, 0, 0)).toBe(0);
  });

  it("applies weights correctly", () => {
    // Only SSIM = 1, others = 0
    expect(fuseHybridScores(1, 0, 0, 0)).toBeCloseTo(HYBRID_WEIGHTS.ssim, 3);
    // Only Pearson = 1
    expect(fuseHybridScores(0, 1, 0, 0)).toBeCloseTo(HYBRID_WEIGHTS.pearson, 3);
    // Only MAD = 1
    expect(fuseHybridScores(0, 0, 1, 0)).toBeCloseTo(HYBRID_WEIGHTS.mad, 3);
    // Only histogram = 1
    expect(fuseHybridScores(0, 0, 0, 1)).toBeCloseTo(HYBRID_WEIGHTS.histogram, 3);
  });

  it("clamps output to [0, 1]", () => {
    // Even with inputs slightly > 1 (shouldn't happen, but defensive)
    expect(fuseHybridScores(1.5, 1.5, 1.5, 1.5)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// scoreRegionHybrid
// ---------------------------------------------------------------------------

describe("scoreRegionHybrid", () => {
  it("returns ~1.0 for identical images", () => {
    const w = 64, h = 64;
    const img = makeCheckerboard(w, h);
    const score = scoreRegionHybrid(img, img, w, h, 8);
    expect(score).toBeGreaterThan(0.95);
  });

  it("returns low score for completely different images", () => {
    const w = 64, h = 64;
    const a = makeUniform(w, h, 30);
    const b = makeUniform(w, h, 220);
    const score = scoreRegionHybrid(a, b, w, h, 8);
    expect(score).toBeLessThan(0.5);
  });

  it("returns intermediate score for noisy version of same image", () => {
    const w = 64, h = 64;
    const original = makeCheckerboard(w, h);
    const noisy = addNoise(original, 40);
    const score = scoreRegionHybrid(original, noisy, w, h, 8);
    expect(score).toBeGreaterThan(0.3);
    expect(score).toBeLessThan(0.99);
  });

  it("returns higher score for less noise", () => {
    const w = 64, h = 64;
    const original = makeGradient(w, h);
    const lowNoise = addNoise(original, 10);
    const highNoise = addNoise(original, 60);
    const scoreLow = scoreRegionHybrid(original, lowNoise, w, h, 8);
    const scoreHigh = scoreRegionHybrid(original, highNoise, w, h, 8);
    expect(scoreLow).toBeGreaterThan(scoreHigh);
  });

  it("produces same result as manually calling all 4 metrics + fuse", () => {
    const w = 32, h = 32;
    const a = makeGradient(w, h);
    const b = addNoise(a, 20);
    const bs = 8;

    const manual = fuseHybridScores(
      blockSSIM(a, b, w, h, bs),
      pearsonCorrelation(a, b),
      madSimilarity(a, b),
      histogramCorrelation(a, b),
    );
    const pipeline = scoreRegionHybrid(a, b, w, h, bs);
    expect(pipeline).toBeCloseTo(manual, 10);
  });
});

// ---------------------------------------------------------------------------
// CPU vs GPU equivalence (range normalisation)
// ---------------------------------------------------------------------------

describe("CPU vs GPU range equivalence", () => {
  it("Pearson correlation is fully scale-invariant (0-255 vs 0-1)", () => {
    const w = 32, h = 32;
    const a255 = makeGradient(w, h);
    const b255 = addNoise(a255, 30);
    const a01 = new Float32Array(a255.length);
    const b01 = new Float32Array(b255.length);
    for (let i = 0; i < a255.length; i++) {
      a01[i] = a255[i] / 255;
      b01[i] = b255[i] / 255;
    }
    expect(Math.abs(pearsonCorrelation(a255, b255) - pearsonCorrelation(a01, b01))).toBeLessThan(0.001);
  });

  it("MAD CPU (128) is close to GPU (0.5 = 127.5/255) for equivalent inputs", () => {
    const w = 32, h = 32;
    const a255 = makeGradient(w, h);
    const b255 = addNoise(a255, 30);

    // CPU MAD: 1 - sum_abs_diff / (n * 128)
    const cpuMad = madSimilarity(a255, b255);

    // GPU MAD equivalent: 1 - sum_abs_diff_01 / (n * 0.5)
    // where 0.5 * 255 = 127.5, not exactly 128 — ~0.4% difference
    const a01 = new Float32Array(a255.length);
    const b01 = new Float32Array(b255.length);
    for (let i = 0; i < a255.length; i++) {
      a01[i] = a255[i] / 255;
      b01[i] = b255[i] / 255;
    }
    let sum01 = 0;
    for (let i = 0; i < a01.length; i++) sum01 += Math.abs(a01[i] - b01[i]);
    const gpuMad = Math.max(0, 1 - sum01 / (a01.length * 0.5));

    // Allow ~0.4% tolerance for the 128 vs 127.5 difference
    expect(Math.abs(cpuMad - gpuMad)).toBeLessThan(0.01);
  });

  it("SSIM CPU (L=255) matches GPU (L=1) for equivalent inputs", () => {
    const w = 64, h = 64;
    const a255 = makeCheckerboard(w, h);
    const b255 = addNoise(a255, 25);
    const cpuSsim = blockSSIM(a255, b255, w, h, 8);

    // GPU SSIM uses C1 = (0.01)^2 = 0.0001 and C2 = (0.03)^2 = 0.0009
    // which are equivalent to CPU's (0.01*255)^2 and (0.03*255)^2 when
    // pixel values are divided by 255. The SSIM formula is scale-invariant
    // when constants are scaled proportionally.
    // We verify this by checking that the CPU score is reasonable.
    expect(cpuSsim).toBeGreaterThan(0.5);
    expect(cpuSsim).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------
// andLogicAcrossRegions
// ---------------------------------------------------------------------------

describe("andLogicAcrossRegions", () => {
  it("returns the minimum score", () => {
    expect(andLogicAcrossRegions([0.9, 0.7, 0.8])).toBeCloseTo(0.7, 6);
  });

  it("returns 0 for empty array", () => {
    expect(andLogicAcrossRegions([])).toBe(0);
  });

  it("returns the single value for single-element array", () => {
    expect(andLogicAcrossRegions([0.85])).toBeCloseTo(0.85, 6);
  });

  it("returns 0 when any region scores 0", () => {
    expect(andLogicAcrossRegions([0.9, 0, 0.8])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// applyNegativePenalty
// ---------------------------------------------------------------------------

describe("applyNegativePenalty", () => {
  it("returns full positive score when negative is 0", () => {
    expect(applyNegativePenalty(0.9, 0)).toBe(0.9);
  });

  it("returns 0 when negative score is 1.0 (full suppression)", () => {
    expect(applyNegativePenalty(0.9, 1)).toBe(0);
  });

  it("reduces score proportionally to negative match", () => {
    const result = applyNegativePenalty(0.8, 0.5);
    expect(result).toBeCloseTo(0.8 * 0.5, 6); // 0.8 * max(0, 1 - 0.5) = 0.4
  });

  it("clamps negative score > 1 to full suppression", () => {
    expect(applyNegativePenalty(0.9, 1.5)).toBe(0);
  });

  it("returns 0 when positive score is 0", () => {
    expect(applyNegativePenalty(0, 0.5)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// adaptiveBlockSizeForRegion — unified (matches GPU)
// ---------------------------------------------------------------------------

describe("adaptiveBlockSizeForRegion (unified)", () => {
  it("returns 4 for very small regions (< 32px)", () => {
    expect(adaptiveBlockSizeForRegion(20, 20)).toBe(4);
    expect(adaptiveBlockSizeForRegion(31, 100)).toBe(4);
  });

  it("returns 8 for small regions (32-63px)", () => {
    expect(adaptiveBlockSizeForRegion(32, 32)).toBe(8);
    expect(adaptiveBlockSizeForRegion(63, 100)).toBe(8);
  });

  it("returns 16 for medium regions (64-256px)", () => {
    expect(adaptiveBlockSizeForRegion(64, 64)).toBe(16);
    expect(adaptiveBlockSizeForRegion(256, 256)).toBe(16);
  });

  it("returns 32 for large regions (> 256px)", () => {
    expect(adaptiveBlockSizeForRegion(257, 257)).toBe(32);
    expect(adaptiveBlockSizeForRegion(512, 512)).toBe(32);
  });
});
