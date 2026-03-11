import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useHistory } from "./useHistory";

describe("useHistory", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with the initial value", () => {
    const { result } = renderHook(() => useHistory("init"));
    expect(result.current.current).toBe("init");
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("push adds a new entry after debounce", () => {
    const { result } = renderHook(() => useHistory(0, 100));

    act(() => {
      result.current.push(1);
    });

    // Before debounce fires, current is still initial
    expect(result.current.current).toBe(0);

    // Advance past debounce
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.current).toBe(1);
    expect(result.current.canUndo).toBe(true);
  });

  it("debounces rapid pushes — only the last value is committed", () => {
    const { result } = renderHook(() => useHistory(0, 100));

    act(() => {
      result.current.push(1);
    });
    act(() => {
      vi.advanceTimersByTime(50); // halfway
      result.current.push(2);
    });
    act(() => {
      vi.advanceTimersByTime(50); // still within debounce of second push
      result.current.push(3);
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.current).toBe(3);
    // Only one entry was added (the debounced one), so undo goes back to initial
    act(() => {
      result.current.undo();
    });
    expect(result.current.current).toBe(0);
  });

  it("undo goes back and redo goes forward", () => {
    const { result } = renderHook(() => useHistory("a", 0));

    // Push b
    act(() => {
      result.current.push("b");
      vi.advanceTimersByTime(0);
    });
    // Push c
    act(() => {
      result.current.push("c");
      vi.advanceTimersByTime(0);
    });

    expect(result.current.current).toBe("c");

    // Undo to b
    act(() => {
      result.current.undo();
    });
    expect(result.current.current).toBe("b");
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(true);

    // Undo to a
    act(() => {
      result.current.undo();
    });
    expect(result.current.current).toBe("a");
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);

    // Redo to b
    act(() => {
      result.current.redo();
    });
    expect(result.current.current).toBe("b");

    // Redo to c
    act(() => {
      result.current.redo();
    });
    expect(result.current.current).toBe("c");
    expect(result.current.canRedo).toBe(false);
  });

  it("undo does nothing when at the beginning", () => {
    const { result } = renderHook(() => useHistory("only"));
    act(() => {
      result.current.undo();
    });
    expect(result.current.current).toBe("only");
  });

  it("redo does nothing when at the end", () => {
    const { result } = renderHook(() => useHistory("only"));
    act(() => {
      result.current.redo();
    });
    expect(result.current.current).toBe("only");
  });

  it("pushing after undo discards the redo stack", () => {
    const { result } = renderHook(() => useHistory(0, 0));

    act(() => {
      result.current.push(1);
      vi.advanceTimersByTime(0);
    });
    act(() => {
      result.current.push(2);
      vi.advanceTimersByTime(0);
    });

    // Undo to 1
    act(() => {
      result.current.undo();
    });
    expect(result.current.current).toBe(1);

    // Push 3 — should discard 2 from redo stack
    act(() => {
      result.current.push(3);
      vi.advanceTimersByTime(0);
    });
    expect(result.current.current).toBe(3);
    expect(result.current.canRedo).toBe(false);
  });

  it("caps stack at 50 entries", () => {
    const { result } = renderHook(() => useHistory(0, 0));

    // Push 55 entries
    for (let i = 1; i <= 55; i++) {
      act(() => {
        result.current.push(i);
        vi.advanceTimersByTime(0);
      });
    }

    expect(result.current.current).toBe(55);

    // Undo all the way — should stop at 50 undos (stack capped at 50)
    let undoCount = 0;
    while (result.current.canUndo) {
      act(() => {
        result.current.undo();
      });
      undoCount++;
    }
    // Stack is capped at 50, so we can undo at most 49 times (50 entries, index 49 → 0)
    expect(undoCount).toBe(49);
  });
});
