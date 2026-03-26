/**
 * DetectorPreview.tsx — Live preview and detection status display.
 *
 * Shows the current capture/video frame preview with detection status
 * indicators (confidence badge, match status).
 * Uses the CaptureService for browser-native MediaStream rendering.
 */
import { useEffect, useRef } from "react";
import { Camera, Video, VideoOff } from "lucide-react";
import { DetectorConfig, Pokemon } from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { useCaptureService, useCaptureVersion } from "../../contexts/CaptureServiceContext";

// --- Props -------------------------------------------------------------------

export type DetectorPreviewProps = Readonly<{
  pokemon: Pokemon;
  cfg: DetectorConfig;
  onSourceTypeChange: (sourceType: string) => void;
  onStartCapture: () => void;
  onStopCapture: () => void;
  isRunning?: boolean;
  confidence?: number;
}>;

// --- Helpers -----------------------------------------------------------------

/** Return the Tailwind class for the confidence badge based on threshold. */
function confidenceBadgeClass(confidence: number, precision: number): string {
  if (confidence >= precision) return "bg-green-500/80 text-white";
  if (confidence >= 0.5) return "bg-amber-500/80 text-white";
  return "bg-black/60 text-white/70";
}

// --- Component ---------------------------------------------------------------

/** Preview panel showing CaptureService stream and detection confidence. */
export function DetectorPreview({
  pokemon,
  cfg,
  onSourceTypeChange,
  onStartCapture,
  onStopCapture,
  isRunning,
  confidence,
}: DetectorPreviewProps) {
  const { t } = useI18n();
  const capture = useCaptureService();

  // Re-render when capture streams change
  useCaptureVersion();

  const stream = capture.getStream(pokemon.id);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Wire shared stream to the local preview video element
  useEffect(() => {
    if (stream && videoRef.current && videoRef.current.srcObject !== stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    } else if (!stream && videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, [stream]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 bg-bg-card border border-border-subtle rounded-xl overflow-hidden flex flex-col">
        {/* Source header */}
        <div
          data-detector-tutorial="source"
          className="flex items-center justify-between px-3 py-2 border-b border-border-subtle shrink-0"
        >
          <span className="text-xs text-text-muted font-semibold uppercase tracking-wider">
            {t("detector.source")}
          </span>
          <div className="flex items-center gap-2">
            <select
              value={cfg.source_type}
              onChange={(e) => onSourceTypeChange(e.target.value)}
              className="bg-bg-primary border border-border-subtle rounded-lg px-2 py-1 text-xs text-text-primary outline-none focus:border-accent-blue/50"
            >
              <option value="browser_camera">{t("detector.sourceCamera")}</option>
              <option value="browser_display">{t("detector.sourceBrowser")}</option>
              {import.meta.env.DEV && (
                <option value="dev_video">Video File (Dev)</option>
              )}
            </select>
            {stream ? (
              <>
                {capture.getSourceLabel(pokemon.id) && (
                  <span
                    className="text-[11px] text-text-muted truncate max-w-35"
                    title={capture.getSourceLabel(pokemon.id) ?? ""}
                  >
                    {capture.getSourceLabel(pokemon.id)}
                  </span>
                )}
                <button
                  onClick={onStopCapture}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-bg-primary border border-border-subtle text-text-muted hover:text-red-400 hover:border-red-400/30 transition-colors"
                >
                  <VideoOff className="w-3.5 h-3.5" />
                  {t("detector.disconnect")}
                </button>
              </>
            ) : (
              <button
                onClick={onStartCapture}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-accent-blue text-white hover:bg-accent-blue/90 transition-colors"
              >
                <Video className="w-3.5 h-3.5" />
                {t("detector.connect")}
              </button>
            )}
          </div>
        </div>
        {/* Video — fills remaining space */}
        <div
          data-detector-tutorial="preview"
          className="flex-1 min-h-0 relative bg-black"
        >
          {stream ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-contain"
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-text-faint gap-2">
              <Camera className="w-10 h-10 opacity-30" />
              <span className="text-xs">{t("detector.noStream")}</span>
            </div>
          )}
          {/* Confidence overlay badge */}
          {isRunning && confidence != null && confidence > 0.01 && stream && (
            <div
              className={`absolute top-2 right-2 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold backdrop-blur-sm ${confidenceBadgeClass(confidence, cfg.precision || 0.8)}`}
            >
              {(confidence * 100).toFixed(1)}%
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
