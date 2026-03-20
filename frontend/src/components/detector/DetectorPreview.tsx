/**
 * DetectorPreview.tsx — Live preview and detection status display.
 *
 * Shows the current capture/video frame preview, detection status indicators
 * (confidence bar, match status), and the detection log entries.
 */
import { useEffect, useRef } from "react";
import { Camera, Video, VideoOff, Zap } from "lucide-react";
import { DetectorCapabilities, DetectorConfig, Pokemon } from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { useCaptureService } from "../../contexts/CaptureServiceContext";

// ── Props ────────────────────────────────────────────────────────────────────

export type DetectorPreviewProps = Readonly<{
  pokemon: Pokemon;
  cfg: DetectorConfig;
  capabilities: DetectorCapabilities | null;
  onSourceTypeChange: (sourceType: string) => void;
  onStartCapture: () => void;
  onStopCapture: () => void;
  isRunning?: boolean;
  confidence?: number;
}>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function confidenceBadgeClass(confidence: number, precision: number): string {
  if (confidence >= precision) return 'bg-green-500/80 text-white';
  if (confidence >= 0.5) return 'bg-amber-500/80 text-white';
  return 'bg-black/60 text-white/70';
}

// ── Component ────────────────────────────────────────────────────────────────

export function DetectorPreview({
  pokemon,
  cfg,
  capabilities,
  onSourceTypeChange,
  onStartCapture,
  onStopCapture,
  isRunning,
  confidence,
}: DetectorPreviewProps) {
  const { t } = useI18n();
  const capture = useCaptureService();

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
    <div className="space-y-5">
      {/* ── Source + Preview ───────────────────────────────────────────────── */}
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
              <option value="window" disabled={capabilities?.supports_window_capture === false}>
                {t("detector.sourceWindow")} (fast){capabilities?.supports_window_capture === false ? ` — ${t("detector.sourceUnavailable")}` : ""}
              </option>
              <option value="camera" disabled={capabilities?.supports_camera === false}>
                {t("detector.sourceNativeCamera")} (fast){capabilities?.supports_camera === false ? ` — ${t("detector.sourceUnavailable")}` : ""}
              </option>
              <option value="browser_camera">{t("detector.sourceCamera")} (slow)</option>
              <option value="browser_display">{t("detector.sourceBrowser")} (slow)</option>
            </select>
            {(() => {
              const isNative = cfg.source_type === "window" || cfg.source_type === "camera";

              // Native sources: no browser stream, show source label and select button
              if (isNative) {
                return cfg.window_title ? (
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
                );
              }

              // Browser sources: show stream state and connect/disconnect
              return stream ? (
                <>
                  {capture.getSourceLabel(pokemon.id) && (
                    <span className="text-[11px] text-text-muted truncate max-w-35" title={capture.getSourceLabel(pokemon.id) ?? ""}>
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
              );
            })()}
          </div>
        </div>
        <div
          data-detector-tutorial="preview"
          className="relative w-full aspect-video bg-black"
        >
          {(() => {
            const isNative = cfg.source_type === "window" || cfg.source_type === "camera";
            if (stream) {
              return (
                <video
                  ref={videoRef}
                  autoPlay playsInline muted
                  className="w-full h-full object-contain"
                />
              );
            }
            if (isNative && cfg.window_title) {
              return (
                <div className="w-full h-full flex flex-col items-center justify-center">
                  <Zap className="w-10 h-10 2xl:w-12 2xl:h-12 text-emerald-400/30 mb-2" />
                  <p className="text-xs text-emerald-400/50">{t("detector.nativeCapture")}</p>
                  <p className="text-[10px] text-white/30 mt-1">{t("detector.nativeCaptureHint")}</p>
                </div>
              );
            }
            return (
              <div className="w-full h-full flex flex-col items-center justify-center">
                <Camera className="w-10 h-10 2xl:w-12 2xl:h-12 text-white/20 mb-2" />
                <p className="text-xs text-white/30">{t("detector.noStream")}</p>
              </div>
            );
          })()}
          {/* Confidence overlay badge */}
          {isRunning && confidence != null && (stream || (cfg.source_type === "window" || cfg.source_type === "camera")) && (
            <div className={`absolute top-2 right-2 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold backdrop-blur-sm ${
              confidenceBadgeClass(confidence, cfg.precision || 0.8)
            }`}>
              {(confidence * 100).toFixed(1)}%
            </div>
          )}
        </div>
      </div>

      {/* ── Detection log ───────────────────────────────────────────────────── */}
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
