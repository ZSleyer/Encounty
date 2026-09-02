/**
 * SidebarHuntStatus.tsx: Per-row hunt status and play/pause in the sidebar.
 */

import { Eye, Play, Sparkles, Square, VideoOff } from "lucide-react";
import { Pokemon } from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { useToast } from "../../contexts/ToastContext";
import { useSecondTick } from "../../hooks/useSecondTick";
import { computeTimerMs, formatTimer } from "../../utils/timer";
import { stopDetectionForPokemon } from "../../engine/startDetection";
import {
  canStartDetector,
  hasDetectorReady,
  keyDetectorStart,
  tryStartDetection,
} from "./huntMode";
import type { HuntMode } from "./types";

/** Tone classes of the play/stop toggle; the disabled state outranks the running one. */
function resolveToggleTone(canToggle: boolean, anyRunning: boolean): string {
  if (!canToggle) return "text-text-faint opacity-50 cursor-not-allowed";
  if (anyRunning) return "text-accent-green hover:text-accent-yellow";
  return "text-text-faint hover:text-accent-green";
}

/** SidebarHuntStatus shows compact hunt status, timer, and play/pause per sidebar card. */
export function SidebarHuntStatus({
  pokemon,
  send,
  detectorRunning,
  disabled = false,
  timerStartBlocked = false,
  capture,
  detectorStatus,
  setDetectorStatus,
  clearDetectorStatus,
}: Readonly<{
  pokemon: Pokemon;
  send: (type: string, payload: unknown) => void;
  detectorRunning: boolean;
  disabled?: boolean;
  timerStartBlocked?: boolean;
  capture: {
    isCapturing: (id: string) => boolean;
    getVideoElement: (id: string) => HTMLVideoElement | null;
  };
  detectorStatus: Record<string, unknown>;
  setDetectorStatus: (
    id: string,
    status: { state: string; confidence: number; poll_ms: number; cooldown_remaining_ms?: number },
  ) => void;
  clearDetectorStatus: (id: string) => void;
}>) {
  const { t } = useI18n();
  const { push: pushToast } = useToast();
  const timerRunning = !!pokemon.timer_started_at;
  const anyRunning = timerRunning || detectorRunning;

  useSecondTick(timerRunning);

  const totalMs = computeTimerMs(pokemon);
  const mode = pokemon.hunt_mode || "both";
  // "both" behaves like timer-only ONLY when no detector is configured at
  // all. Once a DetectorConfig exists, the user has opted into detection
  // and must satisfy source + template preconditions.
  const effectiveMode: HuntMode = mode === "both" && !pokemon.detector_config ? "timer" : mode;
  const canStartTimer = effectiveMode === "timer" || !timerStartBlocked;
  const canStartDet = canStartDetector(
    pokemon,
    detectorStatus as Record<string, { state?: string; confidence?: number }>,
    capture,
  );
  const canStartSomething = effectiveMode === "timer" ? canStartTimer : canStartDet;
  const canToggle = anyRunning || (!disabled && canStartSomething);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canToggle) return;
    if (anyRunning) {
      if (timerRunning) send("timer_stop", { pokemon_id: pokemon.id });
      stopDetectionForPokemon(pokemon.id);
      clearDetectorStatus(pokemon.id);
    } else {
      if (effectiveMode !== "detector" && canStartTimer && !pokemon.timer_started_at) {
        send("timer_start", { pokemon_id: pokemon.id });
      }
      if (canStartDet) {
        tryStartDetection(pokemon, capture, setDetectorStatus, () =>
          pushToast({ type: "error", title: t("detector.errStartFailed"), key: keyDetectorStart }),
        );
      }
    }
  };

  return (
    <div className="flex items-center gap-1 shrink-0">
      {/* Detector status icon */}
      {hasDetectorReady(pokemon) &&
        (() => {
          const st = detectorStatus[pokemon.id] as { state?: string } | undefined;
          if (st?.state === "match")
            return (
              <span className="shrink-0 flex items-center" title={t("detector.stateMatch")}>
                <Sparkles
                  className="w-3 h-3 text-accent-green"
                  aria-label={t("detector.stateMatch")}
                />
              </span>
            );
          if (st)
            return (
              <span className="shrink-0 flex items-center" title={t("detector.stateIdle")}>
                <Eye
                  className="w-3 h-3 text-accent-blue animate-pulse"
                  aria-label={t("detector.stateIdle")}
                />
              </span>
            );
          if (!capture.isCapturing(pokemon.id))
            return (
              <span className="shrink-0 flex items-center" title={t("detector.errNoSource")}>
                <VideoOff
                  className="w-3 h-3 text-accent-red/70"
                  aria-label={t("detector.errNoSource")}
                />
              </span>
            );
          return null;
        })()}
      {/* Timer text */}
      {(timerRunning || totalMs > 0) && (
        <span
          className={`text-[10px] font-mono tabular-nums leading-3 translate-y-px ${timerRunning ? "text-accent-green" : "text-text-muted"}`}
        >
          {formatTimer(totalMs)}
        </span>
      )}
      {/* Play/stop toggle */}
      <button
        onClick={handleToggle}
        disabled={!canToggle}
        className={`p-0.5 rounded-none transition-colors ${resolveToggleTone(canToggle, anyRunning)}`}
        title={anyRunning ? t("sidebar.stopHunt") : t("sidebar.startHunt")}
        aria-label={anyRunning ? t("sidebar.stopHunt") : t("sidebar.startHunt")}
      >
        {anyRunning ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
      </button>
    </div>
  );
}
