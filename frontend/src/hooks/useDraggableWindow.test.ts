import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useDraggableWindow } from "./useDraggableWindow";

describe("useDraggableWindow", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("returns default position {x:100, y:100} when localStorage is empty", () => {
    const { result } = renderHook(() =>
      useDraggableWindow({ storageKey: "test-pos" }),
    );
    expect(result.current.position).toEqual({ x: 100, y: 100 });
  });

  it("returns custom defaultPosition when provided and localStorage empty", () => {
    const { result } = renderHook(() =>
      useDraggableWindow({
        storageKey: "test-pos",
        defaultPosition: { x: 50, y: 200 },
      }),
    );
    expect(result.current.position).toEqual({ x: 50, y: 200 });
  });

  it("reads stored position from localStorage", () => {
    localStorage.setItem("test-pos", JSON.stringify({ x: 300, y: 400 }));
    const { result } = renderHook(() =>
      useDraggableWindow({ storageKey: "test-pos" }),
    );
    expect(result.current.position).toEqual({ x: 300, y: 400 });
  });

  it("handles malformed localStorage data gracefully", () => {
    localStorage.setItem("test-pos", "not-json");
    const { result } = renderHook(() =>
      useDraggableWindow({ storageKey: "test-pos" }),
    );
    expect(result.current.position).toEqual({ x: 100, y: 100 });
  });

  it("handles localStorage data missing required fields", () => {
    localStorage.setItem("test-pos", JSON.stringify({ x: 10 }));
    const { result } = renderHook(() =>
      useDraggableWindow({ storageKey: "test-pos" }),
    );
    expect(result.current.position).toEqual({ x: 100, y: 100 });
  });

  it("handleMouseDown adds global mousemove and mouseup listeners", () => {
    const addSpy = vi.spyOn(globalThis, "addEventListener");
    const { result } = renderHook(() =>
      useDraggableWindow({ storageKey: "test-pos" }),
    );

    act(() => {
      result.current.handleMouseDown({
        clientX: 50,
        clientY: 50,
      } as React.MouseEvent);
    });

    const eventNames = addSpy.mock.calls.map((c) => c[0]);
    expect(eventNames).toContain("mousemove");
    expect(eventNames).toContain("mouseup");
  });

  it("cleans up global listeners on unmount", () => {
    const removeSpy = vi.spyOn(globalThis, "removeEventListener");
    const { unmount } = renderHook(() =>
      useDraggableWindow({ storageKey: "test-pos" }),
    );

    unmount();

    const eventNames = removeSpy.mock.calls.map((c) => c[0]);
    expect(eventNames).toContain("mousemove");
    expect(eventNames).toContain("mouseup");
  });

  it("saves position to localStorage on mouseup", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    // Set viewport dimensions for clamping
    Object.defineProperty(globalThis, "innerWidth", { value: 1920, configurable: true });
    Object.defineProperty(globalThis, "innerHeight", { value: 1080, configurable: true });

    const { result } = renderHook(() =>
      useDraggableWindow({ storageKey: "test-pos" }),
    );

    // Start drag
    act(() => {
      result.current.handleMouseDown({
        clientX: 100,
        clientY: 100,
      } as React.MouseEvent);
    });

    // Simulate mouse move then mouse up via global events
    act(() => {
      globalThis.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 150, clientY: 150 }),
      );
    });

    act(() => {
      globalThis.dispatchEvent(new MouseEvent("mouseup"));
    });

    const storeCalls = setItemSpy.mock.calls.filter(
      (c) => c[0] === "test-pos",
    );
    expect(storeCalls.length).toBeGreaterThanOrEqual(1);
    const lastCall = storeCalls[storeCalls.length - 1];
    const stored = JSON.parse(lastCall[1]);
    expect(typeof stored.x).toBe("number");
    expect(typeof stored.y).toBe("number");
  });
});
