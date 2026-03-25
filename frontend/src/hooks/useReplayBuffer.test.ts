import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useReplayBuffer } from "./useReplayBuffer";

/** Polyfill ImageData for jsdom which does not provide it. */
class MockImageData {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  }
}
vi.stubGlobal("ImageData", MockImageData);

/** Create a minimal mock HTMLVideoElement with configurable readyState. */
function createMockVideo(ready = true): HTMLVideoElement & { simulateReady: () => void } {
  const listeners: Record<string, (() => void)[]> = {};
  const video = {
    readyState: ready ? 2 : 0,
    videoWidth: 320,
    videoHeight: 240,
    addEventListener: vi.fn((event: string, cb: () => void) => {
      const list = (listeners[event] ??= []);
      list.push(cb);
    }),
    removeEventListener: vi.fn(),
    simulateReady: () => {
      (video as unknown as { readyState: number }).readyState = 2;
      for (const cb of listeners["loadeddata"] ?? []) cb();
    },
  } as unknown as HTMLVideoElement & { simulateReady: () => void };

  return video;
}

/** Stub canvas returned by document.createElement("canvas"). */
function stubCanvas() {
  const mockCtx = {
    drawImage: vi.fn(),
    getImageData: vi.fn((_x: number, _y: number, w: number, h: number) =>
      new MockImageData(w, h),
    ),
  };

  const origCreateElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "canvas") {
      return {
        width: 0,
        height: 0,
        getContext: () => mockCtx,
      } as unknown as HTMLCanvasElement;
    }
    return origCreateElement(tag);
  });

  return mockCtx;
}

describe("useReplayBuffer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubCanvas();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // --- Initial state ---

  it("starts with empty buffer when no video element", () => {
    const { result } = renderHook(() => useReplayBuffer(null));

    expect(result.current.frameCount).toBe(0);
    expect(result.current.isBuffering).toBe(false);
    expect(result.current.bufferedSeconds).toBe(0);
    expect(result.current.frames).toEqual([]);
  });

  it("starts with empty buffer when video is undefined", () => {
    const { result } = renderHook(() => useReplayBuffer(undefined));

    expect(result.current.frameCount).toBe(0);
    expect(result.current.isBuffering).toBe(false);
  });

  // --- Buffering lifecycle ---

  it("begins buffering when video is ready", () => {
    const video = createMockVideo(true);
    const { result } = renderHook(() => useReplayBuffer(video, 1, 10));

    expect(result.current.isBuffering).toBe(true);
  });

  it("waits for loadeddata when video is not ready", () => {
    const video = createMockVideo(false);
    const { result } = renderHook(() => useReplayBuffer(video, 1, 10));

    // Not buffering yet since video is not ready
    expect(result.current.isBuffering).toBe(false);

    // Simulate video becoming ready
    act(() => video.simulateReady());
    expect(result.current.isBuffering).toBe(true);
  });

  // --- Adding frames ---

  it("captures frames at the configured interval", () => {
    const video = createMockVideo(true);
    const fps = 10;
    const { result } = renderHook(() => useReplayBuffer(video, 1, fps));

    // Advance by 5 intervals (100ms each at 10fps)
    act(() => vi.advanceTimersByTime(500));

    expect(result.current.frameCount).toBe(5);
    expect(result.current.bufferedSeconds).toBeCloseTo(0.5);
  });

  it("does not exceed maxFrames (durationSec * fps)", () => {
    const video = createMockVideo(true);
    const durationSec = 1;
    const fps = 5;
    const maxFrames = durationSec * fps; // 5

    const { result } = renderHook(() => useReplayBuffer(video, durationSec, fps));

    // Capture more than maxFrames
    act(() => vi.advanceTimersByTime(2000));

    expect(result.current.frameCount).toBe(maxFrames);
    expect(result.current.bufferedSeconds).toBe(durationSec);
  });

  // --- getFrame ---

  it("getFrame returns null for out-of-range indices", () => {
    const { result } = renderHook(() => useReplayBuffer(null));

    expect(result.current.getFrame(-1)).toBeNull();
    expect(result.current.getFrame(0)).toBeNull();
    expect(result.current.getFrame(100)).toBeNull();
  });

  it("getFrame returns frames by index before buffer wraps", () => {
    const video = createMockVideo(true);
    const { result } = renderHook(() => useReplayBuffer(video, 10, 10));

    act(() => vi.advanceTimersByTime(300));

    expect(result.current.frameCount).toBe(3);
    expect(result.current.getFrame(0)).toBeInstanceOf(ImageData);
    expect(result.current.getFrame(1)).toBeInstanceOf(ImageData);
    expect(result.current.getFrame(2)).toBeInstanceOf(ImageData);
    expect(result.current.getFrame(3)).toBeNull();
  });

  it("getFrame returns frames correctly after buffer wraps", () => {
    const video = createMockVideo(true);
    const fps = 5;
    const durationSec = 1;
    const { result } = renderHook(() => useReplayBuffer(video, durationSec, fps));

    // Fill buffer (5 frames) and then wrap around with 3 more
    act(() => vi.advanceTimersByTime(1600));

    expect(result.current.frameCount).toBe(5);
    // All indices 0..4 should return valid frames
    for (let i = 0; i < 5; i++) {
      expect(result.current.getFrame(i)).toBeInstanceOf(ImageData);
    }
  });

  // --- frames getter ---

  it("frames returns ordered array of captured frames", () => {
    const video = createMockVideo(true);
    const { result } = renderHook(() => useReplayBuffer(video, 10, 10));

    act(() => vi.advanceTimersByTime(300));

    const frames = result.current.frames;
    expect(frames).toHaveLength(3);
    expect(frames[0]).toBeInstanceOf(ImageData);
  });

  // --- clear ---

  it("clear resets the buffer to empty", () => {
    const video = createMockVideo(true);
    const { result } = renderHook(() => useReplayBuffer(video, 10, 10));

    act(() => vi.advanceTimersByTime(500));
    expect(result.current.frameCount).toBeGreaterThan(0);

    act(() => result.current.clear());
    expect(result.current.frameCount).toBe(0);
    expect(result.current.frames).toEqual([]);
  });

  // --- stop ---

  it("stop halts frame capture", () => {
    const video = createMockVideo(true);
    const { result } = renderHook(() => useReplayBuffer(video, 10, 10));

    act(() => vi.advanceTimersByTime(300));
    const countBefore = result.current.frameCount;

    act(() => result.current.stop());
    expect(result.current.isBuffering).toBe(false);

    // Advancing time should not add more frames
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.frameCount).toBe(countBefore);
  });

  // --- restart ---

  it("restart clears buffer and begins fresh capture", () => {
    const video = createMockVideo(true);
    const { result } = renderHook(() => useReplayBuffer(video, 10, 10));

    act(() => vi.advanceTimersByTime(500));
    expect(result.current.frameCount).toBe(5);

    act(() => result.current.stop());
    act(() => result.current.restart());

    // Buffer was cleared
    expect(result.current.frameCount).toBe(0);

    // New frames are being captured again
    act(() => vi.advanceTimersByTime(300));
    expect(result.current.frameCount).toBe(3);
    expect(result.current.isBuffering).toBe(true);
  });

  // --- Skips frames when video dimensions are zero ---

  it("skips capture when video dimensions are zero", () => {
    const video = createMockVideo(true);
    // Set zero dimensions
    Object.defineProperty(video, "videoWidth", { value: 0, writable: true });
    Object.defineProperty(video, "videoHeight", { value: 0, writable: true });

    const { result } = renderHook(() => useReplayBuffer(video, 1, 10));

    act(() => vi.advanceTimersByTime(500));

    expect(result.current.frameCount).toBe(0);
  });

  // --- Cleanup on unmount ---

  it("stops interval on unmount", () => {
    const video = createMockVideo(true);
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const { unmount } = renderHook(() => useReplayBuffer(video, 1, 10));

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  // --- Default parameters ---

  it("uses default 30s duration and 60fps when not specified", () => {
    const video = createMockVideo(true);
    const { result } = renderHook(() => useReplayBuffer(video));

    // At 60fps, one interval is ~16.67ms. Advance 1 second to get ~60 frames.
    act(() => vi.advanceTimersByTime(1000));

    // With Math.round(1000/60) = 17ms intervals, we get floor(1000/17) = 58-59 frames
    expect(result.current.frameCount).toBeGreaterThan(50);
    expect(result.current.frameCount).toBeLessThanOrEqual(60);
  });
});
