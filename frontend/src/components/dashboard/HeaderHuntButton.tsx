/**
 * HeaderHuntButton.tsx: Split start/stop button of the hunt header.
 */

import { Check, ChevronDown, Eye, Timer } from "lucide-react";
import { Pokemon } from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { useToast } from "../../contexts/ToastContext";
import { useAnchorName, anchorTriggerStyle, anchoredMenuStyle } from "../../utils/anchoredMenu";
import { isLoopRunning } from "../../engine/DetectionLoop";
import { stopDetectionForPokemon } from "../../engine/startDetection";
import {
  canPokemonStart,
  canStartDetector,
  hasDetectorReady,
  keyDetectorStart,
  tryStartDetection,
  updateHuntMode,
} from "./huntMode";
import { resolveHuntBgColor, resolveHuntIcon, resolveHuntLabel } from "./SidebarQuickActions";

/** Tone classes of the start/stop button; the blocked state outranks the running one. */
function resolveToggleTone(huntBlocked: boolean, anyRunning: boolean): string {
  if (huntBlocked) return "opacity-50 cursor-not-allowed text-text-muted";
  if (anyRunning) return "text-accent-red hover:bg-accent-red/20";
  return "hover:bg-white/10";
}

/** Header hunt start/stop split button with mode dropdown. */
export function HeaderHuntButton({
  pokemon,
  detectorStatus,
  showMenu,
  setShowMenu,
  send,
  capture,
  setDetectorStatus,
  clearDetectorStatus,
}: Readonly<{
  pokemon: Pokemon;
  detectorStatus: Record<string, { state?: string; confidence?: number }>;
  showMenu: boolean;
  setShowMenu: (v: boolean | ((prev: boolean) => boolean)) => void;
  send: (type: string, payload: unknown) => void;
  capture: {
    isCapturing: (id: string) => boolean;
    getVideoElement: (id: string) => HTMLVideoElement | null;
  };
  setDetectorStatus: (
    id: string,
    status: { state: string; confidence: number; poll_ms: number },
  ) => void;
  clearDetectorStatus: (id: string) => void;
}>) {
  const { t } = useI18n();
  const modeMenuAnchor = useAnchorName("row-mode");
  const { push: pushToast } = useToast();
  const timerRunning = !!pokemon.timer_started_at;
  const detRunning = !!detectorStatus[pokemon.id] || isLoopRunning(pokemon.id);
  const detReady = hasDetectorReady(pokemon);
  const huntMode = pokemon.hunt_mode || "both";
  const anyRunning = timerRunning || detRunning;
  const huntBlocked = !anyRunning && !canPokemonStart(pokemon, capture.isCapturing);

  const buttonLabel = resolveHuntLabel(anyRunning, huntMode, t);
  const modeIcon = resolveHuntIcon(anyRunning, huntMode);
  const bgColor = huntBlocked
    ? "bg-bg-card border border-border-subtle"
    : resolveHuntBgColor(anyRunning, huntMode);

  const startHunt = () => {
    const needsDetector = huntMode !== "timer";

    if (needsDetector && !hasDetectorReady(pokemon)) {
      pushToast({ type: "error", title: t("detector.errNoTemplates"), key: "detector-templates" });
      return;
    }
    if (needsDetector && !capture.isCapturing(pokemon.id)) {
      pushToast({ type: "error", title: t("detector.errNoSource"), key: "capture-source" });
      return;
    }

    if (huntMode !== "detector" && !pokemon.timer_started_at)
      send("timer_start", { pokemon_id: pokemon.id });
    if (canStartDetector(pokemon, detectorStatus, capture)) {
      tryStartDetection(pokemon, capture, setDetectorStatus, () =>
        pushToast({ type: "error", title: t("detector.errStartFailed"), key: keyDetectorStart }),
      );
    }
  };

  const handleToggle = () => {
    if (anyRunning) {
      if (timerRunning) send("timer_stop", { pokemon_id: pokemon.id });
      stopDetectionForPokemon(pokemon.id);
      clearDetectorStatus(pokemon.id);
    } else {
      startHunt();
    }
  };

  return (
    <div className="relative shrink-0" data-detector-tutorial="controls">
      <div className={`flex items-center rounded-none overflow-hidden ${bgColor}`}>
        <button
          onClick={handleToggle}
          disabled={huntBlocked}
          className={`flex items-center gap-1.5 pl-3 pr-2 py-1.5 text-xs font-bold transition-colors ${resolveToggleTone(huntBlocked, anyRunning)}`}
          aria-label={buttonLabel}
          title={huntBlocked ? t("detector.errNoSource") : undefined}
        >
          {modeIcon}
          <span className="hidden sm:inline">{buttonLabel}</span>
        </button>
        <div className={`w-px h-4 ${anyRunning ? "bg-accent-red/30" : "bg-white/20"}`} />
        <button
          onClick={() => setShowMenu((v: boolean) => !v)}
          className={`px-1.5 py-1.5 transition-colors ${
            anyRunning ? "text-accent-red hover:bg-accent-red/20" : "hover:bg-white/10"
          }`}
          aria-label={t("sidebar.both")}
          style={anchorTriggerStyle(modeMenuAnchor)}
        >
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>
      {showMenu && (
        <>
          <button
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setShowMenu(false)}
            aria-label={t("aria.close")}
          />
          <div
            style={anchoredMenuStyle(modeMenuAnchor, "below-end")}
            className="fixed z-50 overflow-y-auto bg-bg-secondary border border-border-subtle rounded-none shadow-lg py-1 min-w-40"
          >
            {[
              {
                mode: "both" as const,
                icon: (
                  <>
                    <Timer className="w-3.5 h-3.5" />
                    <Eye className="w-3.5 h-3.5 -ml-1" />
                  </>
                ),
                label: t("sidebar.both"),
              },
              {
                mode: "timer" as const,
                icon: <Timer className="w-3.5 h-3.5" />,
                label: t("sidebar.timerOnly"),
              },
              {
                mode: "detector" as const,
                icon: <Eye className="w-3.5 h-3.5" />,
                label: t("sidebar.detectorOnly"),
                disabled: !detReady && !detRunning,
              },
            ].map(({ mode, icon, label, disabled }) => (
              <button
                key={mode}
                onClick={() => {
                  updateHuntMode(pokemon, mode);
                  setShowMenu(false);
                }}
                disabled={disabled}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-text-secondary hover:bg-bg-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {icon}
                {label}
                {huntMode === mode && <Check className="ml-auto w-3 h-3 text-accent-green" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
