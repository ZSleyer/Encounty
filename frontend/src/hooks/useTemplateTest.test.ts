import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { MatchedRegion } from "../types";

// Mock the math functions to return controlled scores
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockScoreRegionHybrid = vi.fn((..._args: any[]) => 0.85);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockAndLogicAcrossRegions = vi.fn((...args: any[]) => {
  const scores = args[0] as number[];
  return scores.length > 0 ? Math.min(...scores) : 0;
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockAdaptiveBlockSizeForRegion = vi.fn((..._args: any[]) => 16);

vi.mock("../engine/math", () => ({
  scoreRegionHybrid: (...args: unknown[]) => mockScoreRegionHybrid(...args),
  andLogicAcrossRegions: (...args: unknown[]) => mockAndLogicAcrossRegions(...args),
  adaptiveBlockSizeForRegion: (...args: unknown[]) => mockAdaptiveBlockSizeForRegion(...args),
}));

import { useTemplateTest } from "./useTemplateTest";

// --- Test helpers ---

/** Create a mock HTMLCanvasElement with controllable pixel data. */
function mockCanvas(width: number, height: number): HTMLCanvasElement {
  const pixels = new Uint8ClampedArray(width * height * 4).fill(128);
  return {
    width,
    height,
    getContext: () => ({
      getImageData: () => ({ data: pixels, width, height }),
    }),
  } as unknown as HTMLCanvasElement;
}

/** Create a mock ImageData object with uniform pixel data. */
function mockImageData(w: number, h: number): ImageData {
  return {
    data: new Uint8ClampedArray(w * h * 4).fill(100),
    width: w,
    height: h,
  } as ImageData;
}

/** Build a simple MatchedRegion for testing. */
function makeRegion(
  x: number,
  y: number,
  w: number,
  h: number,
): MatchedRegion {
  return {
    type: "image",
    expected_text: "",
    rect: { x, y, w, h },
  };
}

// --- Mocking requestIdleCallback ---

/**
 * Synchronous requestIdleCallback stub.
 * Collects callbacks and flushes them on demand.
 */
let idleCallbacks: ((deadline: IdleDeadline) => void)[] = [];

function flushIdleCallbacks() {
  // Process all queued callbacks until none remain (callbacks may enqueue more)
  while (idleCallbacks.length > 0) {
    const batch = [...idleCallbacks];
    idleCallbacks = [];
    for (const cb of batch) {
      cb({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
    }
  }
}

// --- Test suite ---

describe("useTemplateTest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    idleCallbacks = [];

    // Stub requestIdleCallback to capture callbacks for manual flushing
    vi.stubGlobal(
      "requestIdleCallback",
      (cb: (deadline: IdleDeadline) => void) => {
        idleCallbacks.push(cb);
        return idleCallbacks.length;
      },
    );
    vi.stubGlobal("cancelIdleCallback", vi.fn());
  });

  // --- scoreFrame ---

  describe("scoreFrame", () => {
    it("returns correct structure with overallScore and regionScores", () => {
      const canvas = mockCanvas(100, 100);
      const frame = mockImageData(100, 100);
      const regions = [makeRegion(0, 0, 50, 50), makeRegion(50, 0, 50, 50)];

      const { result } = renderHook(() => useTemplateTest());

      let score: ReturnType<typeof result.current.scoreFrame>;
      act(() => {
        score = result.current.scoreFrame(canvas, regions, frame);
      });

      expect(score!).toBeDefined();
      expect(score!).toHaveProperty("frameIndex", 0);
      expect(score!).toHaveProperty("overallScore");
      expect(score!.regionScores).toHaveLength(2);
      expect(score!.regionScores[0]).toHaveProperty("index", 0);
      expect(score!.regionScores[0]).toHaveProperty("score", 0.85);
      expect(score!.regionScores[1]).toHaveProperty("index", 1);
      expect(score!.regionScores[1]).toHaveProperty("score", 0.85);
      // andLogicAcrossRegions is called with [0.85, 0.85], returns min = 0.85
      expect(score!.overallScore).toBe(0.85);
    });

    it("caches template grayscale when the same canvas ref is reused", () => {
      const canvas = mockCanvas(64, 64);
      const frame1 = mockImageData(64, 64);
      const frame2 = mockImageData(64, 64);
      const regions = [makeRegion(0, 0, 32, 32)];

      const { result } = renderHook(() => useTemplateTest());

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const getContextSpy = vi.spyOn(canvas as any, "getContext");

      act(() => {
        result.current.scoreFrame(canvas, regions, frame1);
      });
      act(() => {
        result.current.scoreFrame(canvas, regions, frame2);
      });

      // getContext should only be called once because the second call uses cache
      expect(getContextSpy).toHaveBeenCalledTimes(1);
    });
  });

  // --- runBatch ---

  describe("runBatch", () => {
    it("processes frames and populates batchResults", () => {
      const canvas = mockCanvas(100, 100);
      const regions = [makeRegion(0, 0, 50, 50)];
      // 20 frames total, sampled every 5th => indices 0, 5, 10, 15
      const getFrame = vi.fn((_i: number) => mockImageData(100, 100));

      const { result } = renderHook(() => useTemplateTest());

      act(() => {
        result.current.runBatch(canvas, regions, getFrame, 20);
      });
      act(() => {
        flushIdleCallbacks();
      });

      expect(result.current.isRunning).toBe(false);
      expect(result.current.batchResults.size).toBe(4);
      expect(result.current.batchResults.has(0)).toBe(true);
      expect(result.current.batchResults.has(5)).toBe(true);
      expect(result.current.batchResults.has(10)).toBe(true);
      expect(result.current.batchResults.has(15)).toBe(true);
    });

    it("samples every 5th frame", () => {
      const canvas = mockCanvas(100, 100);
      const regions = [makeRegion(0, 0, 50, 50)];
      const getFrame = vi.fn((_i: number) => mockImageData(100, 100));

      const { result } = renderHook(() => useTemplateTest());

      act(() => {
        result.current.runBatch(canvas, regions, getFrame, 30);
      });
      act(() => {
        flushIdleCallbacks();
      });

      // Frame indices 0, 5, 10, 15, 20, 25 => 6 sampled frames
      const calledIndices = getFrame.mock.calls.map(
        (call: [number]) => call[0],
      );
      expect(calledIndices).toEqual([0, 5, 10, 15, 20, 25]);
    });

    it("sets progress to 1 when complete", () => {
      const canvas = mockCanvas(50, 50);
      const regions = [makeRegion(0, 0, 25, 25)];
      const getFrame = vi.fn(() => mockImageData(50, 50));

      const { result } = renderHook(() => useTemplateTest());

      act(() => {
        result.current.runBatch(canvas, regions, getFrame, 10);
      });
      act(() => {
        flushIdleCallbacks();
      });

      expect(result.current.progress).toBe(1);
      expect(result.current.isRunning).toBe(false);
    });
  });

  // --- cancel ---

  describe("cancel", () => {
    it("stops a running batch", () => {
      const canvas = mockCanvas(100, 100);
      const regions = [makeRegion(0, 0, 50, 50)];
      const getFrame = vi.fn(() => mockImageData(100, 100));

      // Use a large frame count so the batch requires multiple chunks
      const { result } = renderHook(() => useTemplateTest());

      act(() => {
        result.current.runBatch(canvas, regions, getFrame, 200);
      });

      // Flush one chunk (CHUNK_SIZE = 4 frames) then cancel before the rest
      act(() => {
        const batch = [...idleCallbacks];
        idleCallbacks = [];
        for (const cb of batch) {
          cb({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
        }
      });

      act(() => {
        result.current.cancel();
      });

      // Flush remaining callbacks — they should bail out early
      act(() => {
        flushIdleCallbacks();
      });

      expect(result.current.isRunning).toBe(false);
      // Should not have processed all 40 sampled frames (200/5)
      expect(result.current.batchResults.size).toBeLessThan(40);
    });
  });

  // --- bestScore ---

  describe("bestScore", () => {
    it("tracks the best overall score from batch", () => {
      // Return ascending scores so the best is the last one processed
      let callCount = 0;
      mockScoreRegionHybrid.mockImplementation(() => {
        callCount++;
        return callCount * 0.1;
      });
      mockAndLogicAcrossRegions.mockImplementation(
        (scores: number[]) => Math.min(...scores),
      );

      const canvas = mockCanvas(100, 100);
      const regions = [makeRegion(0, 0, 50, 50)];
      const getFrame = vi.fn(() => mockImageData(100, 100));

      const { result } = renderHook(() => useTemplateTest());

      act(() => {
        result.current.runBatch(canvas, regions, getFrame, 15);
      });
      act(() => {
        flushIdleCallbacks();
      });

      // 3 frames sampled (0, 5, 10), scores: 0.1, 0.2, 0.3
      expect(result.current.bestScore).toBeCloseTo(0.3);
    });
  });

  // --- Edge cases ---

  describe("edge cases", () => {
    it("handles empty regions array", () => {
      const canvas = mockCanvas(50, 50);
      const frame = mockImageData(50, 50);

      const { result } = renderHook(() => useTemplateTest());

      let score: ReturnType<typeof result.current.scoreFrame>;
      act(() => {
        score = result.current.scoreFrame(canvas, [], frame);
      });

      // andLogicAcrossRegions called with empty array
      expect(score!).toBeDefined();
      expect(score!.regionScores).toHaveLength(0);
      expect(mockAndLogicAcrossRegions).toHaveBeenCalledWith([]);
    });

    it("handles 0 frame count in runBatch", () => {
      const canvas = mockCanvas(50, 50);
      const regions = [makeRegion(0, 0, 25, 25)];
      const getFrame = vi.fn(() => mockImageData(50, 50));

      const { result } = renderHook(() => useTemplateTest());

      act(() => {
        result.current.runBatch(canvas, regions, getFrame, 0);
      });

      // Should immediately complete with no results
      expect(result.current.isRunning).toBe(false);
      expect(result.current.progress).toBe(1);
      expect(result.current.batchResults.size).toBe(0);
      expect(getFrame).not.toHaveBeenCalled();
    });
  });
});
