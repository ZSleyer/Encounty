/**
 * ocrPreprocess.test.ts: Unit tests for the pure OCR preprocessing helpers
 * (Otsu threshold, inversion decision, binarization) using synthetic arrays.
 */
import { describe, expect, it, vi } from "vitest";
import {
  binarize,
  otsuThreshold,
  preprocessForOCR,
  shouldInvert,
} from "./ocrPreprocess";

/** Build a bimodal grayscale array with the given counts per mode value. */
function bimodal(darkValue: number, darkCount: number, lightValue: number, lightCount: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(darkCount + lightCount);
  out.fill(darkValue, 0, darkCount);
  out.fill(lightValue, darkCount);
  return out;
}

describe("otsuThreshold", () => {
  it("separates the two modes of a bimodal histogram", () => {
    const gray = bimodal(40, 100, 200, 100);
    const threshold = otsuThreshold(gray);
    expect(threshold).toBeGreaterThanOrEqual(40);
    expect(threshold).toBeLessThan(200);
    // Every dark pixel classified as background, every light one as text
    expect(gray.filter((v) => v <= threshold).length).toBe(100);
  });

  it("handles a uniform image without throwing", () => {
    const gray = new Uint8ClampedArray(64).fill(128);
    expect(() => otsuThreshold(gray)).not.toThrow();
  });
});

describe("shouldInvert", () => {
  it("returns true for light text on a dark background", () => {
    // 90% dark background, 10% light glyph pixels
    const gray = bimodal(20, 90, 230, 10);
    expect(shouldInvert(gray, otsuThreshold(gray))).toBe(true);
  });

  it("returns false for dark text on a light background", () => {
    const gray = bimodal(20, 10, 230, 90);
    expect(shouldInvert(gray, otsuThreshold(gray))).toBe(false);
  });
});

describe("binarize", () => {
  it("outputs only 0 and 255", () => {
    const gray = bimodal(40, 8, 200, 8);
    const out = binarize(gray, 128, false);
    expect([...out].every((v) => v === 0 || v === 255)).toBe(true);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(255);
  });

  it("inversion flips black and white", () => {
    const gray = bimodal(40, 8, 200, 8);
    const plain = binarize(gray, 128, false);
    const flipped = binarize(gray, 128, true);
    for (let i = 0; i < plain.length; i++) {
      expect(flipped[i]).toBe(255 - plain[i]);
    }
  });
});

describe("preprocessForOCR", () => {
  it("returns the source unchanged when no 2d context is available", () => {
    const source = document.createElement("canvas");
    source.width = 10;
    source.height = 5;
    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(null);
    try {
      expect(preprocessForOCR(source)).toBe(source);
    } finally {
      spy.mockRestore();
    }
  });
});
