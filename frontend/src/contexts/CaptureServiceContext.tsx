/**
 * CaptureServiceContext.tsx — Per-pokemon browser capture service.
 *
 * Each pokemon gets its own independent MediaStream (display or camera)
 * that survives route changes because the provider lives in AppShell.
 * Streams, hidden video elements, and source labels are stored per
 * pokemon ID in a map that persists across sidebar navigation.
 *
 * Detection is handled externally by DetectionLoop which reads the
 * video element via getVideoElement().
 */
import React, {
  createContext,
  useContext,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { useCounterStore } from "../hooks/useCounterState";
import { saveLastSource } from "../utils/captureSourceMemory";
import { apiUrl } from "../utils/api";

/**
 * Notify the backend that a Pokémon currently has (or no longer has) an
 * attached browser capture stream. The backend uses this to gate the
 * hunt-toggle hotkey: without a registered source the timer is refused
 * instead of flipping briefly and being rolled back — which would cause
 * a visible UI flicker.
 *
 * Errors are swallowed so capture logic keeps working even when the
 * backend is unreachable.
 */
function postCaptureState(pokemonId: string, capturing: boolean): void {
  try {
    void fetch(apiUrl("/api/capture/state"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pokemon_id: pokemonId, capturing }),
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}


// --- Types -------------------------------------------------------------------

/** Supported capture source types. dev_video is only available in dev mode. */
export type CaptureSourceType = "browser_display" | "browser_camera" | "dev_video";

interface CaptureEntry {
  pokemonId: string;
  sourceType: CaptureSourceType;
  stream: MediaStream;
  videoEl: HTMLVideoElement;
  /** Display name of the selected source (e.g. "Screen 1", "OBS Virtual Camera"). */
  sourceLabel: string;
}

interface CaptureServiceContextValue {
  /** Start a capture for a specific pokemon. Optional sourceId/sourceLabel for pre-selected sources, existingStream for reuse. */
  startCapture: (
    pokemonId: string,
    sourceType: CaptureSourceType,
    sourceId?: string,
    sourceLabel?: string,
    existingStream?: MediaStream,
  ) => Promise<void>;
  /** Stop and release the capture for a specific pokemon. */
  stopCapture: (pokemonId: string) => void;
  /** Get the active stream for a pokemon (for preview rendering). */
  getStream: (pokemonId: string) => MediaStream | null;
  /** Get the hidden video element playing the capture stream, for WebGPU detection. */
  getVideoElement: (pokemonId: string) => HTMLVideoElement | null;
  /** Check if a pokemon has an active capture. */
  isCapturing: (pokemonId: string) => boolean;
  /** Get the display label of the connected source for a pokemon. */
  getSourceLabel: (pokemonId: string) => string | null;

  /** Last capture error message. */
  captureError: string | null;

  /** Subscribe to stream changes for a specific pokemon. Returns a version counter. */
  getVersion: () => number;
  subscribe: (cb: () => void) => () => void;
}

const CaptureServiceContext = createContext<CaptureServiceContextValue | null>(null);

// --- Green frame detection ---------------------------------------------------

/** Detect solid green frames — a common Windows GPU capture artifact (#00FF00). */
function isGreenFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): boolean {
  if (video.videoWidth === 0 || video.videoHeight === 0) return false;
  if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
  if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const sample = ctx.getImageData(
    Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1,
  ).data;
  return sample[0] === 0 && sample[1] === 255 && sample[2] === 0;
}

// --- Provider ----------------------------------------------------------------

/** Provides per-pokemon browser capture (getDisplayMedia / getUserMedia) to the component tree. */
export function CaptureServiceProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const entriesRef = useRef<Map<string, CaptureEntry>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const captureErrorRef = useRef<string | null>(null);

  // Scratch canvas for green-frame checks during stream setup
  const scratchCanvasRef = useRef<HTMLCanvasElement>(document.createElement("canvas"));

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

  const appState = useCounterStore((s) => s.appState);

  // --- Helpers ---------------------------------------------------------------

  const cleanupEntry = useCallback((pokemonId: string) => {
    const entry = entriesRef.current.get(pokemonId);
    if (!entry) return;
    entry.stream.getTracks().forEach((t) => t.stop());
    entry.videoEl.srcObject = null;
    entry.videoEl.remove();
    entriesRef.current.delete(pokemonId);
    postCaptureState(pokemonId, false);
    notify();
  }, [notify]);

  // --- Stream acquisition helpers ---------------------------------------------

  /** Acquire a display stream via getDisplayMedia. Throws if unavailable. */
  const acquireDisplayStream = async (
    sourceId?: string,
  ): Promise<MediaStream> => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error("getDisplayMedia not available. Ensure context is secure (HTTPS/localhost).");
    }

    const isElectron = !!globalThis.electronAPI;

    // In Electron with a pre-selected source, tell main process and WAIT for
    // the IPC to complete so pendingSourceId is set before getDisplayMedia
    // triggers the handler. Electron's setDisplayMediaRequestHandler does not
    // require a user gesture, so awaiting is safe here.
    if (sourceId && isElectron) {
      await globalThis.electronAPI!.selectCaptureSource(sourceId);
    }

    try {
      return await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
    } catch (err) {
      // Electron ≥41.1 regression: desktopCapturer source IDs may produce
      // OverconstrainedError on deviceId. Fall back to the native system
      // picker (macOS/Windows) automatically. Linux/Wayland already uses
      // the system picker and never reaches this code path.
      const isOverconstrained = err instanceof Error && err.name === "OverconstrainedError";

      if (isOverconstrained && isElectron) {
        console.warn("[CaptureService] OverconstrainedError — falling back to system picker");
        await globalThis.electronAPI!.setSystemPicker(true);
        try {
          const stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: false,
          });
          globalThis.electronAPI!.setSystemPicker(false);
          return stream;
        } catch (retryErr) {
          globalThis.electronAPI!.setSystemPicker(false);
          throw retryErr;
        }
      }
      throw err;
    }
  };

  /** Acquire a stream from a local dev video file. Throws if sourceId is missing. */
  const acquireDevVideoStream = async (
    sourceId: string | undefined,
    sourceLabel: string | undefined,
  ): Promise<{ stream: MediaStream; label: string }> => {
    if (!sourceId) throw new Error("No video file selected");
    const devVideo = document.createElement("video");
    devVideo.src = sourceId;
    devVideo.loop = true;
    devVideo.muted = true;
    devVideo.playsInline = true;
    devVideo.autoplay = true;
    await devVideo.play();
    // captureStream creates a MediaStream from the <video> element
    const stream = (devVideo as HTMLVideoElement & { captureStream(): MediaStream }).captureStream();
    // Keep the source video alive by attaching it to the hidden container
    devVideo.style.cssText = "width:1px;height:1px;pointer-events:none;position:fixed;top:-9999px";
    containerRef.current?.appendChild(devVideo);
    return { stream, label: sourceLabel || "Dev Video" };
  };

  /** Acquire a camera stream via getUserMedia. Throws if unavailable. */
  const acquireCameraStream = async (
    sourceId?: string,
  ): Promise<MediaStream> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("getUserMedia not available. Ensure context is secure (HTTPS/localhost).");
    }
    const videoConstraints: MediaTrackConstraints | boolean = sourceId
      ? { deviceId: { exact: sourceId } }
      : true;
    return navigator.mediaDevices.getUserMedia({
      video: videoConstraints,
      audio: false,
    });
  };

  /** Create a hidden video element, attach the stream, and wait for the first real frame. */
  const attachStreamToVideo = async (stream: MediaStream): Promise<HTMLVideoElement> => {
    const videoEl = document.createElement("video");
    videoEl.autoplay = true;
    videoEl.playsInline = true;
    videoEl.muted = true;
    videoEl.style.cssText = "width:1px;height:1px;pointer-events:none";
    containerRef.current?.appendChild(videoEl);
    videoEl.srcObject = stream;
    videoEl.play().catch(() => {});

    // Wait for first frame
    await new Promise<void>((resolve) => {
      const onFrame = () => {
        videoEl.removeEventListener("loadeddata", onFrame);
        resolve();
      };
      if (videoEl.readyState >= 2) resolve();
      else videoEl.addEventListener("loadeddata", onFrame);
    });

    if (isGreenFrame(videoEl, scratchCanvasRef.current)) {
      // First frame is a green GPU artifact — wait briefly for a real frame
      await new Promise((r) => setTimeout(r, 200));
    }

    return videoEl;
  };

  // --- Public API ------------------------------------------------------------

  const startCapture = useCallback(async (
    pokemonId: string,
    sourceType: CaptureSourceType,
    sourceId?: string,
    sourceLabel?: string,
    existingStream?: MediaStream,
  ) => {
    // Stop existing capture for this pokemon first
    if (entriesRef.current.has(pokemonId)) {
      cleanupEntry(pokemonId);
    }

    captureErrorRef.current = null;
    notify();

    try {
      let stream: MediaStream;
      let label = sourceLabel ?? "";

      if (existingStream) {
        stream = existingStream;
        if (!label) label = stream.getVideoTracks()[0]?.label ?? "";
      } else if (sourceType === "browser_display") {
        stream = await acquireDisplayStream(sourceId);
      } else if (sourceType === "dev_video") {
        const result = await acquireDevVideoStream(sourceId, sourceLabel);
        stream = result.stream;
        label = result.label;
      } else {
        stream = await acquireCameraStream(sourceId);
        if (!label) label = stream.getVideoTracks()[0]?.label ?? "";
      }

      const videoEl = await attachStreamToVideo(stream);

      const entry: CaptureEntry = {
        pokemonId,
        sourceType,
        stream,
        videoEl,
        sourceLabel: label,
      };

      entriesRef.current.set(pokemonId, entry);
      postCaptureState(pokemonId, true);

      // Handle user clicking "Stop sharing" in browser chrome
      stream.getVideoTracks()[0].onended = () => {
        cleanupEntry(pokemonId);
      };

      // Persist the source so it can be auto-restored next time. dev_video is
      // a local file URL that is never reusable across sessions — skip it.
      // We also need a real sourceId; display capture without a preselected
      // source (e.g. Wayland portal path) doesn't give us one to remember.
      if (sourceId && (sourceType === "browser_display" || sourceType === "browser_camera")) {
        saveLastSource(pokemonId, {
          type: sourceType,
          sourceId,
          sourceLabel: label,
        });
      }

      notify();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      captureErrorRef.current = message || "Failed to start capture";
      notify();
    }
  }, [cleanupEntry, notify]);

  const stopCapture = useCallback((pokemonId: string) => {
    cleanupEntry(pokemonId);
  }, [cleanupEntry]);

  const getStream = useCallback((pokemonId: string): MediaStream | null => {
    return entriesRef.current.get(pokemonId)?.stream ?? null;
  }, []);

  const getVideoElement = useCallback((pokemonId: string): HTMLVideoElement | null => {
    return entriesRef.current.get(pokemonId)?.videoEl ?? null;
  }, []);

  const isCapturing = useCallback((pokemonId: string): boolean => {
    return entriesRef.current.has(pokemonId);
  }, []);

  const getSourceLabel = useCallback((pokemonId: string): string | null => {
    return entriesRef.current.get(pokemonId)?.sourceLabel ?? null;
  }, []);

  // --- Edge case: pokemon deleted while capture is running -------------------

  useEffect(() => {
    if (!appState) return;
    const pokemonIds = new Set(appState.pokemon.map((p) => p.id));
    const toRemove: string[] = [];
    for (const [id] of entriesRef.current) {
      if (!pokemonIds.has(id)) toRemove.push(id);
    }
    for (const id of toRemove) {
      cleanupEntry(id);
    }
  }, [appState, cleanupEntry]);

  // --- Cleanup on unmount ----------------------------------------------------

  useEffect(() => {
    return () => {
      for (const [, entry] of entriesRef.current) {
        entry.stream.getTracks().forEach((t) => t.stop());
        entry.videoEl.srcObject = null;
        entry.videoEl.remove();
      }
      entriesRef.current.clear();
    };
  }, []);

  const value: CaptureServiceContextValue = useMemo(() => ({
    startCapture,
    stopCapture,
    getStream,
    getVideoElement,
    isCapturing,
    getSourceLabel,
    get captureError() { return captureErrorRef.current; },
    getVersion,
    subscribe,
  }), [startCapture, stopCapture, getStream, getVideoElement, isCapturing, getSourceLabel, getVersion, subscribe]);

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

// --- Hooks -------------------------------------------------------------------

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
