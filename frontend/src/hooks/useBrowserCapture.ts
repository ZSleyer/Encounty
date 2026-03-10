import { useState, useEffect, useRef, useCallback } from "react";

interface BrowserCaptureResult {
  stream: MediaStream | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isCapturing: boolean;
  error: string | null;
  startCapture: () => Promise<void>;
  stopCapture: () => void;
  captureFrame: () => Promise<Blob | null>;
}

export function useBrowserCapture(
  sourceType: "browser_camera" | "browser_display" | "screen_region" | "window",
): BrowserCaptureResult {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const stopCapture = useCallback(() => {
    if (videoRef.current && videoRef.current.srcObject) {
      const currentStream = videoRef.current.srcObject as MediaStream;
      currentStream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    setStream(null);
    setIsCapturing(false);
    setError(null);
  }, []);

  const startCapture = useCallback(async () => {
    stopCapture();
    setError(null);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const errMsg = "mediaDevices API not available. Ensure context is secure (HTTPS/localhost).";
      console.error(errMsg);
      setError(errMsg);
      return;
    }

    try {
      let mediaStream: MediaStream;
      if (sourceType === "browser_display") {
        mediaStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            displaySurface: "window",
          },
          audio: false,
        });
      } else if (sourceType === "browser_camera") {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      } else {
        return; // Not a browser source
      }

      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
      setIsCapturing(true);

      // Handle stream end (e.g., user clicks "Stop sharing" in browser UI)
      mediaStream.getVideoTracks()[0].onended = () => {
        setIsCapturing(false);
        setStream(null);
      };
    } catch (err: any) {
      console.error("Browser capture error:", err);
      setError(err.message || err.name || "Failed to start capture");
      setIsCapturing(false);
    }
  }, [sourceType, stopCapture]);

  // Reuse a single offscreen canvas to avoid allocation overhead per frame.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const captureFrame = useCallback(async (): Promise<Blob | null> => {
    if (!videoRef.current || !stream) return null;
    const video = videoRef.current;

    // Ensure video is playing and has valid dimensions
    if (video.videoWidth === 0 || video.videoHeight === 0) return null;

    if (!canvasRef.current) canvasRef.current = document.createElement("canvas");
    const canvas = canvasRef.current;
    if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
    if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.7);
    });
  }, [stream]);

  // Cleanup on unmount or source change
  useEffect(() => {
    return stopCapture;
  }, [stopCapture]);

  return {
    stream,
    videoRef,
    isCapturing,
    error,
    startCapture,
    stopCapture,
    captureFrame,
  };
}
