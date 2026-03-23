/**
 * DetectorPreview.tsx — Capture source display with state-based UI flow.
 *
 * Three clear states:
 *   1. NOT CONNECTED — no source configured, shows "Connect source" button
 *   2. CONNECTED + PREVIEW ACTIVE — live stream with auto-stop timer
 *   3. CONNECTED + PREVIEW PAUSED — dark overlay, resume button
 */
import { useRef, useEffect, useState, useCallback } from "react";
import { Camera, MonitorPlay, Unplug } from "lucide-react";
import { DetectorCapabilities, DetectorConfig, Pokemon } from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { useRawPreview } from "../../hooks/useRawPreview";
import { useVideoStream } from "../../hooks/useVideoStream";
import { useMJPEGStream } from "../../hooks/useMJPEGStream";
import { apiUrl } from "../../utils/api";

// --- Constants ---------------------------------------------------------------

/** Seconds before the preview auto-pauses to save resources. */
const PREVIEW_TIMEOUT_SEC = 30;

// --- Props -------------------------------------------------------------------

export type DetectorPreviewProps = Readonly<{
  pokemon: Pokemon;
  cfg: DetectorConfig;
  capabilities: DetectorCapabilities | null;
  onStartCapture: () => void;
  onDisconnect: () => void;
  isRunning?: boolean;
  confidence?: number;
  /** Bumped by the parent to force-restart the preview stream (e.g. after the template editor closes). */
  previewVersion?: number;
}>;

// --- Helpers -----------------------------------------------------------------

/** Return the Tailwind class for the confidence badge based on threshold. */
function confidenceBadgeClass(confidence: number, precision: number): string {
  if (confidence >= precision) return "bg-green-500/80 text-white";
  if (confidence >= 0.5) return "bg-amber-500/80 text-white";
  return "bg-black/60 text-white/70";
}

/** Derive a human-readable source label from the config source type. */
function useSourceLabel(
  sourceType: string,
  t: (key: string) => string,
): string {
  if (sourceType === "screen_region") return t("detector.sourceScreen");
  if (sourceType === "camera") return t("detector.sourceNativeCamera");
  return t("detector.sourceWindow");
}

// --- Component ---------------------------------------------------------------

/** Preview panel showing capture source status and detection confidence. */
export function DetectorPreview({
  pokemon,
  cfg,
  capabilities: _capabilities,
  onStartCapture,
  onDisconnect,
  isRunning,
  confidence,
  previewVersion,
}: DetectorPreviewProps) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewActiveRef = useRef(false);
  const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasSource = Boolean(cfg.window_title);
  const sourceLabel = useSourceLabel(cfg.source_type, t);

  // --- Preview state ---------------------------------------------------------

  const [previewActive, setPreviewActive] = useState(false);
  const [previewTimer, setPreviewTimer] = useState(PREVIEW_TIMEOUT_SEC);
  const [permanentPreview, setPermanentPreview] = useState(false);

  // On Linux/Wayland, starting a preview-only session opens the PipeWire
  // ScreenCast portal dialog. To avoid it appearing unexpectedly on tab
  // navigation, the user must click "Start Preview" first. On Windows (DXGI)
  // and when detection is already running (capture already active) the preview
  // starts automatically.
  const isWindows = globalThis.electronAPI?.platform === "win32";
  const [previewRequested, setPreviewRequested] = useState(false);

  // Effective preview: active + (running OR user-requested OR Windows auto)
  const previewEnabled =
    hasSource && previewActive && (isRunning || previewRequested || isWindows);

  // --- Stream URLs -----------------------------------------------------------

  const rawUrl = previewEnabled
    ? apiUrl(`/api/detector/${pokemon.id}/raw_stream`)
    : null;
  const streamUrl = previewEnabled
    ? apiUrl(`/api/detector/${pokemon.id}/stream`)
    : null;
  const mjpegUrl = previewEnabled
    ? apiUrl(`/api/detector/${pokemon.id}/mjpeg`)
    : null;
  const { fps: rawFps, active: rawActive } = useRawPreview(rawUrl, canvasRef);
  const { fps: videoFps, active: videoActive } = useVideoStream(
    rawActive ? null : streamUrl,
    videoRef,
  );
  const { fps: mjpegFps } = useMJPEGStream(
    rawActive || videoActive ? null : mjpegUrl,
    canvasRef,
  );
  const displayFps = rawActive ? rawFps : videoActive ? videoFps : mjpegFps;

  // --- Auto-start preview when source first connects -------------------------

  const prevWindowTitle = useRef(cfg.window_title);
  useEffect(() => {
    const wasEmpty = !prevWindowTitle.current;
    const isNowSet = Boolean(cfg.window_title);
    prevWindowTitle.current = cfg.window_title;

    if (wasEmpty && isNowSet) {
      setPreviewActive(true);
      setPreviewRequested(true);
      setPreviewTimer(PREVIEW_TIMEOUT_SEC);
    }
    if (!isNowSet) {
      setPreviewActive(false);
      setPreviewRequested(false);
    }
  }, [cfg.window_title]);

  // --- Preview countdown timer -----------------------------------------------

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (!previewActive || permanentPreview) return;

    timerRef.current = setInterval(() => {
      setPreviewTimer((prev) => {
        if (prev <= 1) {
          setPreviewActive(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [previewActive, permanentPreview]);

  // --- Sidecar session lifecycle -----------------------------------------------
  // The sidecar session (capture + replay buffer) starts once when a source
  // connects and stays alive until the user disconnects. The preview stream
  // (MJPEG/video) is started/stopped independently: it pauses when the 30s
  // timer expires but the capture and replay buffer keep running.

  const sessionActiveRef = useRef(false);

  // Start sidecar session when source first connects.
  useEffect(() => {
    if (!hasSource) {
      // Source removed — stop the entire sidecar session.
      if (sessionActiveRef.current && !isRunning) {
        fetch(apiUrl(`/api/detector/${pokemon.id}/preview_session/stop`), {
          method: "POST",
        }).catch(() => {});
        sessionActiveRef.current = false;
      }
      return;
    }

    // Source present — ensure sidecar session is running.
    if (!sessionActiveRef.current && !isRunning) {
      fetch(apiUrl(`/api/detector/${pokemon.id}/preview_session/start`), {
        method: "POST",
      }).catch(() => {});
      sessionActiveRef.current = true;
    }
  }, [hasSource, isRunning, pokemon.id]);

  // Start/stop the preview video stream (lightweight — does NOT kill the session).
  useEffect(() => {
    if (!previewEnabled) {
      // Stop the preview stream, but keep the sidecar session alive.
      if (previewActiveRef.current) {
        fetch(apiUrl(`/api/detector/${pokemon.id}/preview/stop`), {
          method: "POST",
        }).catch(() => {});
        previewActiveRef.current = false;
      }
      return;
    }

    // Cancel any pending stop from a previous cleanup (StrictMode remount)
    if (cleanupTimerRef.current) {
      clearTimeout(cleanupTimerRef.current);
      cleanupTimerRef.current = null;
    }

    fetch(apiUrl(`/api/detector/${pokemon.id}/preview/start`), {
      method: "POST",
    }).catch(() => {});
    previewActiveRef.current = true;

    return () => {
      cleanupTimerRef.current = setTimeout(() => {
        if (previewActiveRef.current) {
          fetch(apiUrl(`/api/detector/${pokemon.id}/preview/stop`), {
            method: "POST",
          }).catch(() => {});
          previewActiveRef.current = false;
        }
      }, 300);
    };
  }, [previewEnabled, pokemon.id, previewVersion]);

  // --- Handlers --------------------------------------------------------------

  const handleResumePreview = useCallback(() => {
    setPreviewActive(true);
    setPreviewRequested(true);
    setPreviewTimer(PREVIEW_TIMEOUT_SEC);
  }, []);

  const handleTogglePermanent = useCallback(() => {
    setPermanentPreview((prev) => !prev);
  }, []);

  const handleDisconnect = useCallback(() => {
    setPreviewActive(false);
    setPermanentPreview(false);
    setPreviewTimer(PREVIEW_TIMEOUT_SEC);
    onDisconnect();
  }, [onDisconnect]);

  // --- Render ----------------------------------------------------------------

  return (
    <div className="space-y-5">
      <div className="bg-bg-card border border-border-subtle rounded-xl overflow-hidden shadow-sm">
        {/* --- State 1: NOT CONNECTED --- */}
        {!hasSource && (
          <div
            data-detector-tutorial="source"
            className="relative w-full aspect-video bg-black flex flex-col items-center justify-center"
          >
            <MonitorPlay className="w-12 h-12 2xl:w-14 2xl:h-14 text-white/15 mb-3" />
            <button
              onClick={onStartCapture}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent-blue text-white font-semibold text-sm hover:bg-accent-blue/90 transition-colors shadow-lg shadow-accent-blue/20"
            >
              <Camera className="w-4 h-4" />
              {t("detector.connectSource")}
            </button>
          </div>
        )}

        {/* --- State 2 & 3: CONNECTED --- */}
        {hasSource && (
          <>
            {/* Header: source label + disconnect */}
            <div
              data-detector-tutorial="source"
              className="flex items-center justify-between px-4 py-2.5 border-b border-border-subtle"
            >
              <span className="text-xs text-text-muted font-medium truncate max-w-60">
                {sourceLabel}
                <span className="text-emerald-400 ml-1.5" title={cfg.window_title}>
                  — {cfg.window_title}
                </span>
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={onStartCapture}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-bg-primary border border-border-subtle text-text-muted hover:text-text-primary hover:border-accent-blue/30 transition-colors"
                >
                  {t("sourcePicker.change")}
                </button>
                <button
                  onClick={handleDisconnect}
                  title={t("detector.tooltipDisconnect")}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-bg-primary border border-red-500/30 text-red-400 hover:bg-red-500/10 hover:border-red-500/50 transition-colors"
                >
                  <Unplug className="w-3 h-3" />
                  {t("detector.disconnect")}
                </button>
              </div>
            </div>

            {/* Preview area */}
            <div
              data-detector-tutorial="preview"
              className="relative w-full aspect-video bg-black"
            >
              {/* State 2: PREVIEW ACTIVE — live stream */}
              {previewEnabled && (
                <>
                  <video
                    ref={videoRef}
                    className={`w-full h-full object-contain ${!rawActive && videoActive ? "" : "hidden"}`}
                    autoPlay
                    muted
                    playsInline
                  />
                  <canvas
                    ref={canvasRef}
                    className={`w-full h-full ${!rawActive && videoActive ? "hidden" : ""}`}
                  />

                  {/* Timer countdown overlay (bottom center) */}
                  {!permanentPreview && (
                    <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-black/60 text-[10px] font-mono text-white/60 backdrop-blur-sm">
                      {t("detector.previewTimer").replace("{0}", String(previewTimer))}
                    </div>
                  )}
                </>
              )}

              {/* State 3: PREVIEW PAUSED — dark overlay with resume */}
              {!previewEnabled && hasSource && (
                <div className="w-full h-full flex flex-col items-center justify-center gap-3">
                  <button
                    onClick={handleResumePreview}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-blue/20 border border-accent-blue/30 text-accent-blue hover:bg-accent-blue/30 transition-colors"
                  >
                    <MonitorPlay className="w-4 h-4" />
                    <span className="text-sm font-medium">
                      {t("detector.resumePreview")}
                    </span>
                  </button>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={permanentPreview}
                      onChange={handleTogglePermanent}
                      className="w-3 h-3 rounded accent-accent-blue"
                    />
                    <span className="text-[11px] text-white/40">
                      {t("detector.permanentPreview")}
                    </span>
                  </label>
                </div>
              )}

              {/* Confidence overlay badge */}
              {isRunning && confidence != null && hasSource && (
                <div
                  className={`absolute top-2 right-2 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold backdrop-blur-sm ${confidenceBadgeClass(confidence, cfg.precision || 0.8)}`}
                >
                  {(confidence * 100).toFixed(1)}%
                </div>
              )}

              {/* FPS counter overlay */}
              {previewEnabled && (
                <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-black/60 text-[10px] font-mono text-white/50">
                  {displayFps} fps
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* --- Detection log ---------------------------------------------------- */}
      {(pokemon.detector_config?.detection_log?.length ?? 0) > 0 && (
        <div className="bg-bg-card border border-border-subtle rounded-xl shadow-sm p-4">
          <span className="block text-xs text-text-muted font-semibold uppercase tracking-wider mb-2">
            {t("detector.logTitle")}
          </span>
          <div className="space-y-0.5 max-h-32 overflow-y-auto">
            {[...(pokemon.detector_config?.detection_log ?? [])]
              .reverse()
              .slice(0, 10)
              .map((entry, i) => (
                <div
                  key={`log-${entry.at}-${i}`}
                  className="flex items-center justify-between text-[11px]"
                >
                  <span className="text-text-muted font-mono">
                    {new Date(entry.at).toLocaleTimeString()}
                  </span>
                  <span className="text-green-400 font-mono">
                    {(entry.confidence * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
