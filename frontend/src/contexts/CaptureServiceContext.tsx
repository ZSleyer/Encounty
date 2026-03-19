/**
 * CaptureServiceContext.tsx — Per-pokemon browser capture service.
 *
 * Each pokemon gets its own independent MediaStream (display or camera)
 * that survives route changes because the provider lives in AppShell.
 * Streams, hidden video elements, and frame dispatch loops are stored
 * per pokemon ID in a map that persists across sidebar navigation.
 */
import React, {
  createContext,
  useContext,
  useRef,
  useCallback,
  useEffect,
  useSyncExternalStore,
} from "react";
import { useCounterStore } from "../hooks/useCounterState";

// --- Types -------------------------------------------------------------------

interface CaptureEntry {
  pokemonId: string;
  sourceType: "browser_display" | "browser_camera";
  stream: MediaStream;
  videoEl: HTMLVideoElement;
  canvas: HTMLCanvasElement | null;
  /** When non-null, this entry is actively submitting frames. */
  pollMs: number | null;
  lastDispatch: number;
  loopTimer: ReturnType<typeof setTimeout> | null;
  /** Display name of the selected source (e.g. "Screen 1", "OBS Virtual Camera"). */
  sourceLabel: string;
}

interface CaptureServiceContextValue {
  /** Start a capture for a specific pokemon. Optional sourceId/sourceLabel for pre-selected sources, existingStream for reuse. */
  startCapture: (
    pokemonId: string,
    sourceType: "browser_display" | "browser_camera",
    sourceId?: string,
    sourceLabel?: string,
    existingStream?: MediaStream,
  ) => Promise<void>;
  /** Stop and release the capture for a specific pokemon. */
  stopCapture: (pokemonId: string) => void;
  /** Get the active stream for a pokemon (for preview). */
  getStream: (pokemonId: string) => MediaStream | null;
  /** Check if a pokemon has an active capture. */
  isCapturing: (pokemonId: string) => boolean;
  /** Get the display label of the connected source for a pokemon. */
  getSourceLabel: (pokemonId: string) => string | null;

  /** Start submitting frames for a pokemon (begins dispatch loop). */
  registerSubmitter: (pokemonId: string, pollMs: number) => void;
  /** Stop submitting frames for a pokemon. */
  unregisterSubmitter: (pokemonId: string) => void;
  /** Update polling interval for a running submitter. */
  updateSubmitterInterval: (pokemonId: string, pollMs: number) => void;

  /** Last capture error message. */
  captureError: string | null;

  /** Subscribe to stream changes for a specific pokemon. Returns a version counter. */
  getVersion: () => number;
  subscribe: (cb: () => void) => () => void;
}

const CaptureServiceContext = createContext<CaptureServiceContextValue | null>(null);

// --- Provider ----------------------------------------------------------------

export function CaptureServiceProvider({ children }: { children: React.ReactNode }) {
  // All capture entries keyed by pokemon ID
  const entriesRef = useRef<Map<string, CaptureEntry>>(new Map());
  // Container for hidden video elements
  const containerRef = useRef<HTMLDivElement>(null);
  // Error state — stored as ref + version bump for sync
  const captureErrorRef = useRef<string | null>(null);

  // Version counter to notify subscribers of stream changes
  const versionRef = useRef(0);
  const listenersRef = useRef<Set<() => void>>(new Set());

  const notify = useCallback(() => {
    versionRef.current += 1;
    for (const cb of listenersRef.current) cb();
  }, []);

  const subscribe = useCallback((cb: () => void) => {
    listenersRef.current.add(cb);
    return () => { listenersRef.current.delete(cb); };
  }, []);

  const getVersion = useCallback(() => versionRef.current, []);

  // Access app state to detect deleted pokemon
  const appState = useCounterStore((s) => s.appState);

  // --- Helpers ---------------------------------------------------------------

  const captureFrame = (entry: CaptureEntry): Promise<Blob | null> => {
    const video = entry.videoEl;
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      return Promise.resolve(null);
    }
    if (!entry.canvas) entry.canvas = document.createElement("canvas");
    const canvas = entry.canvas;
    if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
    if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return Promise.resolve(null);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    // Detect green frames (Windows GPU capture artifact: solid #00FF00)
    const sample = ctx.getImageData(
      Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1
    ).data;
    if (sample[0] === 0 && sample[1] === 255 && sample[2] === 0) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.7);
    });
  };

  const startLoop = useCallback((entry: CaptureEntry) => {
    if (entry.loopTimer !== null) {
      clearTimeout(entry.loopTimer);
      entry.loopTimer = null;
    }
    if (entry.pollMs === null) return;

    const tick = async () => {
      // Entry might have been removed while we were awaiting
      if (!entriesRef.current.has(entry.pokemonId)) return;
      if (entry.pollMs === null) return;

      const blob = await captureFrame(entry);
      if (blob) {
        entry.lastDispatch = Date.now();
        fetch(`/api/detector/${entry.pokemonId}/match_frame`, {
          method: "POST",
          body: blob,
        }).catch(() => {});
      }

      if (entry.pollMs !== null && entriesRef.current.has(entry.pokemonId)) {
        entry.loopTimer = setTimeout(tick, Math.max(10, entry.pollMs));
      }
    };

    tick();
  }, []);

  const cleanupEntry = useCallback((pokemonId: string) => {
    const entry = entriesRef.current.get(pokemonId);
    if (!entry) return;
    if (entry.loopTimer !== null) clearTimeout(entry.loopTimer);
    entry.stream.getTracks().forEach((t) => t.stop());
    entry.videoEl.srcObject = null;
    entry.videoEl.remove();
    entriesRef.current.delete(pokemonId);
    notify();
  }, [notify]);

  // --- Public API ------------------------------------------------------------

  const startCapture = useCallback(async (
    pokemonId: string,
    sourceType: "browser_display" | "browser_camera",
    sourceId?: string,
    sourceLabel?: string,
    existingStream?: MediaStream,
  ) => {
    // If already has a capture, stop it first
    if (entriesRef.current.has(pokemonId)) {
      cleanupEntry(pokemonId);
    }

    captureErrorRef.current = null;
    notify();

    try {
      let stream: MediaStream;
      let label = sourceLabel ?? "";

      if (existingStream) {
        // Reuse a pre-acquired stream (e.g. camera preview from SourcePickerModal)
        stream = existingStream;
        if (!label) {
          label = stream.getVideoTracks()[0]?.label ?? "";
        }
      } else if (sourceType === "browser_display") {
        if (!navigator.mediaDevices?.getDisplayMedia) {
          captureErrorRef.current = "getDisplayMedia not available. Ensure context is secure (HTTPS/localhost).";
          notify();
          return;
        }
        // In Electron with a pre-selected source, tell main process first
        if (sourceId && window.electronAPI) {
          await window.electronAPI.selectCaptureSource(sourceId);
        }
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { displaySurface: "window" },
          audio: false,
        });
      } else {
        if (!navigator.mediaDevices?.getUserMedia) {
          captureErrorRef.current = "getUserMedia not available. Ensure context is secure (HTTPS/localhost).";
          notify();
          return;
        }
        const videoConstraints: MediaTrackConstraints | boolean = sourceId
          ? { deviceId: { exact: sourceId } }
          : true;
        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        });
        // Derive label from track if not provided
        if (!label) {
          label = stream.getVideoTracks()[0]?.label ?? "";
        }
      }

      // Create hidden video element
      const videoEl = document.createElement("video");
      videoEl.autoplay = true;
      videoEl.playsInline = true;
      videoEl.muted = true;
      videoEl.style.cssText = "width:1px;height:1px;pointer-events:none";
      containerRef.current?.appendChild(videoEl);
      videoEl.srcObject = stream;
      videoEl.play().catch(() => {});

      const entry: CaptureEntry = {
        pokemonId,
        sourceType,
        stream,
        videoEl,
        canvas: null,
        pollMs: null,
        lastDispatch: 0,
        loopTimer: null,
        sourceLabel: label,
      };

      entriesRef.current.set(pokemonId, entry);

      // Handle user clicking "Stop sharing" in browser chrome
      stream.getVideoTracks()[0].onended = () => {
        cleanupEntry(pokemonId);
        fetch(`/api/detector/${pokemonId}/stop`, { method: "POST" }).catch(() => {});
      };

      notify();
    } catch (err: any) {
      captureErrorRef.current = err.message || err.name || "Failed to start capture";
      notify();
    }
  }, [cleanupEntry, notify]);

  const stopCapture = useCallback((pokemonId: string) => {
    cleanupEntry(pokemonId);
  }, [cleanupEntry]);

  const getStream = useCallback((pokemonId: string): MediaStream | null => {
    return entriesRef.current.get(pokemonId)?.stream ?? null;
  }, []);

  const isCapturing = useCallback((pokemonId: string): boolean => {
    return entriesRef.current.has(pokemonId);
  }, []);

  const getSourceLabel = useCallback((pokemonId: string): string | null => {
    return entriesRef.current.get(pokemonId)?.sourceLabel ?? null;
  }, []);

  const registerSubmitter = useCallback((pokemonId: string, pollMs: number) => {
    const entry = entriesRef.current.get(pokemonId);
    if (!entry) return;
    entry.pollMs = pollMs;
    entry.lastDispatch = 0;
    startLoop(entry);
  }, [startLoop]);

  const unregisterSubmitter = useCallback((pokemonId: string) => {
    const entry = entriesRef.current.get(pokemonId);
    if (!entry) return;
    if (entry.loopTimer !== null) {
      clearTimeout(entry.loopTimer);
      entry.loopTimer = null;
    }
    entry.pollMs = null;
  }, []);

  const updateSubmitterInterval = useCallback((pokemonId: string, pollMs: number) => {
    const entry = entriesRef.current.get(pokemonId);
    if (entry) entry.pollMs = pollMs;
  }, []);

  // --- Edge case: pokemon deleted while detector running ---------------------

  useEffect(() => {
    if (!appState) return;
    const pokemonIds = new Set(appState.pokemon.map((p) => p.id));
    const toRemove: string[] = [];
    for (const [id] of entriesRef.current) {
      if (!pokemonIds.has(id)) toRemove.push(id);
    }
    for (const id of toRemove) {
      cleanupEntry(id);
      fetch(`/api/detector/${id}/stop`, { method: "POST" }).catch(() => {});
    }
  }, [appState, cleanupEntry]);

  // --- Cleanup on unmount ----------------------------------------------------

  useEffect(() => {
    return () => {
      for (const [, entry] of entriesRef.current) {
        if (entry.loopTimer !== null) clearTimeout(entry.loopTimer);
        entry.stream.getTracks().forEach((t) => t.stop());
        entry.videoEl.srcObject = null;
        entry.videoEl.remove();
      }
      entriesRef.current.clear();
    };
  }, []);

  const value: CaptureServiceContextValue = {
    startCapture,
    stopCapture,
    getStream,
    isCapturing,
    getSourceLabel,
    registerSubmitter,
    unregisterSubmitter,
    updateSubmitterInterval,
    get captureError() { return captureErrorRef.current; },
    getVersion,
    subscribe,
  };

  return (
    <CaptureServiceContext.Provider value={value}>
      {children}
      {/* Container for dynamically created hidden video elements */}
      <div
        ref={containerRef}
        style={{ position: "fixed", top: -9999, left: -9999, width: 1, height: 1, overflow: "hidden", pointerEvents: "none" }}
      />
    </CaptureServiceContext.Provider>
  );
}

// --- Hook --------------------------------------------------------------------

/** Access the capture service context. */
export function useCaptureService(): CaptureServiceContextValue {
  const ctx = useContext(CaptureServiceContext);
  if (!ctx) throw new Error("useCaptureService must be used within CaptureServiceProvider");
  return ctx;
}

/**
 * Subscribe to capture state changes for reactive re-renders.
 * Returns a version number that increments on every stream change.
 */
export function useCaptureVersion(): number {
  const ctx = useCaptureService();
  return useSyncExternalStore(ctx.subscribe, ctx.getVersion);
}
