/**
 * Unit tests for regionDelta.ts: region gray extraction and snapshot deltas
 * used by the region-based hysteresis mode.
 */
import { describe, it, expect, vi } from "vitest";
import { extractRegionGrays, regionSetDelta, type RegionGray } from "./regionDelta";

// --- Helpers -----------------------------------------------------------------

/** Build a RegionGray with every pixel set to the given [0, 1] value. */
function uniformRegion(value: number, width = 8, height = 8): RegionGray {
  const data = new Float32Array(width * height).fill(value);
  return { data, width, height };
}

/** Create a fake video element exposing only the dimensions the extractor reads. */
function fakeVideo(videoWidth: number, videoHeight: number): HTMLVideoElement {
  return { videoWidth, videoHeight } as HTMLVideoElement;
}

/**
 * Create a mocked 2d context whose getImageData returns pixels of a single
 * RGBA color, plus spies on drawImage/getImageData for call assertions.
 */
function mockContext(rgb: [number, number, number]) {
  const drawImage = vi.fn();
  const getImageData = vi.fn((_x: number, _y: number, w: number, h: number) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = rgb[0];
      data[i * 4 + 1] = rgb[1];
      data[i * 4 + 2] = rgb[2];
      data[i * 4 + 3] = 255;
    }
    return { data, width: w, height: h } as ImageData;
  });
  return { drawImage, getImageData };
}

/** Create a canvas whose getContext returns the given mocked context (or null). */
function canvasWithContext(ctx: unknown): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  vi.spyOn(canvas, "getContext").mockReturnValue(ctx as never);
  return canvas;
}

// --- regionSetDelta ------------------------------------------------------------

describe("regionSetDelta", () => {
  it("returns 0 for identical region sets", () => {
    const a = [uniformRegion(0.3), uniformRegion(0.8)];
    const b = [uniformRegion(0.3), uniformRegion(0.8)];
    expect(regionSetDelta(a, b)).toBe(0);
  });

  it("returns a high delta for fully different content", () => {
    const a = [uniformRegion(0)];
    const b = [uniformRegion(1)];
    expect(regionSetDelta(a, b)).toBeGreaterThan(0.9);
  });

  it("averages the per-region deltas", () => {
    // One identical pair (delta 0) and one fully different pair (delta 1).
    const a = [uniformRegion(0.5), uniformRegion(0)];
    const b = [uniformRegion(0.5), uniformRegion(1)];
    expect(regionSetDelta(a, b)).toBeCloseTo(0.5, 5);
  });

  it("returns 1 (fail open) on mismatched region counts", () => {
    expect(regionSetDelta([uniformRegion(0.5)], [uniformRegion(0.5), uniformRegion(0.5)])).toBe(1);
  });

  it("returns 1 (fail open) on empty region sets", () => {
    expect(regionSetDelta([], [])).toBe(1);
  });

  it("returns 1 (fail open) on mismatched region dimensions", () => {
    expect(regionSetDelta([uniformRegion(0.5, 8, 8)], [uniformRegion(0.5, 4, 4)])).toBe(1);
  });
});

// --- extractRegionGrays ----------------------------------------------------------

describe("extractRegionGrays", () => {
  const templateDims = { width: 960, height: 540 };
  const rect = { x: 10, y: 20, w: 100, h: 50 };

  it("returns null when the 2d context is unavailable", () => {
    const canvas = canvasWithContext(null);
    expect(extractRegionGrays(fakeVideo(1920, 1080), templateDims, [rect], canvas)).toBeNull();
  });

  it("returns null when the video has no dimensions", () => {
    const canvas = canvasWithContext(mockContext([0, 0, 0]));
    expect(extractRegionGrays(fakeVideo(0, 0), templateDims, [rect], canvas)).toBeNull();
  });

  it("returns null when a rect is degenerate", () => {
    const canvas = canvasWithContext(mockContext([0, 0, 0]));
    const degenerate = { x: 10, y: 20, w: 0, h: 50 };
    expect(
      extractRegionGrays(fakeVideo(1920, 1080), templateDims, [rect, degenerate], canvas),
    ).toBeNull();
  });

  it("returns null when a rect lies fully outside the video bounds", () => {
    const canvas = canvasWithContext(mockContext([0, 0, 0]));
    const outside = { x: 2000, y: 20, w: 100, h: 50 };
    expect(extractRegionGrays(fakeVideo(1920, 1080), templateDims, [outside], canvas)).toBeNull();
  });

  it("scales rects from template coordinates to video coordinates for drawImage", () => {
    // Video is exactly 2x the template dimensions, so the source rect passed
    // to drawImage must be the template rect scaled by 2 on both axes.
    const ctx = mockContext([255, 0, 0]);
    const canvas = canvasWithContext(ctx);
    const video = fakeVideo(1920, 1080);

    const result = extractRegionGrays(video, templateDims, [rect], canvas);

    expect(result).not.toBeNull();
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    // Source rect: (10*2, 20*2, 100*2, 50*2); destination fits maxDim=64,
    // so 200x100 downscales by 64/200 to 64x32.
    expect(ctx.drawImage).toHaveBeenCalledWith(video, 20, 40, 200, 100, 0, 0, 64, 32);
    expect(result![0].width).toBe(64);
    expect(result![0].height).toBe(32);
    expect(result![0].data.length).toBe(64 * 32);
  });

  it("converts pixels to BT.601 grayscale normalized to [0, 1]", () => {
    const ctx = mockContext([100, 150, 200]);
    const canvas = canvasWithContext(ctx);

    const result = extractRegionGrays(fakeVideo(1920, 1080), templateDims, [rect], canvas);

    expect(result).not.toBeNull();
    const expected = (0.299 * 100 + 0.587 * 150 + 0.114 * 200) / 255;
    expect(result![0].data[0]).toBeCloseTo(expected, 5);
    expect(result![0].data[result![0].data.length - 1]).toBeCloseTo(expected, 5);
  });

  it("keeps small regions at their native size instead of upscaling", () => {
    // A 40x30 template rect at 1:1 video scale fits within maxDim=64 and must
    // not be inflated (upscaling would fabricate pixels).
    const ctx = mockContext([255, 255, 255]);
    const canvas = canvasWithContext(ctx);
    const video = fakeVideo(960, 540);

    const result = extractRegionGrays(video, templateDims, [{ x: 0, y: 0, w: 40, h: 30 }], canvas);

    expect(result).not.toBeNull();
    expect(result![0].width).toBe(40);
    expect(result![0].height).toBe(30);
    // Pure white maps to 1.0.
    expect(result![0].data[0]).toBeCloseTo(1, 5);
  });
});
