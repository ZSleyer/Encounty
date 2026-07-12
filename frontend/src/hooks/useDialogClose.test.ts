import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDialogClose } from "./useDialogClose";

/** Minimal HTMLDialogElement stand-in with a real EventTarget so
 *  addEventListener/removeEventListener/dispatchEvent behave for real. */
function makeDialog(open: boolean) {
  const el = document.createElement("dialog");
  Object.defineProperty(el, "open", { value: open, writable: true });
  el.close = vi.fn(() => {
    (el as unknown as { open: boolean }).open = false;
  });
  return el;
}

describe("useDialogClose", () => {
  it("calls onClose immediately when there is no dialog element", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useDialogClose({ current: null }, onClose));
    act(() => result.current());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose immediately when the dialog is already closed", () => {
    const onClose = vi.fn();
    const dialog = makeDialog(false);
    const { result } = renderHook(() => useDialogClose({ current: dialog }, onClose));
    act(() => result.current());
    expect(dialog.close).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes the dialog and defers onClose until the clip-path transition ends", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const dialog = makeDialog(true);
    const { result } = renderHook(() => useDialogClose({ current: dialog }, onClose));

    act(() => result.current());
    expect(dialog.close).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      dialog.dispatchEvent(new TransitionEvent("transitionend", { propertyName: "clip-path" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("ignores transitionend for unrelated properties", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const dialog = makeDialog(true);
    const { result } = renderHook(() => useDialogClose({ current: dialog }, onClose));

    act(() => result.current());
    act(() => {
      dialog.dispatchEvent(new TransitionEvent("transitionend", { propertyName: "opacity" }));
    });
    expect(onClose).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("falls back to onClose via a timeout if transitionend never fires", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const dialog = makeDialog(true);
    const { result } = renderHook(() => useDialogClose({ current: dialog }, onClose));

    act(() => result.current());
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(320));
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("only calls onClose once even if both transitionend and the timeout occur", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const dialog = makeDialog(true);
    const { result } = renderHook(() => useDialogClose({ current: dialog }, onClose));

    act(() => result.current());
    act(() => {
      dialog.dispatchEvent(new TransitionEvent("transitionend", { propertyName: "clip-path" }));
    });
    act(() => vi.advanceTimersByTime(320));
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
