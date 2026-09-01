import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useSecondTick } from "./useSecondTick";

describe("useSecondTick", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-renders once per second while enabled", () => {
    let renders = 0;
    renderHook(() => {
      renders += 1;
      useSecondTick(true);
    });
    const initial = renders;
    // One second per act() call: a single longer advance batches every queued
    // update into one render and would understate the tick count.
    for (let i = 0; i < 3; i++) act(() => vi.advanceTimersByTime(1000));
    expect(renders).toBe(initial + 3);
  });

  it("does not re-render while disabled", () => {
    let renders = 0;
    renderHook(() => {
      renders += 1;
      useSecondTick(false);
    });
    const initial = renders;
    act(() => vi.advanceTimersByTime(5000));
    expect(renders).toBe(initial);
  });

  it("starts ticking when enabled flips to true", () => {
    let renders = 0;
    const { rerender } = renderHook(
      ({ enabled }) => {
        renders += 1;
        useSecondTick(enabled);
      },
      { initialProps: { enabled: false } },
    );
    act(() => vi.advanceTimersByTime(2000));
    rerender({ enabled: true });
    const afterFlip = renders;
    for (let i = 0; i < 2; i++) act(() => vi.advanceTimersByTime(1000));
    expect(renders).toBe(afterFlip + 2);
  });

  it("stops ticking when enabled flips to false", () => {
    let renders = 0;
    const { rerender } = renderHook(
      ({ enabled }) => {
        renders += 1;
        useSecondTick(enabled);
      },
      { initialProps: { enabled: true } },
    );
    rerender({ enabled: false });
    const afterFlip = renders;
    act(() => vi.advanceTimersByTime(5000));
    expect(renders).toBe(afterFlip);
  });

  it("clears its interval on unmount", () => {
    const clear = vi.spyOn(globalThis, "clearInterval");
    const { unmount } = renderHook(() => useSecondTick(true));
    unmount();
    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });
});
