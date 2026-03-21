/**
 * DetectorPreview.tsx — Capture source display and detection status.
 *
 * Shows a live MJPEG preview via WebSocket binary frames whenever a capture
 * source is configured (regardless of whether detection is running), and the
 * detection log entries.
 */
import { useRef, useEffect } from "react";
import { Camera, Video, Zap } from "lucide-react";
import { DetectorCapabilities, DetectorConfig, Pokemon } from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { usePreviewStream } from "../../hooks/usePreviewStream";
import { apiUrl } from "../../utils/api";

// --- Props -------------------------------------------------------------------

export type DetectorPreviewProps = Readonly<{
  pokemon: Pokemon;
  cfg: DetectorConfig;
  capabilities: DetectorCapabilities | null;
  onSourceTypeChange: (sourceType: string) => void;
  onStartCapture: () => void;
  isRunning?: boolean;
  confidence?: number;
}>;

// --- Helpers -----------------------------------------------------------------

/** Return the Tailwind class for the confidence badge based on threshold. */
function confidenceBadgeClass(confidence: number, precision: number): string {
  if (confidence >= precision) return 'bg-green-500/80 text-white';
  if (confidence >= 0.5) return 'bg-amber-500/80 text-white';
  return 'bg-black/60 text-white/70';
}

/** Render the appropriate preview content based on capture state. */
function renderPreviewContent(
  windowTitle: string | undefined,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  t: (key: string) => string,
): React.ReactNode {
  if (windowTitle) {
    return (
      <canvas
        ref={canvasRef}
        className="w-full h-full object-contain"
      />
    );
  }
  return (
    <div className="w-full h-full flex flex-col items-center justify-center">
      <Camera className="w-10 h-10 2xl:w-12 2xl:h-12 text-white/20 mb-2" />
      <p className="text-xs text-white/30">{t("detector.noStream")}</p>
    </div>
  );
}

// --- Component ---------------------------------------------------------------

/** Preview panel showing capture source status and detection confidence. */
export function DetectorPreview({
  pokemon,
  cfg,
  capabilities,
  onSourceTypeChange,
  onStartCapture,
  isRunning,
  confidence,
}: DetectorPreviewProps) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewActiveRef = useRef(false);
  const hasSource = Boolean(cfg.window_title);
  const { fps } = usePreviewStream(hasSource ? pokemon.id : null, canvasRef);

  // Start/stop preview stream when source is configured (independent of detection)
  useEffect(() => {
    if (!cfg.window_title) return;

    if (isRunning) {
      // Detection is active — sidecar session already exists, just start preview
      fetch(apiUrl(`/api/detector/${pokemon.id}/preview/start`), { method: "POST" }).catch(() => {});
    } else {
      // No detection — start a preview-only sidecar session
      fetch(apiUrl(`/api/detector/${pokemon.id}/preview_session/start`), { method: "POST" }).catch(() => {});
    }
    previewActiveRef.current = true;

    return () => {
      if (previewActiveRef.current) {
        if (isRunning) {
          fetch(apiUrl(`/api/detector/${pokemon.id}/preview/stop`), { method: "POST" }).catch(() => {});
        } else {
          fetch(apiUrl(`/api/detector/${pokemon.id}/preview_session/stop`), { method: "POST" }).catch(() => {});
        }
        previewActiveRef.current = false;
      }
    };
  }, [isRunning, cfg.window_title, pokemon.id]);

  return (
    <div className="space-y-5">
      {/* --- Source + Preview ------------------------------------------------- */}
      <div className="bg-bg-card border border-border-subtle rounded-xl overflow-hidden shadow-sm">
        <div
          data-detector-tutorial="source"
          className="flex items-center justify-between px-4 py-2.5 border-b border-border-subtle"
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
              <option value="screen_region" disabled={capabilities?.supports_screen_capture === false && !capabilities?.sidecar_available}>
                {t("detector.sourceScreen")}{capabilities?.supports_screen_capture === false && !capabilities?.sidecar_available ? ` — ${t("detector.sourceUnavailable")}` : ""}
              </option>
              <option value="window" disabled={capabilities?.supports_window_capture === false && !capabilities?.sidecar_available}>
                {t("detector.sourceWindow")}{capabilities?.supports_window_capture === false && !capabilities?.sidecar_available ? ` — ${t("detector.sourceUnavailable")}` : ""}
              </option>
              <option value="camera" disabled={capabilities?.supports_camera === false && !capabilities?.sidecar_available}>
                {t("detector.sourceNativeCamera")}{capabilities?.supports_camera === false && !capabilities?.sidecar_available ? ` — ${t("detector.sourceUnavailable")}` : ""}
              </option>
            </select>
            {cfg.window_title ? (
              <>
                <span className="text-[11px] text-emerald-400 truncate max-w-35" title={cfg.window_title}>
                  <Zap className="w-3 h-3 inline -mt-0.5 mr-0.5" />
                  {cfg.window_title}
                </span>
                <button
                  onClick={onStartCapture}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-bg-primary border border-border-subtle text-text-muted hover:text-text-primary hover:border-accent-blue/30 transition-colors"
                >
                  {t("sourcePicker.change")}
                </button>
              </>
            ) : (
              <button
                onClick={onStartCapture}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-accent-blue text-white hover:bg-accent-blue/90 transition-colors"
              >
                <Video className="w-3.5 h-3.5" />
                {t("detector.selectSource")}
              </button>
            )}
          </div>
        </div>
        <div
          data-detector-tutorial="preview"
          className="relative w-full aspect-video bg-black"
        >
          {renderPreviewContent(cfg.window_title, canvasRef, t)}
          {/* Confidence overlay badge */}
          {isRunning && confidence != null && cfg.window_title && (
            <div className={`absolute top-2 right-2 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold backdrop-blur-sm ${
              confidenceBadgeClass(confidence, cfg.precision || 0.8)
            }`}>
              {(confidence * 100).toFixed(1)}%
            </div>
          )}
          {/* FPS counter overlay */}
          {hasSource && (
            <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-black/60 text-[10px] font-mono text-white/50">
              {fps.current} fps
            </div>
          )}
        </div>
      </div>

      {/* --- Detection log ---------------------------------------------------- */}
      {(pokemon.detector_config?.detection_log?.length ?? 0) > 0 && (
        <div className="bg-bg-card border border-border-subtle rounded-xl shadow-sm p-4">
          <span className="block text-xs text-text-muted font-semibold uppercase tracking-wider mb-2">
            {t("detector.logTitle")}
          </span>
          <div className="space-y-0.5 max-h-32 overflow-y-auto">
            {[...(pokemon.detector_config?.detection_log ?? [])].reverse().slice(0, 10).map((entry, i) => (
              <div key={`log-${entry.at}-${i}`} className="flex items-center justify-between text-[11px]">
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
