import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, renderHook } from "@testing-library/react";
import React from "react";
import {
  CaptureServiceProvider,
  useCaptureService,
  useCaptureVersion,
} from "./CaptureServiceContext";

/* Mock the Zustand store to avoid pulling in the real app state. */
vi.mock("../hooks/useCounterState", () => ({
  useCounterStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ appState: null }),
  ),
}));

/* Mock api utility so the module loads without side effects. */
vi.mock("../utils/api", () => ({
  apiUrl: (path: string) => `http://localhost:8192${path}`,
}));

/** Wrapper that provides CaptureServiceContext to hooks under test. */
function Wrapper({ children }: Readonly<{ children: React.ReactNode }>) {
  return <CaptureServiceProvider>{children}</CaptureServiceProvider>;
}

describe("CaptureServiceProvider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // --- Provider rendering ---

  it("renders children", () => {
    render(
      <CaptureServiceProvider>
        <span data-testid="child">hello</span>
      </CaptureServiceProvider>,
    );

    expect(screen.getByTestId("child").textContent).toBe("hello");
  });

  // --- useCaptureService outside provider ---

  it("throws when used outside CaptureServiceProvider", () => {
    // Suppress React error boundary console noise
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => {
      renderHook(() => useCaptureService());
    }).toThrow("useCaptureService must be used within CaptureServiceProvider");

    spy.mockRestore();
  });

  // --- Context shape ---

  it("provides expected methods and properties", () => {
    const { result } = renderHook(() => useCaptureService(), {
      wrapper: Wrapper,
    });

    expect(typeof result.current.startCapture).toBe("function");
    expect(typeof result.current.stopCapture).toBe("function");
    expect(typeof result.current.getStream).toBe("function");
    expect(typeof result.current.getVideoElement).toBe("function");
    expect(typeof result.current.isCapturing).toBe("function");
    expect(typeof result.current.getSourceLabel).toBe("function");
    expect(typeof result.current.subscribe).toBe("function");
    expect(typeof result.current.getVersion).toBe("function");
  });

  // --- Initial state ---

  it("isCapturing returns false for unknown pokemon", () => {
    const { result } = renderHook(() => useCaptureService(), {
      wrapper: Wrapper,
    });

    expect(result.current.isCapturing("nonexistent")).toBe(false);
  });

  it("getStream returns null for unknown pokemon", () => {
    const { result } = renderHook(() => useCaptureService(), {
      wrapper: Wrapper,
    });

    expect(result.current.getStream("nonexistent")).toBeNull();
  });

  it("getVideoElement returns null for unknown pokemon", () => {
    const { result } = renderHook(() => useCaptureService(), {
      wrapper: Wrapper,
    });

    expect(result.current.getVideoElement("nonexistent")).toBeNull();
  });

  it("getSourceLabel returns null for unknown pokemon", () => {
    const { result } = renderHook(() => useCaptureService(), {
      wrapper: Wrapper,
    });

    expect(result.current.getSourceLabel("nonexistent")).toBeNull();
  });

  it("captureError is null initially", () => {
    const { result } = renderHook(() => useCaptureService(), {
      wrapper: Wrapper,
    });

    expect(result.current.captureError).toBeNull();
  });

  // --- Version / subscribe ---

  it("getVersion returns 0 initially", () => {
    const { result } = renderHook(() => useCaptureService(), {
      wrapper: Wrapper,
    });

    expect(result.current.getVersion()).toBe(0);
  });

  it("subscribe returns an unsubscribe function", () => {
    const { result } = renderHook(() => useCaptureService(), {
      wrapper: Wrapper,
    });

    const unsub = result.current.subscribe(() => {});
    expect(typeof unsub).toBe("function");
    // Should not throw when called
    unsub();
  });

  // --- useCaptureVersion ---

  it("useCaptureVersion returns initial version 0", () => {
    const { result } = renderHook(() => useCaptureVersion(), {
      wrapper: Wrapper,
    });

    expect(result.current).toBe(0);
  });

  // --- startCapture error when getDisplayMedia unavailable ---

  it("sets captureError when getDisplayMedia is not available", async () => {
    // Remove getDisplayMedia from navigator
    const original = navigator.mediaDevices;
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getDisplayMedia: undefined },
      configurable: true,
    });

    const { result } = renderHook(() => useCaptureService(), {
      wrapper: Wrapper,
    });

    await result.current.startCapture("poke-1", "browser_display");

    expect(result.current.captureError).toBe(
      "getDisplayMedia not available. Ensure context is secure (HTTPS/localhost).",
    );

    // Restore
    Object.defineProperty(navigator, "mediaDevices", {
      value: original,
      configurable: true,
    });
  });

  // --- startCapture error when getUserMedia unavailable ---

  it("sets captureError when getUserMedia is not available for camera", async () => {
    const original = navigator.mediaDevices;
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: undefined },
      configurable: true,
    });

    const { result } = renderHook(() => useCaptureService(), {
      wrapper: Wrapper,
    });

    await result.current.startCapture("poke-1", "browser_camera");

    expect(result.current.captureError).toBe(
      "getUserMedia not available. Ensure context is secure (HTTPS/localhost).",
    );

    Object.defineProperty(navigator, "mediaDevices", {
      value: original,
      configurable: true,
    });
  });

  // --- startCapture with existingStream ---

  it("accepts an existing stream without calling browser APIs", async () => {
    const mockTrack = {
      label: "Test Track",
      stop: vi.fn(),
      onended: null as (() => void) | null,
    };
    const mockStream = {
      getVideoTracks: () => [mockTrack],
      getTracks: () => [mockTrack],
    } as unknown as MediaStream;

    // Use a real video element so appendChild works in jsdom,
    // but override readyState and videoWidth/Height for the flow.
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "video") {
        const realVideo = origCreateElement("video");
        Object.defineProperty(realVideo, "readyState", { value: 2, writable: true });
        Object.defineProperty(realVideo, "videoWidth", { value: 640, writable: true });
        Object.defineProperty(realVideo, "videoHeight", { value: 480, writable: true });
        realVideo.play = vi.fn().mockResolvedValue(undefined);
        return realVideo;
      }
      return origCreateElement(tag);
    });

    const { result } = renderHook(() => useCaptureService(), {
      wrapper: Wrapper,
    });

    await result.current.startCapture("poke-1", "browser_display", undefined, "My Source", mockStream);

    expect(result.current.captureError).toBeNull();
    expect(result.current.isCapturing("poke-1")).toBe(true);
    expect(result.current.getSourceLabel("poke-1")).toBe("My Source");
  });

  // --- stopCapture ---

  it("stopCapture cleans up a captured stream", async () => {
    const mockTrack = {
      label: "Screen",
      stop: vi.fn(),
      onended: null as (() => void) | null,
    };
    const mockStream = {
      getVideoTracks: () => [mockTrack],
      getTracks: () => [mockTrack],
    } as unknown as MediaStream;

    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "video") {
        const realVideo = origCreateElement("video");
        Object.defineProperty(realVideo, "readyState", { value: 2, writable: true });
        Object.defineProperty(realVideo, "videoWidth", { value: 640, writable: true });
        Object.defineProperty(realVideo, "videoHeight", { value: 480, writable: true });
        realVideo.play = vi.fn().mockResolvedValue(undefined);
        return realVideo;
      }
      return origCreateElement(tag);
    });

    const { result } = renderHook(() => useCaptureService(), {
      wrapper: Wrapper,
    });

    await result.current.startCapture("poke-1", "browser_display", undefined, undefined, mockStream);
    expect(result.current.isCapturing("poke-1")).toBe(true);

    result.current.stopCapture("poke-1");

    expect(result.current.isCapturing("poke-1")).toBe(false);
    expect(mockTrack.stop).toHaveBeenCalled();
  });

  // --- dev_video source type ---

  it("sets captureError when dev_video has no sourceId", async () => {
    const { result } = renderHook(() => useCaptureService(), {
      wrapper: Wrapper,
    });

    await result.current.startCapture("poke-1", "dev_video");

    expect(result.current.captureError).toBe("No video file selected");
  });
});
