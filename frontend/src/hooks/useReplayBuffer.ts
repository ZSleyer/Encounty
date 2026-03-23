/**
 * useReplayBuffer.ts — Ring buffer of recent video frames at 60fps.
 *
 * Captures ImageData from a video element into a fixed-size ring buffer,
 * keeping the last 30 seconds of footage (1800 frames at 60fps).
 * Used for replay review after an auto-detection match.
 */
import { useEffect, useRef, useState, useCallback } from "react";

/** Result returned by the useReplayBuffer hook. */
export interface UseReplayBufferResult {
  /** Current frames in the ring buffer (oldest first). */
  frames: ImageData[];
  /** Number of frames currently buffered. */
  frameCount: number;
  /** Get a specific frame by index (0 = oldest). Returns null if out of range. */
  getFrame: (index: number) => ImageData | null;
  /** Whether the buffer is actively capturing frames. */
  isBuffering: boolean;
  /** Seconds of footage currently buffered. */
  bufferedSeconds: number;
  /** Clear all buffered frames. */
  clear: () => void;
  /** Stop capturing new frames (freezes the buffer). */
  stop: () => void;
  /** Restart capturing after a stop (clears buffer and begins fresh). */
  restart: () => void;
}

/** Default replay buffer duration in seconds. */
const DEFAULT_DURATION_SEC = 30;

/** Default capture rate in frames per second. */
const DEFAULT_FPS = 60;

/**
 * Maintains a ring buffer of video frames captured from an HTMLVideoElement.
 *
 * @param videoElement - The video element to capture frames from (from CaptureService)
 * @param durationSec - How many seconds of footage to keep (default 30)
 * @param fps - Capture rate in frames per second (default 60)
 */
export function useReplayBuffer(
  videoElement: HTMLVideoElement | null | undefined,
  durationSec = DEFAULT_DURATION_SEC,
  fps = DEFAULT_FPS,
): UseReplayBufferResult {
  const [frameCount, setFrameCount] = useState(0);
  const [isBuffering, setIsBuffering] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const intervalRef = useRef<number | null>(null);
  // Ring buffer implemented as a fixed-size array with a write pointer
  const bufferRef = useRef<ImageData[]>([]);
  const writeIndexRef = useRef(0);
  const filledRef = useRef(0);

  const maxFrames = durationSec * fps;
  const captureIntervalMs = Math.round(1000 / fps);

  const clear = useCallback(() => {
    bufferRef.current = [];
    writeIndexRef.current = 0;
    filledRef.current = 0;
    setFrameCount(0);
  }, []);

  const stop = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsBuffering(false);
  }, []);

  /** Restart capturing after a stop — clears the buffer and begins fresh. */
  const restart = useCallback(() => {
    // Stop any existing capture
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    // Reset buffer state
    const buf: ImageData[] = new Array(maxFrames);
    bufferRef.current = buf;
    writeIndexRef.current = 0;
    filledRef.current = 0;
    setFrameCount(0);
    // Restart capture if video element is available
    if (videoElement && videoElement.readyState >= 2 && canvasRef.current) {
      const canvas = canvasRef.current;
      const captureFrame = () => {
        if (!videoElement || videoElement.videoWidth === 0 || videoElement.videoHeight === 0) return;
        if (canvas.width !== videoElement.videoWidth) canvas.width = videoElement.videoWidth;
        if (canvas.height !== videoElement.videoHeight) canvas.height = videoElement.videoHeight;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const wi = writeIndexRef.current;
        buf[wi] = imageData;
        writeIndexRef.current = (wi + 1) % maxFrames;
        if (filledRef.current < maxFrames) filledRef.current += 1;
        setFrameCount(filledRef.current);
      };
      setIsBuffering(true);
      intervalRef.current = window.setInterval(captureFrame, captureIntervalMs);
    }
  }, [videoElement, maxFrames, captureIntervalMs]);

  const getFrame = useCallback((index: number): ImageData | null => {
    const filled = filledRef.current;
    if (index < 0 || index >= filled) return null;

    const buf = bufferRef.current;
    if (filled < maxFrames) {
      // Buffer hasn't wrapped yet — index directly
      return buf[index] ?? null;
    }
    // Buffer has wrapped — oldest frame is at writeIndex
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
    const buf: ImageData[] = new Array(maxFrames);
    bufferRef.current = buf;
    writeIndexRef.current = 0;
    filledRef.current = 0;

    const captureFrame = () => {
      if (!videoElement || videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
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

      const wi = writeIndexRef.current;
      buf[wi] = imageData;
      writeIndexRef.current = (wi + 1) % maxFrames;
      if (filledRef.current < maxFrames) {
        filledRef.current += 1;
      }
      setFrameCount(filledRef.current);
    };

    const startCapture = () => {
      setIsBuffering(true);
      intervalRef.current = window.setInterval(captureFrame, captureIntervalMs);
    };

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
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setIsBuffering(false);
      canvasRef.current = null;
    };
  }, [videoElement, maxFrames, captureIntervalMs]);

  const bufferedSeconds = frameCount / fps;

  // Build an ordered view of the ring buffer for consumers
  const frames = useCallback((): ImageData[] => {
    const filled = filledRef.current;
    const buf = bufferRef.current;
    if (filled === 0) return [];
    if (filled < maxFrames) {
      return buf.slice(0, filled);
    }
    // Buffer has wrapped — return oldest-first
    const wi = writeIndexRef.current;
    return [...buf.slice(wi), ...buf.slice(0, wi)];
  }, [maxFrames]);

  return {
    get frames() { return frames(); },
    frameCount,
    getFrame,
    isBuffering,
    bufferedSeconds,
    clear,
    stop,
    restart,
  };
}
