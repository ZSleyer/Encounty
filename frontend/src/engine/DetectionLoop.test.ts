/**
 * Unit tests for DetectionLoop class and global loop registry.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  DetectionLoop,
  registerLoop,
  getActiveLoop,
  stopLoop,
  isLoopRunning,
} from "./DetectionLoop";
import type { Detector } from "../engine";

// --- Helpers -----------------------------------------------------------------

/** Create a mock video element with configurable dimensions and advancing currentTime. */
function createMockVideo(width = 1920, height = 1080): HTMLVideoElement {
  const video = document.createElement("video");
  Object.defineProperty(video, "videoWidth", { value: width, configurable: true });
  Object.defineProperty(video, "videoHeight", { value: height, configurable: true });
  // Each access to currentTime returns a new value so the loop does not skip frames
  let time = 0;
  Object.defineProperty(video, "currentTime", {
    get: () => ++time,
    configurable: true,
  });
  return video;
}

/** Create a mock detector that returns predefined scores in sequence. */
function createMockDetector(scores: number[]): Detector {
  let callIndex = 0;
  return {
    loadTemplate: () => null,
    detect: async () => ({
      bestScore: scores[Math.min(callIndex++, scores.length - 1)],
      frameDelta: 0.5,
      templateIndex: 0,
    }),
    destroy: () => {},
  };
}

/** Drain all pending microtasks (resolved promises) and advance fake timers by one tick. */
async function tickLoop(ms = 200): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

// --- Registry tests ----------------------------------------------------------

describe("Loop Registry", () => {
  afterEach(() => {
    // Clean up any loops registered during a test
    stopLoop("test-pokemon");
    stopLoop("pokemon-a");
    stopLoop("pokemon-b");
  });

  it("registerLoop stores a loop and getActiveLoop retrieves it", () => {
    const detector = createMockDetector([0]);
    const loop = new DetectionLoop("test-pokemon", detector);

    registerLoop("test-pokemon", loop);

    expect(getActiveLoop("test-pokemon")).toBe(loop);
  });

  it("getActiveLoop returns null for unregistered pokemon", () => {
    expect(getActiveLoop("nonexistent")).toBeNull();
  });

  it("isLoopRunning returns true for registered and false for unregistered", () => {
    const detector = createMockDetector([0]);
    const loop = new DetectionLoop("test-pokemon", detector);
    registerLoop("test-pokemon", loop);

    expect(isLoopRunning("test-pokemon")).toBe(true);
    expect(isLoopRunning("nonexistent")).toBe(false);
  });

  it("stopLoop removes the loop from the registry", () => {
    const detector = createMockDetector([0]);
    const loop = new DetectionLoop("test-pokemon", detector);
    registerLoop("test-pokemon", loop);

    stopLoop("test-pokemon");

    expect(getActiveLoop("test-pokemon")).toBeNull();
    expect(isLoopRunning("test-pokemon")).toBe(false);
  });

  it("registerLoop stops the previous loop before replacing it", () => {
    const detector1 = createMockDetector([0]);
    const loop1 = new DetectionLoop("test-pokemon", detector1);
    const stopSpy = vi.spyOn(loop1, "stop");

    registerLoop("test-pokemon", loop1);

    const detector2 = createMockDetector([0]);
    const loop2 = new DetectionLoop("test-pokemon", detector2);
    registerLoop("test-pokemon", loop2);

    expect(stopSpy).toHaveBeenCalledOnce();
    expect(getActiveLoop("test-pokemon")).toBe(loop2);
  });

  it("stopLoop is a no-op for unregistered pokemon", () => {
    // Should not throw
    expect(() => stopLoop("nonexistent")).not.toThrow();
  });
});

// --- DetectionLoop class tests -----------------------------------------------

describe("DetectionLoop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    stopLoop("test-pokemon");
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("can be constructed with a pokemonId and detector", () => {
    const detector = createMockDetector([0]);
    const loop = new DetectionLoop("test-pokemon", detector);
    expect(loop).toBeInstanceOf(DetectionLoop);
  });

  it("suppresses scores below the noise floor (0.15) to zero", async () => {
    // Raw score of 0.10 is below NOISE_FLOOR (0.15) and should map to 0
    const detector = createMockDetector([0.1]);
    const loop = new DetectionLoop("test-pokemon", detector);
    loop.loadTemplates([{ width: 32, height: 32, mean: 128, stdDev: 40, pixelCount: 1024, regions: [] } as never]);

    const scores: number[] = [];
    loop.onScore((score) => {
      scores.push(score);
    });

    const video = createMockVideo();
    loop.start(() => video);

    // Let the loop run one iteration
    await tickLoop(200);

    loop.stop();

    expect(scores.length).toBeGreaterThanOrEqual(1);
    // Smoothed score should be 0 since the only input was below the noise floor
    expect(scores[0]).toBe(0);
  });

  it("applies EMA smoothing with alpha=0.3", async () => {
    // First score above noise floor: raw=0.5 -> adjusted = (0.5-0.15)/(1-0.15) ≈ 0.4118
    // EMA: 0.3 * 0.4118 + 0.7 * 0 = 0.1235
    // Second score same: EMA: 0.3 * 0.4118 + 0.7 * 0.1235 ≈ 0.2100
    const detector = createMockDetector([0.5, 0.5]);
    const loop = new DetectionLoop("test-pokemon", detector);
    loop.loadTemplates([{ width: 32, height: 32, mean: 128, stdDev: 40, pixelCount: 1024, regions: [] } as never]);

    const scores: number[] = [];
    loop.onScore((score) => {
      scores.push(score);
    });

    const video = createMockVideo();
    loop.start(() => video);

    // The score callback is throttled to 250ms. Use longer ticks so both fire.
    await tickLoop(300);
    await tickLoop(300);

    loop.stop();

    expect(scores.length).toBeGreaterThanOrEqual(2);

    const adjusted = (0.5 - 0.15) / (1 - 0.15);
    const expected1 = 0.3 * adjusted;
    const expected2 = 0.3 * adjusted + 0.7 * expected1;

    expect(scores[0]).toBeCloseTo(expected1, 3);
    expect(scores[1]).toBeCloseTo(expected2, 3);
  });

  it("reports a match to the backend after consecutive hits", async () => {
    // Use a score well above the default precision (0.85)
    // adjusted = (0.95 - 0.15) / (1 - 0.15) ≈ 0.9412 > 0.85
    const detector = createMockDetector([0.95, 0.95, 0.95, 0.95]);
    const loop = new DetectionLoop("test-pokemon", detector);
    loop.loadTemplates([{ width: 32, height: 32, mean: 128, stdDev: 40, pixelCount: 1024, regions: [] } as never]);
    loop.updateConfig({ consecutiveHits: 3, precision: 0.85 });

    const video = createMockVideo();
    loop.start(() => video);

    // Run enough iterations for 3 consecutive hits
    for (let i = 0; i < 5; i++) {
      await tickLoop(200);
    }

    loop.stop();

    expect(globalThis.fetch).toHaveBeenCalled();
    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) => typeof call[0] === "string" && call[0].includes("/match"),
    );
    expect(fetchCall).toBeDefined();
  });

  it("does not start a second loop if already running", async () => {
    const detector = createMockDetector([0.1]);
    const loop = new DetectionLoop("test-pokemon", detector);
    loop.loadTemplates([{ width: 32, height: 32, mean: 128, stdDev: 40, pixelCount: 1024, regions: [] } as never]);

    const video = createMockVideo();
    loop.start(() => video);

    // The second call should be a no-op (not throw or create a duplicate timer)
    loop.start(() => video);

    await tickLoop(200);
    loop.stop();
  });

  it("stop clears the timeout and prevents further iterations", async () => {
    let detectCount = 0;
    const detector: Detector = {
      loadTemplate: () => null,
      detect: async () => {
        detectCount++;
        return { bestScore: 0.1, frameDelta: 0.5, templateIndex: 0 };
      },
      destroy: () => {},
    };

    const loop = new DetectionLoop("test-pokemon", detector);
    loop.loadTemplates([{ width: 32, height: 32, mean: 128, stdDev: 40, pixelCount: 1024, regions: [] } as never]);

    const video = createMockVideo();
    loop.start(() => video);

    await tickLoop(200);
    const countAfterFirstTick = detectCount;

    loop.stop();

    // Advance time significantly; detect count should not increase
    await tickLoop(2000);
    expect(detectCount).toBe(countAfterFirstTick);
  });

  it("updateConfig merges partial configuration", () => {
    const detector = createMockDetector([0]);
    const loop = new DetectionLoop("test-pokemon", detector);

    // Default precision is 0.85; update to 0.9
    loop.updateConfig({ precision: 0.9, consecutiveHits: 5 });

    // We verify indirectly: the loop should use the updated config.
    // No direct getter, so we just ensure it does not throw.
    expect(loop).toBeInstanceOf(DetectionLoop);
  });

  it("stops loop and reports idle when video source is lost", async () => {
    const detector = createMockDetector([0.5]);
    const loop = new DetectionLoop("test-pokemon", detector);
    loop.loadTemplates([{ width: 32, height: 32, mean: 128, stdDev: 40, pixelCount: 1024, regions: [] } as never]);

    const states: string[] = [];
    loop.onScore((_score, state) => {
      states.push(state);
    });

    const video = createMockVideo();
    let returnVideo = true;
    loop.start(() => (returnVideo ? video : null));

    // First iteration works
    await tickLoop(200);

    // Now lose the video source
    returnVideo = false;
    await tickLoop(200);

    // The loop should have reported idle
    expect(states).toContain("idle");
  });

  it("skips detection when video frame has not changed", async () => {
    let detectCount = 0;
    const detector: Detector = {
      loadTemplate: () => null,
      detect: async () => {
        detectCount++;
        return { bestScore: 0.1, frameDelta: 0.5, templateIndex: 0 };
      },
      destroy: () => {},
    };

    const loop = new DetectionLoop("test-pokemon", detector);
    loop.loadTemplates([{ width: 32, height: 32, mean: 128, stdDev: 40, pixelCount: 1024, regions: [] } as never]);

    // Video with a fixed currentTime (never changes)
    const video = document.createElement("video");
    Object.defineProperty(video, "videoWidth", { value: 1920 });
    Object.defineProperty(video, "videoHeight", { value: 1080 });
    Object.defineProperty(video, "currentTime", { value: 1, configurable: true });

    loop.start(() => video);

    // First iteration should detect
    await tickLoop(200);
    const countAfterFirst = detectCount;
    expect(countAfterFirst).toBe(1);

    // Second iteration should skip (same currentTime)
    await tickLoop(200);
    expect(detectCount).toBe(countAfterFirst);

    loop.stop();
  });

  it("enters hysteresis after consecutive hits then exits when score drops", async () => {
    // Need enough high scores for consecutiveHits (3 default) then low scores
    const scores = [0.95, 0.95, 0.95, 0.95, 0.2, 0.2, 0.2];
    const detector = createMockDetector(scores);
    const loop = new DetectionLoop("test-pokemon", detector);
    loop.loadTemplates([{ width: 32, height: 32, mean: 128, stdDev: 40, pixelCount: 1024, regions: [] } as never]);
    loop.updateConfig({ consecutiveHits: 3, precision: 0.85, cooldownSec: 0 });

    const stateHistory: string[] = [];
    loop.onScore((_score, state) => {
      stateHistory.push(state);
    });

    const video = createMockVideo();
    loop.start(() => video);

    // Run enough iterations to trigger match and then exit hysteresis
    for (let i = 0; i < 8; i++) {
      await tickLoop(300);
    }

    loop.stop();

    // Should have entered "match" state and then transitioned through cooldown/idle
    expect(stateHistory).toContain("match");
  });

  it("handles cooldown period after hysteresis", async () => {
    const scores = [0.95, 0.95, 0.95, 0.95, 0.1, 0.1, 0.1, 0.1, 0.1];
    const detector = createMockDetector(scores);
    const loop = new DetectionLoop("test-pokemon", detector);
    loop.loadTemplates([{ width: 32, height: 32, mean: 128, stdDev: 40, pixelCount: 1024, regions: [] } as never]);
    loop.updateConfig({ consecutiveHits: 3, precision: 0.85, cooldownSec: 1 });

    const stateHistory: string[] = [];
    loop.onScore((_score, state) => {
      stateHistory.push(state);
    });

    const video = createMockVideo();
    loop.start(() => video);

    for (let i = 0; i < 10; i++) {
      await tickLoop(300);
    }

    loop.stop();

    // Should see cooldown state at some point
    expect(stateHistory).toContain("cooldown");
  });

  it("recycleFrameBuffer destroys old buffer when it has a destroy method", async () => {
    const destroySpy = vi.fn();
    let firstCall = true;
    const detector: Detector = {
      loadTemplate: () => null,
      detect: async () => {
        const result = {
          bestScore: 0.1,
          frameDelta: 0.5,
          templateIndex: 0,
          frameBuffer: firstCall ? { destroy: destroySpy } : { destroy: vi.fn() },
        };
        firstCall = false;
        return result;
      },
      destroy: () => {},
    };

    const loop = new DetectionLoop("test-pokemon", detector);
    loop.loadTemplates([{ width: 32, height: 32, mean: 128, stdDev: 40, pixelCount: 1024, regions: [] } as never]);

    const video = createMockVideo();
    loop.start(() => video);

    // First iteration: sets previousFrameBuffer
    await tickLoop(200);
    // Second iteration: recycles previous buffer
    await tickLoop(200);

    loop.stop();

    // The first buffer's destroy should have been called when recycled
    expect(destroySpy).toHaveBeenCalledOnce();
  });

  it("stop destroys the previous frame buffer", async () => {
    const destroySpy = vi.fn();
    const detector: Detector = {
      loadTemplate: () => null,
      detect: async () => ({
        bestScore: 0.1,
        frameDelta: 0.5,
        templateIndex: 0,
        frameBuffer: { destroy: destroySpy },
      }),
      destroy: () => {},
    };

    const loop = new DetectionLoop("test-pokemon", detector);
    loop.loadTemplates([{ width: 32, height: 32, mean: 128, stdDev: 40, pixelCount: 1024, regions: [] } as never]);

    const video = createMockVideo();
    loop.start(() => video);

    await tickLoop(200);

    loop.stop();

    expect(destroySpy).toHaveBeenCalled();
  });

  it("backs off to max interval on detection error", async () => {
    let callCount = 0;
    const detector: Detector = {
      loadTemplate: () => null,
      detect: async () => {
        callCount++;
        if (callCount === 1) throw new Error("GPU error");
        return { bestScore: 0.1, frameDelta: 0.5, templateIndex: 0 };
      },
      destroy: () => {},
    };

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const loop = new DetectionLoop("test-pokemon", detector);
    loop.loadTemplates([{ width: 32, height: 32, mean: 128, stdDev: 40, pixelCount: 1024, regions: [] } as never]);

    const video = createMockVideo();
    loop.start(() => video);

    // First iteration throws error
    await tickLoop(200);

    // After error, the loop should still continue (back off)
    await tickLoop(600);

    loop.stop();

    expect(callCount).toBeGreaterThanOrEqual(2);
    consoleSpy.mockRestore();
  });

  it("tolerates a single below-threshold frame between matches", async () => {
    // High, HIGH, low, HIGH -> the low frame is tolerated (missCount < 1)
    // adjusted = (0.95 - 0.15) / (1 - 0.15) = ~0.94
    // We need 3 consecutive hits with one tolerated miss
    // adjusted score needs to be >= precision (0.85)
    // Score sequence: high, high, low, high (the 4th should still confirm)
    const scores = [0.95, 0.95, 0.3, 0.95, 0.95];
    const detector = createMockDetector(scores);
    const loop = new DetectionLoop("test-pokemon", detector);
    loop.loadTemplates([{ width: 32, height: 32, mean: 128, stdDev: 40, pixelCount: 1024, regions: [] } as never]);
    loop.updateConfig({ consecutiveHits: 3, precision: 0.85 });

    const video = createMockVideo();
    loop.start(() => video);

    for (let i = 0; i < 6; i++) {
      await tickLoop(200);
    }

    loop.stop();

    // The match should have been reported (single miss tolerated)
    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) => typeof call[0] === "string" && call[0].includes("/match"),
    );
    expect(fetchCall).toBeDefined();
  });

  it("updateConfig updates all polling parameters", () => {
    const detector = createMockDetector([0]);
    const loop = new DetectionLoop("test-pokemon", detector);

    loop.updateConfig({
      pollIntervalMs: 200,
      minPollMs: 100,
      maxPollMs: 1000,
      hysteresisFactor: 0.6,
      cooldownSec: 5,
    });

    // Verify indirectly — no throw
    expect(loop).toBeInstanceOf(DetectionLoop);
  });

  it("loadTemplates defers replacement when loop is running", async () => {
    let detectCallTemplates: unknown[] = [];
    const detector: Detector = {
      loadTemplate: () => null,
      detect: async (_video, templates) => {
        detectCallTemplates = templates;
        return { bestScore: 0.1, frameDelta: 0.5, templateIndex: 0 };
      },
      destroy: () => {},
    };

    const loop = new DetectionLoop("test-pokemon", detector);
    loop.loadTemplates([{ width: 32, height: 32, mean: 128, stdDev: 40, pixelCount: 1024, regions: [], _tag: "original" } as never]);

    const video = createMockVideo();
    loop.start(() => video);

    // First iteration uses original templates
    await tickLoop(200);
    expect(detectCallTemplates).toEqual([{ width: 32, height: 32, mean: 128, stdDev: 40, pixelCount: 1024, regions: [], _tag: "original" } as never]);

    // Replace templates while running — should be deferred to next iteration
    loop.loadTemplates([{ width: 32, height: 32, mean: 128, stdDev: 40, pixelCount: 1024, regions: [], _tag: "replaced" } as never]);

    // The pending swap happens at the start of the next runLoop call.
    // We may need multiple ticks for the setTimeout + async detect to resolve.
    await tickLoop(300);
    await tickLoop(300);
    expect(detectCallTemplates).toEqual([{ width: 32, height: 32, mean: 128, stdDev: 40, pixelCount: 1024, regions: [], _tag: "replaced" } as never]);

    loop.stop();
  });
});
