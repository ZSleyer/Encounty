/**
 * useReplayBuffer.ts - Ring buffer of recent video frames at 60fps.
 *
 * Captures ImageData from a video element into a fixed-size ring buffer,
 * keeping the last 5 seconds of footage (300 frames at 60fps). On demand
 * the ring can be extended once (see extend): capture then appends past the
 * ring for up to 5 more seconds without overwriting, for a total of up to
 * 10 seconds. Used for replay review and template snapshot selection.
 */
import { useEffect, useRef, useState, useCallback } from "react";

/** Result returned by the useReplayBuffer hook. */
export interface UseReplayBufferResult {
  /** Current frames in the ring buffer (oldest first). */
  frames: ImageData[];
  /** Number of frames currently buffered. */
  frameCount: number;
  /**
   * Number of frames buffered at the moment extend() was called; equals
   * frameCount while not extended. The replay UI scopes to this count so the
   * extension frames stay invisible until the test step.
   */
  snapshotFrameCount: number;
  /** Seconds of footage covered by snapshotFrameCount. */
  snapshotSeconds: number;
  /** Get a specific frame by index (0 = oldest). Returns null if out of range. */
  getFrame: (index: number) => ImageData | null;
  /** Whether the buffer is actively capturing frames. */
  isBuffering: boolean;
  /** Seconds of footage currently buffered. */
  bufferedSeconds: number;
  /** Maximum buffer duration in seconds (grows once extended). */
  maxSeconds: number;
  /** Clear all buffered frames. */
  clear: () => void;
  /** Stop capturing new frames (freezes the buffer). */
  stop: () => void;
  /** Restart capturing after a stop (clears buffer and begins fresh). */
  restart: () => void;
  /**
   * Switch from ring mode to append mode without interrupting capture:
   * existing frames are kept in order and capture continues seamlessly for
   * up to durationSec more seconds, then stops automatically. No frame is
   * overwritten after this call. No-op if already extended. Cleared by
   * clear() and restart(). Returns the frame count at the time of the call
   * (the frozen snapshotFrameCount).
   */
  extend: () => number;
}

/** Default replay buffer duration in seconds. */
const DEFAULT_DURATION_SEC = 5;

/** Default capture rate in frames per second. */
const DEFAULT_FPS = 60;

/**
 * Maintains a ring buffer of video frames captured from an HTMLVideoElement.
 *
 * @param videoElement - The video element to capture frames from (from CaptureService)
 * @param durationSec - How many seconds of footage to keep (default 5)
 * @param fps - Capture rate in frames per second (default 60)
 */
export function useReplayBuffer(
  videoElement: HTMLVideoElement | null | undefined,
  durationSec = DEFAULT_DURATION_SEC,
  fps = DEFAULT_FPS,
): UseReplayBufferResult {
  const [frameCount, setFrameCount] = useState(0);
  const [isBuffering, setIsBuffering] = useState(false);
  // Frame count frozen at extend() time; null while not extended
  const [extendBase, setExtendBase] = useState<number | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const intervalRef = useRef<ReturnType<typeof globalThis.setInterval> | null>(null);
  // Ring buffer implemented as a fixed-size array with a write pointer.
  // After extend() the array becomes a plain append-only list (oldest first).
  const bufferRef = useRef<ImageData[]>([]);
  const writeIndexRef = useRef(0);
  const filledRef = useRef(0);
  const extendedRef = useRef(false);
  // Frame count at which extended capture stops (frames at extend + maxFrames)
  const extendCapRef = useRef(0);

  const maxFrames = durationSec * fps;
  const captureIntervalMs = Math.round(1000 / fps);

  const stopInterval = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  /** Capture one frame from the video element into the buffer. */
  const captureFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !videoElement || videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
      return;
    }

    if (canvas.width !== videoElement.videoWidth) {
      canvas.width = videoElement.videoWidth;
    }
    if (canvas.height !== videoElement.videoHeight) {
      canvas.height = videoElement.videoHeight;
    }

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const buf = bufferRef.current;
    if (extendedRef.current) {
      // Append mode: never overwrite; stop once the extension window is full
      buf[filledRef.current] = imageData;
      filledRef.current += 1;
      if (filledRef.current >= extendCapRef.current) {
        stopInterval();
        setIsBuffering(false);
      }
    } else {
      const wi = writeIndexRef.current;
      buf[wi] = imageData;
      writeIndexRef.current = (wi + 1) % maxFrames;
      if (filledRef.current < maxFrames) {
        filledRef.current += 1;
      }
    }
    setFrameCount(filledRef.current);
  }, [videoElement, maxFrames, stopInterval]);

  const startCapture = useCallback(() => {
    setIsBuffering(true);
    intervalRef.current = globalThis.setInterval(captureFrame, captureIntervalMs);
  }, [captureFrame, captureIntervalMs]);

  const clear = useCallback(() => {
    // Explicitly null out all slots so GC can reclaim ImageData sooner
    const buf = bufferRef.current;
    for (let i = 0; i < buf.length; i++) {
      (buf as (ImageData | undefined)[])[i] = undefined;
    }
    bufferRef.current = [];
    writeIndexRef.current = 0;
    filledRef.current = 0;
    extendedRef.current = false;
    extendCapRef.current = 0;
    setExtendBase(null);
    setFrameCount(0);
  }, []);

  const stop = useCallback(() => {
    stopInterval();
    setIsBuffering(false);
  }, [stopInterval]);

  /** Restart capturing after a stop - clears the buffer and begins fresh ring capture. */
  const restart = useCallback(() => {
    stopInterval();
    // Reset buffer state back to ring mode
    bufferRef.current = new Array(maxFrames);
    writeIndexRef.current = 0;
    filledRef.current = 0;
    extendedRef.current = false;
    extendCapRef.current = 0;
    setExtendBase(null);
    setFrameCount(0);
    if (videoElement && videoElement.readyState >= 2 && canvasRef.current) {
      startCapture();
    }
  }, [videoElement, maxFrames, stopInterval, startCapture]);

  /** Unroll the ring into an oldest-first array and switch to append mode. */
  const extend = useCallback((): number => {
    const filled = filledRef.current;
    if (extendedRef.current) return extendCapRef.current - maxFrames;
    const buf = bufferRef.current;
    const ordered = filled < maxFrames
      ? buf.slice(0, filled)
      : [...buf.slice(writeIndexRef.current), ...buf.slice(0, writeIndexRef.current)];
    bufferRef.current = ordered;
    writeIndexRef.current = filled;
    extendedRef.current = true;
    extendCapRef.current = filled + maxFrames;
    setExtendBase(filled);
    return filled;
  }, [maxFrames]);

  const getFrame = useCallback((index: number): ImageData | null => {
    const filled = filledRef.current;
    if (index < 0 || index >= filled) return null;

    const buf = bufferRef.current;
    if (extendedRef.current || filled < maxFrames) {
      // Linear layout (append mode, or ring that hasn't wrapped yet)
      return buf[index] ?? null;
    }
    // Ring has wrapped: oldest frame is at writeIndex
    const actualIndex = (writeIndexRef.current + index) % maxFrames;
    return buf[actualIndex] ?? null;
  }, [maxFrames]);

  useEffect(() => {
    if (!videoElement) {
      setIsBuffering(false);
      return;
    }

    const canvas = document.createElement("canvas");
    canvasRef.current = canvas;

    // Pre-allocate the ring buffer array
    bufferRef.current = new Array(maxFrames);
    writeIndexRef.current = 0;
    filledRef.current = 0;
    extendedRef.current = false;
    extendCapRef.current = 0;
    setExtendBase(null);

    // Wait for the video to be ready before starting capture
    if (videoElement.readyState >= 2) {
      startCapture();
    } else {
      const onReady = () => {
        videoElement.removeEventListener("loadeddata", onReady);
        startCapture();
      };
      videoElement.addEventListener("loadeddata", onReady);
    }

    return () => {
      stopInterval();
      setIsBuffering(false);
      canvasRef.current = null;
    };
  }, [videoElement, maxFrames, startCapture, stopInterval]);

  const bufferedSeconds = frameCount / fps;
  const maxSeconds = extendedRef.current ? extendCapRef.current / fps : durationSec;
  const snapshotFrameCount = extendBase ?? frameCount;
  const snapshotSeconds = snapshotFrameCount / fps;

  // Build an ordered view of the buffer for consumers
  const frames = useCallback((): ImageData[] => {
    const filled = filledRef.current;
    const buf = bufferRef.current;
    if (filled === 0) return [];
    if (extendedRef.current || filled < maxFrames) {
      return buf.slice(0, filled);
    }
    // Ring has wrapped: return oldest-first
    const wi = writeIndexRef.current;
    return [...buf.slice(wi), ...buf.slice(0, wi)];
  }, [maxFrames]);

  return {
    get frames() { return frames(); },
    frameCount,
    snapshotFrameCount,
    snapshotSeconds,
    getFrame,
    isBuffering,
    bufferedSeconds,
    maxSeconds,
    clear,
    stop,
    restart,
    extend,
  };
}
