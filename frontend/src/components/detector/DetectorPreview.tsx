/**
 * DetectorPreview.tsx — Live preview and detection status display.
 *
 * Shows the current capture/video frame preview, detection status indicators
 * (confidence bar, match status), and the detection log entries.
 */
import { useEffect, useRef } from "react";
import { Camera, Video, VideoOff } from "lucide-react";
import { DetectorConfig, Pokemon } from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { useCaptureService } from "../../contexts/CaptureServiceContext";

// ── Props ────────────────────────────────────────────────────────────────────

export type DetectorPreviewProps = Readonly<{
  pokemon: Pokemon;
  cfg: DetectorConfig;
  onSourceTypeChange: (sourceType: string) => void;
  onStartCapture: () => void;
  onStopCapture: () => void;
}>;

// ── Component ────────────────────────────────────────────────────────────────

export function DetectorPreview({
  pokemon,
  cfg,
  onSourceTypeChange,
  onStartCapture,
  onStopCapture,
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
              <option value="browser_camera">{t("detector.sourceCamera")}</option>
              <option value="browser_display">{t("detector.sourceBrowser")}</option>
            </select>
            {!stream ? (
              <button
                onClick={onStartCapture}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-accent-blue text-white hover:bg-accent-blue/90 transition-colors"
              >
                <Video className="w-3.5 h-3.5" />
                {t("detector.connect")}
              </button>
            ) : (
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
            )}
          </div>
        </div>
        <div
          data-detector-tutorial="preview"
          className="relative w-full aspect-video bg-black"
        >
          {!stream ? (
            <div className="w-full h-full flex flex-col items-center justify-center">
              <Camera className="w-10 h-10 2xl:w-12 2xl:h-12 text-white/20 mb-2" />
              <p className="text-xs text-white/30">{t("detector.noStream")}</p>
            </div>
          ) : (
            <video
              ref={videoRef}
              autoPlay playsInline muted
              className="w-full h-full object-contain"
            />
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
