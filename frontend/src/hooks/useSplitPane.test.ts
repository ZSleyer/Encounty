import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSplitPane, type UseSplitPaneOptions } from "./useSplitPane";

const OPTIONS: UseSplitPaneOptions = {
  storageKey: "test_split",
  defaultSizePx: 500,
  minSizePx: 100,
  reservedPx: 24,
  minReservePx: 140,
};

/** Builds a div that reports a fixed height, which jsdom never does on its own. */
function sizedDiv(clientHeight: number, top = 0): HTMLDivElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
  el.getBoundingClientRect = () => ({ top, bottom: top + clientHeight }) as DOMRect;
  return el;
}

/** Presses one arrow key on the divider. */
function pressArrow(handler: (e: React.KeyboardEvent) => void, key: "ArrowUp" | "ArrowDown") {
  const preventDefault = vi.fn();
  act(() => handler({ key, preventDefault } as unknown as React.KeyboardEvent));
  return preventDefault;
}

describe("useSplitPane", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("falls back to the default size when nothing is stored", () => {
    const { result } = renderHook(() => useSplitPane(OPTIONS));
    expect(result.current.size).toBe(500);
  });

  it("reads the initial size from localStorage", () => {
    localStorage.setItem("test_split", "312");
    const { result } = renderHook(() => useSplitPane(OPTIONS));
    expect(result.current.size).toBe(312);
  });

  it("falls back to the default size when localStorage throws", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = renderHook(() => useSplitPane(OPTIONS));
    expect(result.current.size).toBe(500);
    getItem.mockRestore();
  });

  it("moves the divider up by one step per ArrowUp", () => {
    const { result } = renderHook(() => useSplitPane(OPTIONS));
    pressArrow(result.current.handleKeyDown, "ArrowUp");
    expect(result.current.size).toBe(476);
  });

  it("moves the divider down by one step per ArrowDown", () => {
    const { result } = renderHook(() => useSplitPane(OPTIONS));
    pressArrow(result.current.handleKeyDown, "ArrowDown");
    expect(result.current.size).toBe(524);
  });

  it("ignores keys other than the vertical arrows", () => {
    const { result } = renderHook(() => useSplitPane(OPTIONS));
    const preventDefault = pressArrow(
      result.current.handleKeyDown,
      "ArrowLeft" as "ArrowUp" | "ArrowDown",
    );
    expect(result.current.size).toBe(500);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("persists the size a keyboard resize lands on", () => {
    const { result } = renderHook(() => useSplitPane(OPTIONS));
    pressArrow(result.current.handleKeyDown, "ArrowUp");
    expect(localStorage.getItem("test_split")).toBe("476");
  });

  it("clamps against the measured container, reserving room for the pane below", () => {
    const { result } = renderHook(() => useSplitPane(OPTIONS));
    // flexible = 400 - 24 = 376, reserve = min(140, 188) = 140, so 236 is the cap.
    result.current.containerRef.current = sizedDiv(400);
    pressArrow(result.current.handleKeyDown, "ArrowDown");
    expect(result.current.size).toBe(236);
  });

  it("splits a very short container evenly rather than starving one pane", () => {
    const { result } = renderHook(() => useSplitPane({ ...OPTIONS, minSizePx: 10 }));
    // flexible = 124 - 24 = 100, reserve = min(140, 50) = 50, so 50 is the cap.
    result.current.containerRef.current = sizedDiv(124);
    pressArrow(result.current.handleKeyDown, "ArrowDown");
    expect(result.current.size).toBe(50);
  });

  it("never clamps below the configured minimum", () => {
    const { result } = renderHook(() => useSplitPane({ ...OPTIONS, minSizePx: 300 }));
    result.current.containerRef.current = sizedDiv(400);
    pressArrow(result.current.handleKeyDown, "ArrowDown");
    expect(result.current.size).toBe(300);
  });

  it("subtracts the content offset when measureContentOffset is set", () => {
    const { result } = renderHook(() => useSplitPane({ ...OPTIONS, measureContentOffset: true }));
    result.current.containerRef.current = sizedDiv(400);
    // A 60px header above the content: flexible = 400 - 60 - 24 = 316,
    // reserve = min(140, 158) = 140, so 176 is the cap.
    result.current.contentRef.current = sizedDiv(0, 60);
    pressArrow(result.current.handleKeyDown, "ArrowDown");
    expect(result.current.size).toBe(176);
  });

  it("skips the upper bound while the content is not mounted yet", () => {
    const { result } = renderHook(() => useSplitPane({ ...OPTIONS, measureContentOffset: true }));
    result.current.containerRef.current = sizedDiv(400);
    pressArrow(result.current.handleKeyDown, "ArrowDown");
    expect(result.current.size).toBe(524);
  });

  it("resizes on drag and writes the landed size to localStorage", () => {
    const { result } = renderHook(() => useSplitPane(OPTIONS));
    act(() =>
      result.current.startDrag({
        preventDefault: vi.fn(),
        clientY: 100,
      } as unknown as React.MouseEvent),
    );
    act(() => {
      globalThis.dispatchEvent(new MouseEvent("mousemove", { clientY: 160 }));
    });
    expect(result.current.size).toBe(560);
    act(() => {
      globalThis.dispatchEvent(new MouseEvent("mouseup"));
    });
    expect(localStorage.getItem("test_split")).toBe("560");
  });

  it("restores the default size and forgets the stored one on reset", () => {
    localStorage.setItem("test_split", "312");
    const { result } = renderHook(() => useSplitPane(OPTIONS));
    act(() => result.current.reset());
    expect(result.current.size).toBe(500);
    expect(localStorage.getItem("test_split")).toBeNull();
  });
});
