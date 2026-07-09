/**
 * startDetection.test.ts — Tests for the detection loop lifecycle helpers
 * in startDetection.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the engine module (WebGPUDetector, CPUDetector, WorkerDetector)
// CPUDetector needs to be a constructable class with a static isAvailable method
vi.mock("../engine", () => {
  class MockCPUDetector {
    static readonly isAvailable = vi.fn(() => false);
    loadTemplate = vi.fn().mockReturnValue({ data: "cpu-template" });
    detect = vi.fn();
    destroy = vi.fn();
  }

  return {
    WebGPUDetector: {
      create: vi.fn(),
    },
    CPUDetector: MockCPUDetector,
    WorkerDetector: {
      isAvailable: vi.fn(() => false),
      create: vi.fn(),
    },
  };
});

// Mock DetectionLoop module — use vi.hoisted so references are available in factory
const {
  mockStart, mockLoadTemplates, mockUpdateConfig, mockOnScore, mockStop, loops,
} = vi.hoisted(() => ({
  mockStart: vi.fn(),
  mockLoadTemplates: vi.fn(),
  mockUpdateConfig: vi.fn(),
  mockOnScore: vi.fn(),
  mockStop: vi.fn(),
  loops: new Map<string, unknown>(),
}));

vi.mock("./DetectionLoop", () => {
  // Define class inside factory so it's available when hoisted
  class MockDetectionLoop {
    start = mockStart;
    loadTemplates = mockLoadTemplates;
    updateConfig = mockUpdateConfig;
    onScore = mockOnScore;
    stop = mockStop;
  }
  return {
    DetectionLoop: MockDetectionLoop,
    registerLoop: vi.fn((id: string, loop: unknown) => loops.set(id, loop)),
    stopLoop: vi.fn((id: string) => {
      const loop = loops.get(id);
      if (loop && typeof (loop as { stop: () => void }).stop === "function") {
        (loop as { stop: () => void }).stop();
      }
      loops.delete(id);
    }),
    getActiveLoop: vi.fn((id: string) => loops.get(id) ?? null),
  };
});

// Mock createImageBitmap globally
const mockBitmap = { close: vi.fn(), width: 64, height: 64 };
vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(mockBitmap));

import { WebGPUDetector, CPUDetector, WorkerDetector } from "../engine";
import { registerLoop, stopLoop } from "./DetectionLoop";
import {
  setForceCPU,
  isForceCPU,
  ensureDetector,
  getDetectorBackend,
  startDetectionForPokemon,
  reloadDetectionTemplates,
  stopDetectionForPokemon,
} from "./startDetection";

// Helper to make a minimal DetectorConfig
function makeDetectorConfig() {
  return {
    enabled: true,
    source_type: "browser_display" as const,
    region: { x: 0, y: 0, w: 100, h: 100 },
    window_title: "",
    templates: [],
    precision: 0.85,
    consecutive_hits: 3,
    cooldown_sec: 5,
    change_threshold: 0.01,
    poll_interval_ms: 200,
    min_poll_ms: 50,
    max_poll_ms: 1000,
  };
}

// Helper to make a minimal template
function makeTemplate(enabled = true) {
  return {
    image_path: "test.png",
    regions: [],
    enabled,
  };
}

describe("startDetection", () => {
  beforeEach(() => {
    // Reset module-level singletons by forcing CPU off and clearing state
    setForceCPU(false);
    vi.clearAllMocks();

    // Default: fetch returns a valid image blob
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(["fake-image"], { type: "image/png" })),
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- setForceCPU / isForceCPU ---

  describe("setForceCPU", () => {
    it("toggles force CPU mode", () => {
      expect(isForceCPU()).toBe(false);
      setForceCPU(true);
      expect(isForceCPU()).toBe(true);
      setForceCPU(false);
      expect(isForceCPU()).toBe(false);
    });

    it("is a no-op when setting the same value", () => {
      setForceCPU(false);
      // Should not invalidate detector when value unchanged
      expect(isForceCPU()).toBe(false);
    });
  });

  // --- ensureDetector ---

  describe("ensureDetector", () => {
    it("initializes WebGPU detector when available", async () => {
      const mockDetector = {
        loadTemplate: vi.fn().mockReturnValue({ data: "template" }),
        detect: vi.fn(),
        destroy: vi.fn(),
      };
      vi.mocked(WebGPUDetector.create).mockResolvedValue(mockDetector as never);

      await ensureDetector();
      expect(getDetectorBackend()).toBe("gpu");
    });

    it("falls back to WorkerDetector when WebGPU fails and worker available", async () => {
      // Reset state so ensureDetector re-initializes
      setForceCPU(true);
      setForceCPU(false);

      vi.mocked(WebGPUDetector.create).mockRejectedValue(new Error("No GPU"));
      vi.mocked(WorkerDetector.isAvailable).mockReturnValue(true);
      const mockDetector = {
        loadTemplate: vi.fn().mockReturnValue({ data: "template" }),
        detect: vi.fn(),
        destroy: vi.fn(),
      };
      vi.mocked(WorkerDetector.create).mockResolvedValue(mockDetector as never);

      await ensureDetector();
      expect(getDetectorBackend()).toBe("cpu");
    });

    it("falls back to CPUDetector when WebGPU and Worker both fail", async () => {
      setForceCPU(true);
      setForceCPU(false);

      vi.mocked(WebGPUDetector.create).mockRejectedValue(new Error("No GPU"));
      vi.mocked(WorkerDetector.isAvailable).mockReturnValue(false);
      vi.mocked(CPUDetector.isAvailable).mockReturnValue(true);

      await ensureDetector();
      expect(getDetectorBackend()).toBe("cpu");
    });

    it("skips WebGPU entirely when force CPU mode is active", async () => {
      setForceCPU(true);
      vi.mocked(WorkerDetector.isAvailable).mockReturnValue(false);
      vi.mocked(CPUDetector.isAvailable).mockReturnValue(true);

      await ensureDetector();
      expect(WebGPUDetector.create).not.toHaveBeenCalled();
      expect(getDetectorBackend()).toBe("cpu");
    });

    it("is idempotent — second call returns immediately", async () => {
      const mockDetector = {
        loadTemplate: vi.fn().mockReturnValue({ data: "template" }),
        detect: vi.fn(),
        destroy: vi.fn(),
      };
      vi.mocked(WebGPUDetector.create).mockResolvedValue(mockDetector as never);

      await ensureDetector();
      await ensureDetector();
      // Only called once despite two ensureDetector calls
      expect(WebGPUDetector.create).toHaveBeenCalledTimes(1);
    });
  });

  // --- getDetectorBackend ---

  describe("getDetectorBackend", () => {
    it("returns null before initialization", () => {
      // Force reset
      setForceCPU(true);
      setForceCPU(false);
      expect(getDetectorBackend()).toBeNull();
    });
  });

  // --- startDetectionForPokemon ---

  describe("startDetectionForPokemon", () => {
    const mockDetector = {
      loadTemplate: vi.fn().mockReturnValue({ data: "template-data" }),
      detect: vi.fn(),
      destroy: vi.fn(),
    };

    beforeEach(async () => {
      // Ensure we have a detector available
      setForceCPU(true);
      setForceCPU(false);
      vi.mocked(WebGPUDetector.create).mockResolvedValue(mockDetector as never);
    });

    it("creates a detection loop and registers it", async () => {
      const onScore = vi.fn();
      const getVideo = () => null;

      const result = await startDetectionForPokemon({
        pokemonId: "poke-1",
        templates: [makeTemplate()],
        config: makeDetectorConfig(),
        getVideoElement: getVideo,
        onScore,
      });

      expect(result).not.toBeNull();
      expect(registerLoop).toHaveBeenCalledWith("poke-1", expect.anything());
      expect(mockLoadTemplates).toHaveBeenCalled();
      expect(mockUpdateConfig).toHaveBeenCalled();
      expect(mockOnScore).toHaveBeenCalledWith(onScore);
      expect(mockStart).toHaveBeenCalledWith(getVideo);
    });

    it("stops any existing loop before starting a new one", async () => {
      await startDetectionForPokemon({
        pokemonId: "poke-1",
        templates: [makeTemplate()],
        config: makeDetectorConfig(),
        getVideoElement: () => null,
        onScore: vi.fn(),
      });

      expect(stopLoop).toHaveBeenCalledWith("poke-1");
    });

    it("returns null when no templates could be loaded", async () => {
      // Make fetch fail for all templates
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false }),
      );

      const result = await startDetectionForPokemon({
        pokemonId: "poke-1",
        templates: [makeTemplate()],
        config: makeDetectorConfig(),
        getVideoElement: () => null,
        onScore: vi.fn(),
      });

      expect(result).toBeNull();
    });

    it("skips disabled templates", async () => {
      const templates = [makeTemplate(true), makeTemplate(false)];

      await startDetectionForPokemon({
        pokemonId: "poke-1",
        templates,
        config: makeDetectorConfig(),
        getVideoElement: () => null,
        onScore: vi.fn(),
      });

      // Fetch should only be called for the enabled template (index 0)
      // plus 1 postDetectionState call = 2 total
      const templateFetches = vi.mocked(fetch).mock.calls.filter(
        (call) => String(call[0]).includes("/api/detector/"),
      );
      expect(templateFetches).toHaveLength(1);
      expect(String(templateFetches[0][0])).toContain("/template/0");
    });

    it("returns null when no detector is available", async () => {
      // Force reset, and make all backends unavailable
      setForceCPU(true);
      vi.mocked(WorkerDetector.isAvailable).mockReturnValue(false);
      vi.mocked(CPUDetector.isAvailable).mockReturnValue(false);

      const result = await startDetectionForPokemon({
        pokemonId: "poke-1",
        templates: [makeTemplate()],
        config: makeDetectorConfig(),
        getVideoElement: () => null,
        onScore: vi.fn(),
      });

      expect(result).toBeNull();
    });

    it("maps config fields correctly when calling updateConfig", async () => {
      const config = makeDetectorConfig();
      config.precision = 0.92;
      config.consecutive_hits = 5;
      config.cooldown_sec = 10;
      config.poll_interval_ms = 300;
      config.min_poll_ms = 100;
      config.max_poll_ms = 2000;

      await startDetectionForPokemon({
        pokemonId: "poke-1",
        templates: [makeTemplate()],
        config,
        getVideoElement: () => null,
        onScore: vi.fn(),
      });

      expect(mockUpdateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          precision: 0.92,
          consecutiveHits: 5,
          cooldownSec: 10,
          pollIntervalMs: 300,
          minPollMs: 100,
          maxPollMs: 2000,
          hysteresisFactor: 0.7,
        }),
      );
    });

    it("passes the minimum calibrated precision of enabled templates to updateConfig", async () => {
      const calibrated = (rec: number, enabled = true) => ({
        ...makeTemplate(enabled),
        calibration: {
          recommended_precision: rec,
          match_p10: rec + 0.03,
          match_median: rec + 0.1,
          noise_p90: 0.2,
          sample_count: 10,
        },
      });

      await startDetectionForPokemon({
        pokemonId: "poke-1",
        // Disabled template has the lowest recommendation and must be ignored
        templates: [calibrated(0.5, false), calibrated(0.8), calibrated(0.65)],
        config: makeDetectorConfig(),
        getVideoElement: () => null,
        onScore: vi.fn(),
      });

      expect(mockUpdateConfig).toHaveBeenCalledWith(
        expect.objectContaining({ calibratedPrecision: 0.65 }),
      );
    });

    it("passes no calibrated precision when templates carry no calibration", async () => {
      await startDetectionForPokemon({
        pokemonId: "poke-1",
        templates: [makeTemplate()],
        config: makeDetectorConfig(),
        getVideoElement: () => null,
        onScore: vi.fn(),
      });

      expect(mockUpdateConfig).toHaveBeenCalledWith(
        expect.objectContaining({ calibratedPrecision: undefined }),
      );
    });

    it("skips templates that fail to fetch", async () => {
      let callCount = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.reject(new Error("Network error"));
          }
          return Promise.resolve({
            ok: true,
            blob: () => Promise.resolve(new Blob(["img"], { type: "image/png" })),
          });
        }),
      );

      await startDetectionForPokemon({
        pokemonId: "poke-1",
        templates: [makeTemplate(), makeTemplate()],
        config: makeDetectorConfig(),
        getVideoElement: () => null,
        onScore: vi.fn(),
      });

      // Should still succeed with the second template
      expect(mockLoadTemplates).toHaveBeenCalled();
    });
  });

  // --- reloadDetectionTemplates ---

  describe("reloadDetectionTemplates", () => {
    it("returns -1 when no loop is running for the pokemon", async () => {
      const result = await reloadDetectionTemplates("nonexistent", [makeTemplate()]);
      expect(result).toBe(-1);
    });

    it("reloads templates into a running loop", async () => {
      // First start a loop
      const mockDetector = {
        loadTemplate: vi.fn().mockReturnValue({ data: "template-data" }),
        detect: vi.fn(),
        destroy: vi.fn(),
      };
      setForceCPU(true);
      setForceCPU(false);
      vi.mocked(WebGPUDetector.create).mockResolvedValue(mockDetector as never);

      await startDetectionForPokemon({
        pokemonId: "poke-reload",
        templates: [makeTemplate()],
        config: makeDetectorConfig(),
        getVideoElement: () => null,
        onScore: vi.fn(),
      });

      // Now reload templates
      const result = await reloadDetectionTemplates("poke-reload", [
        makeTemplate(),
        makeTemplate(),
      ]);

      // Should have loaded 2 templates (both enabled)
      expect(result).toBe(2);
    });
  });

  // --- stopDetectionForPokemon ---

  describe("stopDetectionForPokemon", () => {
    it("delegates to stopLoop with the pokemon ID", () => {
      stopDetectionForPokemon("poke-1");
      expect(stopLoop).toHaveBeenCalledWith("poke-1");
    });
  });

  // --- setForceCPU detector teardown ---

  describe("setForceCPU detector teardown", () => {
    it("destroys the previous detector when toggling", async () => {
      const mockDetector = {
        loadTemplate: vi.fn().mockReturnValue({ data: "template" }),
        detect: vi.fn(),
        destroy: vi.fn(),
      };
      setForceCPU(true);
      setForceCPU(false);
      vi.mocked(WebGPUDetector.create).mockResolvedValue(mockDetector as never);

      await ensureDetector();
      setForceCPU(true);

      expect(mockDetector.destroy).toHaveBeenCalledOnce();
      setForceCPU(false);
    });
  });

  // --- device-loss recovery ---

  describe("device-loss recovery", () => {
    const mockDetector = {
      loadTemplate: vi.fn().mockReturnValue({ data: "template-data" }),
      detect: vi.fn(),
      destroy: vi.fn(),
    };

    /** Start a hunt and return the onDeviceLost callback captured by create(). */
    async function startHuntAndCaptureCallback(pokemonId: string) {
      setForceCPU(true);
      setForceCPU(false);
      vi.mocked(WebGPUDetector.create).mockResolvedValue(mockDetector as never);

      await startDetectionForPokemon({
        pokemonId,
        templates: [makeTemplate()],
        config: makeDetectorConfig(),
        getVideoElement: () => null,
        onScore: vi.fn(),
      });

      const createCalls = vi.mocked(WebGPUDetector.create).mock.calls;
      const onDeviceLost = createCalls[createCalls.length - 1][0] as (
        info: GPUDeviceLostInfo,
      ) => Promise<void>;
      expect(onDeviceLost).toBeTypeOf("function");
      return onDeviceLost;
    }

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("recreates the detector and restarts active loops after device loss", async () => {
      const onDeviceLost = await startHuntAndCaptureCallback("poke-loss");
      const createsBefore = vi.mocked(WebGPUDetector.create).mock.calls.length;
      const registersBefore = vi.mocked(registerLoop).mock.calls.length;

      const recovery = onDeviceLost({ reason: "unknown", message: "boom" } as GPUDeviceLostInfo);
      await vi.advanceTimersByTimeAsync(1100);
      await recovery;

      expect(vi.mocked(WebGPUDetector.create).mock.calls.length).toBe(createsBefore + 1);
      const newRegisters = vi.mocked(registerLoop).mock.calls.slice(registersBefore);
      expect(newRegisters.some((call) => call[0] === "poke-loss")).toBe(true);

      stopDetectionForPokemon("poke-loss");
    });

    it("does not restart after an intentional destroy (reason destroyed)", async () => {
      const onDeviceLost = await startHuntAndCaptureCallback("poke-destroyed");
      const createsBefore = vi.mocked(WebGPUDetector.create).mock.calls.length;

      await onDeviceLost({ reason: "destroyed", message: "" } as GPUDeviceLostInfo);
      await vi.advanceTimersByTimeAsync(1100);

      expect(vi.mocked(WebGPUDetector.create).mock.calls.length).toBe(createsBefore);
      stopDetectionForPokemon("poke-destroyed");
    });

    it("does not restart hunts that were stopped before the loss", async () => {
      const onDeviceLost = await startHuntAndCaptureCallback("poke-stopped");
      stopDetectionForPokemon("poke-stopped");
      const registersBefore = vi.mocked(registerLoop).mock.calls.length;

      const recovery = onDeviceLost({ reason: "unknown", message: "boom" } as GPUDeviceLostInfo);
      await vi.advanceTimersByTimeAsync(1100);
      await recovery;

      const newRegisters = vi.mocked(registerLoop).mock.calls.slice(registersBefore);
      expect(newRegisters.some((call) => call[0] === "poke-stopped")).toBe(false);
    });

    it("ignores a second loss event while recovery is in progress", async () => {
      const onDeviceLost = await startHuntAndCaptureCallback("poke-double");
      const createsBefore = vi.mocked(WebGPUDetector.create).mock.calls.length;

      const first = onDeviceLost({ reason: "unknown", message: "1" } as GPUDeviceLostInfo);
      const second = onDeviceLost({ reason: "unknown", message: "2" } as GPUDeviceLostInfo);
      await vi.advanceTimersByTimeAsync(1100);
      await first;
      await second;

      // Only one recovery ran: exactly one additional create()
      expect(vi.mocked(WebGPUDetector.create).mock.calls.length).toBe(createsBefore + 1);
      stopDetectionForPokemon("poke-double");
    });
  });
});
