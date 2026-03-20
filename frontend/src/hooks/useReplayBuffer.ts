import { useEffect, useRef, useState, useCallback } from "react";

export type UseReplayBufferResult = {
  frameCount: number;
  getFrame: (index: number) => ImageBitmap | null;
  isBuffering: boolean;
  /** Seconds of footage currently buffered. */
  bufferedSeconds: number;
  clear: () => void;
  /** Stop capturing new frames (freezes the buffer). */
  stop: () => void;
  /** Resume capturing after a stop — clears old frames and restarts the capture loop. */
  resume: () => void;
};

/** State update throttle interval (ms). */
const STATE_UPDATE_INTERVAL_MS = 250;

/**
 * Continuously captures video frames into a time-limited ring buffer.
 *
 * Uses requestVideoFrameCallback (when available) to capture at the
 * native frame rate of the source, falling back to a 60 FPS setInterval.
 * Frames are stored as ImageBitmaps (GPU-resident) to keep memory usage
 * manageable even at high frame rates and resolutions.
 */
export function useReplayBuffer(
  stream: MediaStream | null | undefined,
  durationSec = 30,
): UseReplayBufferResult {
  const [frameCount, setFrameCount] = useState(0);
  const [isBuffering, setIsBuffering] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const framesRef = useRef<ImageBitmap[]>([]);
  const timestampsRef = useRef<number[]>([]);
  const rvfcHandleRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const stateTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stoppedRef = useRef(false);

  const clear = useCallback(() => {
    for (const bmp of framesRef.current) bmp.close();
    framesRef.current = [];
    timestampsRef.current = [];
    setFrameCount(0);
  }, []);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    if (rvfcHandleRef.current !== null && videoRef.current?.cancelVideoFrameCallback) {
      videoRef.current.cancelVideoFrameCallback(rvfcHandleRef.current);
      rvfcHandleRef.current = null;
    }
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (stateTimerRef.current !== null) {
      clearInterval(stateTimerRef.current);
      stateTimerRef.current = null;
    }
    // Final state sync
    setFrameCount(framesRef.current.length);
    setIsBuffering(false);
  }, []);

  const resume = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;

    // Clear old frames
    for (const bmp of framesRef.current) bmp.close();
    framesRef.current = [];
    timestampsRef.current = [];
    setFrameCount(0);

    stoppedRef.current = false;

    const durationMs = durationSec * 1000;

    const captureFrame = async () => {
      if (stoppedRef.current || !video || !canvas) return;
      if (video.videoWidth === 0 || video.videoHeight === 0) return;

      if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
      if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;

      const ctx = canvas.getContext("2d", { willReadFrequently: false });
      if (!ctx) return;

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      try {
        const bitmap = await createImageBitmap(canvas);
        const now = Date.now();

        framesRef.current.push(bitmap);
        timestampsRef.current.push(now);

        const cutoff = now - durationMs;
        while (timestampsRef.current.length > 0 && timestampsRef.current[0] < cutoff) {
          timestampsRef.current.shift();
          const old = framesRef.current.shift();
          old?.close();
        }
      } catch {
        // createImageBitmap can fail if canvas is zero-sized
      }
    };

    if (typeof video.requestVideoFrameCallback === "function") {
      const loop = () => {
        if (stoppedRef.current) return;
        captureFrame();
        rvfcHandleRef.current = video.requestVideoFrameCallback(loop);
      };
      rvfcHandleRef.current = video.requestVideoFrameCallback(loop);
    } else {
      intervalRef.current = window.setInterval(captureFrame, 1000 / 60);
    }

    stateTimerRef.current = setInterval(() => {
      setFrameCount(framesRef.current.length);
    }, STATE_UPDATE_INTERVAL_MS);

    setIsBuffering(true);
  }, [durationSec]);

  const getFrame = useCallback((index: number): ImageBitmap | null => {
    const f = framesRef.current;
    if (index < 0 || index >= f.length) return null;
    return f[index];
  }, []);

  useEffect(() => {
    if (!stream) {
      setIsBuffering(false);
      clear();
      return;
    }

    stoppedRef.current = false;

    const video = document.createElement("video");
    video.srcObject = stream;
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    videoRef.current = video;

    const canvas = document.createElement("canvas");
    canvasRef.current = canvas;

    const durationMs = durationSec * 1000;

    const captureFrame = async () => {
      if (stoppedRef.current || !video || !canvas) return;
      if (video.videoWidth === 0 || video.videoHeight === 0) return;

      if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
      if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;

      const ctx = canvas.getContext("2d", { willReadFrequently: false });
      if (!ctx) return;

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      try {
        const bitmap = await createImageBitmap(canvas);
        const now = Date.now();

        framesRef.current.push(bitmap);
        timestampsRef.current.push(now);

        // Evict frames older than durationSec
        const cutoff = now - durationMs;
        while (timestampsRef.current.length > 0 && timestampsRef.current[0] < cutoff) {
          timestampsRef.current.shift();
          const old = framesRef.current.shift();
          old?.close();
        }
      } catch {
        // createImageBitmap can fail if canvas is zero-sized
      }
    };

    const startRvfcLoop = () => {
      const loop = () => {
        if (stoppedRef.current) return;
        captureFrame();
        rvfcHandleRef.current = video.requestVideoFrameCallback(loop);
      };
      rvfcHandleRef.current = video.requestVideoFrameCallback(loop);
    };

    const startIntervalLoop = () => {
      intervalRef.current = window.setInterval(captureFrame, 1000 / 60);
    };

    video.play().then(() => {
      if (stoppedRef.current) return;
      setIsBuffering(true);

      if (typeof video.requestVideoFrameCallback === "function") {
        startRvfcLoop();
      } else {
        startIntervalLoop();
      }

      // Throttled React state updates
      stateTimerRef.current = setInterval(() => {
        setFrameCount(framesRef.current.length);
      }, STATE_UPDATE_INTERVAL_MS);
    }).catch(() => {
      setIsBuffering(false);
    });

    return () => {
      stoppedRef.current = true;
      if (rvfcHandleRef.current !== null && video.cancelVideoFrameCallback) {
        video.cancelVideoFrameCallback(rvfcHandleRef.current);
        rvfcHandleRef.current = null;
      }
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (stateTimerRef.current !== null) {
        clearInterval(stateTimerRef.current);
        stateTimerRef.current = null;
      }
      setIsBuffering(false);
      video.pause();
      video.srcObject = null;
      videoRef.current = null;
      canvasRef.current = null;
    };
  }, [stream, durationSec, clear]);

  const bufferedSeconds = (() => {
    const ts = timestampsRef.current;
    if (ts.length < 2) return 0;
    return (ts[ts.length - 1] - ts[0]) / 1000;
  })();

  return {
    frameCount,
    getFrame,
    isBuffering,
    bufferedSeconds,
    clear,
    stop,
    resume,
  };
}
