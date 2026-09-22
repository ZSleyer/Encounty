/**
 * useHotkeyRecorder.ts, shared key-combo capture for every hotkey settings
 * section. It owns the window listeners, the live modifier preview and the
 * pause/resume bracket that keeps the key being recorded from firing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl } from "../utils/api";

/** Keys that only build up a combo and never finish one. */
const MODIFIER_KEYS = ["Control", "Shift", "Alt", "Meta"];

/**
 * The row that currently records, page-wide. Two sections each hold their own
 * recorder, so without this the second start would leave the first one
 * listening. It doubles as the "hotkeys are paused" flag: handing the capture
 * over must not resume in between, because the two fire-and-forget calls are
 * not ordered and a late resume would arm the combo being recorded.
 */
let activeStop: (() => void) | null = null;

/** Reads the currently held modifiers in the order the backend expects. */
function modifiersOf(e: Pick<KeyboardEvent, "ctrlKey" | "shiftKey" | "altKey">): string[] {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  return parts;
}

/**
 * Silences the registered hotkeys for the duration of a recording. Without it
 * the combo under the user's fingers triggers its own action while it is being
 * captured, which increments a counter or toggles a hunt behind the dialog.
 */
function pauseGlobalHotkeys(): void {
  fetch(apiUrl("/api/hotkeys/pause"), { method: "POST" }).catch(() => {});
  globalThis.electronAPI?.pauseHotkeys?.();
}

/** Re-arms the registered hotkeys after a recording ended, however it ended. */
function resumeGlobalHotkeys(): void {
  fetch(apiUrl("/api/hotkeys/resume"), { method: "POST" }).catch(() => {});
  globalThis.electronAPI?.resumeHotkeys?.();
}

/** What a recorder hands back to the section rendering the rows. */
export interface HotkeyRecorder<K extends string> {
  /** Id of the row currently capturing, or null while idle. */
  recording: K | null;
  /** Modifiers held right now, e.g. "Ctrl+Shift". Empty while none are down. */
  liveModifiers: string;
  /** Begins capturing for a row, pausing the registered hotkeys. */
  start: (id: K) => void;
  /** Aborts the current capture without writing anything. */
  cancel: () => void;
}

/**
 * Captures a key combo for one row at a time.
 *
 * `onCommit` receives the row id it was started with and the recorded combo;
 * it is responsible for persisting the binding. The registered hotkeys are
 * resumed once it settles, including when it throws, so a failed write can
 * never leave the app deaf to its own hotkeys.
 */
export function useHotkeyRecorder<K extends string>(
  onCommit: (id: K, combo: string) => void | Promise<void>,
): HotkeyRecorder<K> {
  const [recording, setRecording] = useState<K | null>(null);
  const [liveModifiers, setLiveModifiers] = useState("");

  // Held in a ref so the window listeners depend on the recording row alone.
  // A parent re-render would otherwise resubscribe and could drop a keystroke.
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  /** Drops out of capture mode without touching the pause. */
  const stop = useCallback(() => {
    setRecording(null);
    setLiveModifiers("");
  }, []);

  const cancel = useCallback(() => {
    activeStop = null;
    resumeGlobalHotkeys();
    stop();
  }, [stop]);

  const start = useCallback(
    (id: K) => {
      const alreadyPaused = activeStop !== null;
      activeStop?.();
      activeStop = stop;
      setRecording(id);
      setLiveModifiers("");
      if (!alreadyPaused) pauseGlobalHotkeys();
    },
    [stop],
  );

  // Leaving the page mid-capture would otherwise keep the hotkeys paused for
  // the rest of the session, with no row left to cancel from.
  useEffect(
    () => () => {
      if (activeStop !== stop) return;
      activeStop = null;
      resumeGlobalHotkeys();
    },
    [stop],
  );

  useEffect(() => {
    if (recording === null) return;

    const finish = (combo: string) => {
      activeStop = null;
      stop();
      void (async () => {
        try {
          await commitRef.current(recording, combo);
        } finally {
          resumeGlobalHotkeys();
        }
      })();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        cancel();
        return;
      }

      if (MODIFIER_KEYS.includes(e.key)) {
        setLiveModifiers(modifiersOf(e).join("+"));
        return;
      }

      const mainKey = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      finish([...modifiersOf(e), mainKey].join("+"));
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      setLiveModifiers(modifiersOf(e).join("+"));
    };

    globalThis.addEventListener("keydown", handleKeyDown);
    globalThis.addEventListener("keyup", handleKeyUp);
    return () => {
      globalThis.removeEventListener("keydown", handleKeyDown);
      globalThis.removeEventListener("keyup", handleKeyUp);
    };
  }, [recording, cancel, stop]);

  return { recording, liveModifiers, start, cancel };
}
