/**
 * DetectorPreview.tsx — Live preview and detection status display.
 *
 * Shows the current capture/video frame preview with detection status
 * indicators (confidence badge, match status).
 * Uses the CaptureService for browser-native MediaStream rendering.
 */
import { useEffect, useRef } from "react";
import { Camera } from "lucide-react";
import { DetectorConfig, Pokemon } from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { useCaptureService, useCaptureVersion } from "../../contexts/CaptureServiceContext";

// --- Props -------------------------------------------------------------------

export type DetectorPreviewProps = Readonly<{
  pokemon: Pokemon;
  cfg: DetectorConfig;
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
    <div
      data-detector-tutorial="preview"
      className="w-full h-full relative bg-black"
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
  );
}
