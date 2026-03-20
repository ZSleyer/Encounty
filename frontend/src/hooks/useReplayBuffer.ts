import { useEffect, useRef, useState, useCallback } from "react";

export type UseReplayBufferResult = {
  frames: ImageData[];
  frameCount: number;
  getFrame: (index: number) => ImageData | null;
  isBuffering: boolean;
  /** Seconds of footage currently buffered. */
  bufferedSeconds: number;
  clear: () => void;
  /** Stop capturing new frames (freezes the buffer). */
  stop: () => void;
};

export function useReplayBuffer(
  stream: MediaStream | null | undefined,
  durationSec = 30,
  fps = 5
): UseReplayBufferResult {
  const [frames, setFrames] = useState<ImageData[]>([]);
  const [isBuffering, setIsBuffering] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const intervalRef = useRef<number | null>(null);
  const framesRef = useRef<ImageData[]>([]);

  const maxFrames = durationSec * fps;

  const clear = useCallback(() => {
    framesRef.current = [];
    setFrames([]);
  }, []);

  const stop = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsBuffering(false);
  }, []);

  const getFrame = useCallback((index: number): ImageData | null => {
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

    const video = document.createElement("video");
    video.srcObject = stream;
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    videoRef.current = video;

    const canvas = document.createElement("canvas");
    canvasRef.current = canvas;

    const captureFrame = () => {
      if (!video || !canvas || video.videoWidth === 0 || video.videoHeight === 0) {
        return;
      }

      if (canvas.width !== video.videoWidth) {
        canvas.width = video.videoWidth;
      }
      if (canvas.height !== video.videoHeight) {
        canvas.height = video.videoHeight;
      }

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      const updated = [...framesRef.current, imageData];
      if (updated.length > maxFrames) {
        updated.shift();
      }
      framesRef.current = updated;
      setFrames(updated);
    };

    video.play().then(() => {
      setIsBuffering(true);
      const interval = window.setInterval(captureFrame, 1000 / fps);
      intervalRef.current = interval;
    }).catch(() => {
      setIsBuffering(false);
    });

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setIsBuffering(false);
      video.pause();
      video.srcObject = null;
      videoRef.current = null;
      canvasRef.current = null;
    };
  }, [stream, fps, maxFrames, clear]);

  const bufferedSeconds = frames.length / fps;

  return {
    frames,
    frameCount: frames.length,
    getFrame,
    isBuffering,
    bufferedSeconds,
    clear,
    stop,
  };
}
