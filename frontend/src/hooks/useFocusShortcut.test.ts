import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { createRef } from "react";
import { useFocusShortcut } from "./useFocusShortcut";

/** Builds a ref pointing at a real input attached to the document. */
function inputRef() {
  const input = document.createElement("input");
  document.body.append(input);
  const ref = createRef<HTMLInputElement>() as React.RefObject<HTMLInputElement | null>;
  ref.current = input;
  return { ref, input };
}

describe("useFocusShortcut", () => {
  it("focuses the input on Ctrl+K", () => {
    const { ref, input } = inputRef();
    renderHook(() => useFocusShortcut(ref));
    globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    expect(document.activeElement).toBe(input);
    input.remove();
  });

  it("focuses the input on Meta+K", () => {
    const { ref, input } = inputRef();
    renderHook(() => useFocusShortcut(ref));
    globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
    expect(document.activeElement).toBe(input);
    input.remove();
  });

  it("ignores a bare k without a modifier", () => {
    const { ref, input } = inputRef();
    renderHook(() => useFocusShortcut(ref));
    globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));
    expect(document.activeElement).not.toBe(input);
    input.remove();
  });

  it("prevents the browser default for the shortcut", () => {
    const { ref, input } = inputRef();
    renderHook(() => useFocusShortcut(ref));
    const event = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, cancelable: true });
    globalThis.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    input.remove();
  });

  it("tolerates a ref that points at nothing", () => {
    const ref = { current: null } as React.RefObject<HTMLInputElement | null>;
    renderHook(() => useFocusShortcut(ref));
    expect(() =>
      globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true })),
    ).not.toThrow();
  });

  it("removes the listener on unmount", () => {
    const { ref, input } = inputRef();
    const remove = vi.spyOn(globalThis, "removeEventListener");
    const { unmount } = renderHook(() => useFocusShortcut(ref));
    unmount();
    expect(remove).toHaveBeenCalledWith("keydown", expect.any(Function));
    remove.mockRestore();
    input.remove();
  });
});
