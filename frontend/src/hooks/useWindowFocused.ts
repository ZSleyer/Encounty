/**
 * useWindowFocused.ts: tracks whether the application window currently has focus.
 *
 * Used to stop animated sprites while the user works elsewhere. Chromium keeps
 * decoding and compositing animated GIFs in an unfocused window, which costs
 * measurable GPU-process CPU even though nothing else in the app is running.
 */
import { useEffect, useState } from "react";

/**
 * Reports whether the window is focused, updating on focus and blur.
 * Starts from the live document state so a window that is already unfocused
 * on mount does not animate until the first blur event.
 */
export function useWindowFocused(): boolean {
  const [focused, setFocused] = useState(() =>
    typeof document === "undefined" ? true : document.hasFocus(),
  );

  useEffect(() => {
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    globalThis.addEventListener("focus", onFocus);
    globalThis.addEventListener("blur", onBlur);
    return () => {
      globalThis.removeEventListener("focus", onFocus);
      globalThis.removeEventListener("blur", onBlur);
    };
  }, []);

  return focused;
}
