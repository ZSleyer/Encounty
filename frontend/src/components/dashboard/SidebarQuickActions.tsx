/**
 * SidebarQuickActions.tsx: Action bar above the sidebar hunt list.
 *
 * Starts and stops the current selection, switches its hunt mode and carries
 * the bulk actions plus the total encounter count. The resolveHunt* helpers
 * that turn a mode into a label, icon or colour live here as well; the header
 * hunt button reuses them so both buttons stay in step.
 */

import {
  BarChart3,
  Check,
  ChevronDown,
  Eye,
  PartyPopper,
  Play,
  Square,
  Timer,
  Trash2,
  X,
} from "lucide-react";
import { Pokemon } from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { useToast } from "../../contexts/ToastContext";
import { useCounterStore } from "../../hooks/useCounterState";
import { useAnchorName, anchorTriggerStyle, anchoredMenuStyle } from "../../utils/anchoredMenu";
import { isLoopRunning } from "../../engine/DetectionLoop";
import { stopDetectionForPokemon } from "../../engine/startDetection";
import {
  canPokemonStart,
  canStartDetector,
  hasDetectorReady,
  huntButtonClass,
  isTimerStartBlocked,
  keyDetectorStart,
  tryStartDetection,
  updateHuntMode,
} from "./huntMode";
import type { HuntMode, SidebarTab } from "./types";

/** Sidebar quick actions bar: start/stop hunts, mode selector, selection actions, and the total encounter count. */
export function SidebarQuickActions({
  allPokemon,
  activeHunts,
  selectedIds,
  sidebarTab,
  detectorStatus,
  showHuntMenu,
  setShowHuntMenu,
  send,
  capture,
  setDetectorStatus,
  clearDetectorStatus,
  bulkComplete,
  bulkDelete,
  setSelectedIds,
  viewedPokemonId,
}: Readonly<{
  allPokemon: Pokemon[];
  activeHunts: Pokemon[];
  selectedIds: Set<string>;
  sidebarTab: SidebarTab;
  detectorStatus: Record<string, { state?: string; confidence?: number }>;
  showHuntMenu: boolean;
  setShowHuntMenu: (v: boolean | ((prev: boolean) => boolean)) => void;
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
  bulkComplete: () => void;
  bulkDelete: () => void;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  viewedPokemonId: string | null;
}>) {
  const { t } = useI18n();
  const { push: pushToast } = useToast();
  const huntMenuAnchor = useAnchorName("hunt-mode");
  const activeId = useCounterStore((s) => s.appState?.active_id);
  const viewedId = viewedPokemonId || activeId;
  const viewedPokemon = viewedId ? (allPokemon.find((p) => p.id === viewedId) ?? null) : null;
  // selected = explicitly multi-selected pokemon, or the currently viewed pokemon
  const selected =
    selectedIds.size > 0
      ? allPokemon.filter((p) => selectedIds.has(p.id))
      : viewedPokemon
        ? [viewedPokemon]
        : [];
  const hasSelection = selected.length > 0;
  // Global running indicators (shown in the bar regardless of selection)
  const hasRunningTimer = activeHunts.some((p) => !!p.timer_started_at);
  const hasRunningDetector = activeHunts.some((p) => !!detectorStatus[p.id] || isLoopRunning(p.id));
  // Selection-scoped state for the start/stop button
  const withDetector = selected.filter((p) => hasDetectorReady(p));
  const hasDetector = withDetector.length > 0;
  const isRunning = (p: Pokemon) =>
    !!p.timer_started_at || !!detectorStatus[p.id] || isLoopRunning(p.id);
  const allRunning = hasSelection && selected.every(isRunning);
  const someRunning = hasSelection && selected.some(isRunning);
  const canStart =
    hasSelection &&
    selected.filter((p) => !isRunning(p)).every((p) => canPokemonStart(p, capture.isCapturing));

  const currentMode = resolveHuntMode(selected);

  /** Start each selected pokemon according to its own hunt_mode. */
  const startAll = () => {
    for (const p of selected) {
      if (isRunning(p)) continue; // Skip already-running pokemon
      const mode = p.hunt_mode || "both";
      if (
        mode !== "detector" &&
        !p.timer_started_at &&
        !isTimerStartBlocked(p, capture.isCapturing)
      )
        send("timer_start", { pokemon_id: p.id });
      if (canStartDetector(p, detectorStatus, capture)) {
        tryStartDetection(p, capture, setDetectorStatus, () =>
          pushToast({ type: "error", title: t("detector.errStartFailed"), key: keyDetectorStart }),
        );
      }
    }
  };
  const stopAll = () => {
    for (const p of selected) {
      if (p.timer_started_at) send("timer_stop", { pokemon_id: p.id });
      stopDetectionForPokemon(p.id);
      clearDetectorStatus(p.id);
    }
  };
  const setHuntMode = (mode: HuntMode) => {
    for (const p of selected) updateHuntMode(p, mode);
    setShowHuntMenu(false);
  };

  const sidebarLabel = resolveHuntLabel(allRunning, currentMode, t);
  const sidebarIcon = resolveHuntIcon(allRunning, currentMode);
  const totalEncounters = allPokemon.reduce((s, p) => s + p.encounters, 0);
  const totalEncountersLabel = t("group.totalEncounters", { count: String(totalEncounters) });

  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-border-subtle">
      <div className="relative flex items-center">
        <button
          disabled={!canStart && !someRunning}
          onClick={() => {
            if (allRunning) stopAll();
            else startAll();
          }}
          className={`p-1.5 rounded-none transition-colors ${huntButtonClass(allRunning, canStart, currentMode)}`}
          title={sidebarLabel}
        >
          {sidebarIcon}
        </button>
        <button
          onClick={() => setShowHuntMenu((v: boolean) => !v)}
          style={anchorTriggerStyle(huntMenuAnchor)}
          className="p-1.5 text-text-muted hover:text-text-primary transition-colors"
          title={sidebarLabel}
        >
          <ChevronDown className="w-3 h-3" />
        </button>
        {showHuntMenu && (
          <>
            <button
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setShowHuntMenu(false)}
              aria-label="Close"
            />
            <div
              style={anchoredMenuStyle(huntMenuAnchor, "below-start")}
              className="fixed z-50 overflow-y-auto bg-bg-secondary border border-border-subtle rounded-none shadow-lg py-1 min-w-40"
            >
              <button
                onClick={() => setHuntMode("both")}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-text-secondary hover:bg-bg-primary transition-colors"
              >
                <Timer className="w-3.5 h-3.5" />
                <Eye className="w-3.5 h-3.5 -ml-1" />
                {t("sidebar.both")}
                {currentMode === "both" && <Check className="ml-auto w-3 h-3 text-accent-green" />}
              </button>
              <button
                onClick={() => setHuntMode("timer")}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-text-secondary hover:bg-bg-primary transition-colors"
              >
                <Timer className="w-3.5 h-3.5" />
                {t("sidebar.timerOnly")}
                {currentMode === "timer" && <Check className="ml-auto w-3 h-3 text-accent-green" />}
              </button>
              <button
                onClick={() => setHuntMode("detector")}
                disabled={!hasDetector && !hasRunningDetector}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-text-secondary hover:bg-bg-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title={hasDetector ? undefined : t("sidebar.detectorNotReady")}
              >
                <Eye className="w-3.5 h-3.5" />
                {t("sidebar.detectorOnly")}
                {currentMode === "detector" && (
                  <Check className="ml-auto w-3 h-3 text-accent-green" />
                )}
              </button>
            </div>
          </>
        )}
      </div>

      {hasRunningTimer && (
        <span className="flex items-center gap-1 text-[10px] text-accent-green">
          <Timer className="w-3 h-3" />
        </span>
      )}
      {hasRunningDetector && (
        <span className="flex items-center gap-1 text-[10px] text-accent-blue">
          <Eye className="w-3 h-3" />
        </span>
      )}

      <div className="flex-1" />
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-accent-blue font-semibold tabular-nums">
            {selectedIds.size}
          </span>
          {sidebarTab === "active" && (
            <button
              onClick={bulkComplete}
              className="p-1 rounded-none text-text-faint hover:text-accent-green transition-colors"
              title={t("dash.caught")}
              aria-label={t("dash.caught")}
            >
              <PartyPopper className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={bulkDelete}
            className="p-1 rounded-none text-text-faint hover:text-accent-red transition-colors"
            title={t("dash.delete")}
            aria-label={t("dash.delete")}
          >
            <Trash2 className="w-3 h-3" />
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="p-0.5 rounded-none text-text-faint hover:text-text-primary transition-colors"
            title={t("timer.clearSelection")}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
      {/* Total encounters across all hunts, right-aligned micro label */}
      <span className="t-label gap-1 shrink-0 tabular-nums" title={totalEncountersLabel}>
        <BarChart3 className="w-3 h-3 text-accent-blue" aria-hidden="true" />
        {totalEncounters}
        <span className="sr-only">{totalEncountersLabel}</span>
      </span>
    </div>
  );
}

/** Resolves the common hunt mode across a selection of Pokemon. */
function resolveHuntMode(pokemon: Pokemon[]): "both" | "timer" | "detector" {
  const modes = pokemon.map((p) => p.hunt_mode || "both");
  if (modes.every((m) => m === "timer")) return "timer";
  if (modes.every((m) => m === "detector")) return "detector";
  return "both";
}

/** Resolves the hunt button label based on running state and mode. */
export function resolveHuntLabel(
  anyRunning: boolean,
  mode: string,
  t: (key: string) => string,
): string {
  if (anyRunning) {
    if (mode === "timer") return t("sidebar.stopTimer");
    if (mode === "detector") return t("sidebar.stopDetector");
    return t("sidebar.stopHunt");
  }
  if (mode === "timer") return t("sidebar.startTimer");
  if (mode === "detector") return t("sidebar.startDetector");
  return t("sidebar.startHunt");
}

/** Resolves the hunt button icon based on running state and mode. */
export function resolveHuntIcon(anyRunning: boolean, mode: string): React.ReactNode {
  if (mode === "timer") return <Timer className="w-3.5 h-3.5" />;
  if (mode === "detector") return <Eye className="w-3.5 h-3.5" />;
  return anyRunning ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />;
}

/** Resolves the hunt button background color based on running state and mode. */
export function resolveHuntBgColor(anyRunning: boolean, mode: string): string {
  if (anyRunning) return "bg-accent-red/15";
  if (mode === "detector") return "bg-accent-purple";
  if (mode === "timer") return "bg-accent-green";
  return "bg-accent-blue";
}
