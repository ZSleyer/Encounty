/**
 * Dashboard.tsx — Main counter UI.
 *
 * Displays a split layout: a left sidebar lists all tracked Pokémon and an
 * optional search/filter, while the right panel shows detailed controls for
 * the active Pokémon (increment, decrement, reset, complete/delete).
 * Counter actions are sent over WebSocket for immediate multi-tab sync.
 */
import { useState, useEffect, useRef, useReducer, Fragment } from "react";
import {
  Plus,
  Minus,
  RotateCcw,
  Edit2,
  Gamepad2,
  LayoutGrid,
  Search,
  Trophy,
  Undo2,
  Sparkles,
  X,
  PartyPopper,
  Trash2,
  Eye,
  Layers,
  Save,
  RefreshCw,
  ExternalLink,
  Download,
  ChevronDown,
  Globe,
  Pencil,
  Play,
  Square,
  Timer,
  BarChart3,
  Check,
  Keyboard,
  MoreVertical,
  Funnel,
  ArrowUpDown,
  PanelLeftClose,
  PanelLeftOpen,
  Tally5,
  AlertTriangle,
  Monitor,
  Video,
  VideoOff,
  FolderPlus,
} from "lucide-react";
import { Link } from "react-router";
import { AddPokemonModal, NewPokemonData } from "../components/pokemon/AddPokemonModal";
import { EditPokemonModal } from "../components/pokemon/EditPokemonModal";
import { ConfirmModal } from "../components/shared/ConfirmModal";
import { SetEncounterModal } from "../components/shared/SetEncounterModal";
import { SetTimerModal } from "../components/shared/SetTimerModal";
import { StatisticsPanel } from "../components/shared/StatisticsPanel";
import { DetectorPanel } from "../components/detector/DetectorPanel";
import { isLoopRunning } from "../engine/DetectionLoop";
import { startDetectionForPokemon, stopDetectionForPokemon } from "../engine/startDetection";
import { OverlayEditor } from "../components/overlay-editor/OverlayEditor";
import { useCounterStore } from "../hooks/useCounterState";
import { useWebSocket } from "../hooks/useWebSocket";
import { Pokemon, DetectorConfig, OverlaySettings, OverlayMode, AppState, Group } from "../types";
import { TagChip } from "../components/shared/TagChip";
import { TagFilterBar } from "../components/shared/TagFilterBar";
import { SidebarGroupSection, type GroupAction } from "../components/shared/SidebarGroupSection";
import { GroupManagementModal } from "../components/shared/GroupManagementModal";
import { GroupCounterView } from "../components/group/GroupCounterView";
import { updateGroup, startGroupHunt, stopGroupHunt } from "../utils/groupsApi";
import { useI18n } from "../contexts/I18nContext";
import { useCaptureService, useCaptureVersion } from "../contexts/CaptureServiceContext";
import { useToast } from "../contexts/ToastContext";
import { resolveOverlay } from "../utils/overlay";
import { getOddsFractional } from "../utils/odds";
import { SPRITE_FALLBACK, resolveSpriteSrc, isCustomSprite } from "../utils/sprites";
import { TrimmedBoxSprite } from "../components/shared/TrimmedBoxSprite";

import { apiUrl, reorderPokemon, setPokemonGroup } from "../utils/api";

/** Sentinel viewedGroupId value selecting the synthetic "ungrouped" bucket. */
const UNGROUPED_VIEW_ID = "__ungrouped__";
import { formatTimer, computeTimerMs } from "../utils/timer";
import { OverlayBrowserSourceButton } from "../components/shared/OverlayBrowserSourceButton";
import { useModalA11y } from "../hooks/useModalA11y";

/** Tab identifiers for the right content panel. */
type PanelTab = "counter" | "detector" | "overlay" | "statistics";

/** PokemonTimer renders a compact monospace timer with play/pause/reset controls for the hero panel header. */
function PokemonTimer({ pokemon, send, disabled = false, timerStartBlocked = false }: Readonly<{ pokemon: Pokemon; send: (type: string, payload: unknown) => void; disabled?: boolean; timerStartBlocked?: boolean }>) {
  const { t } = useI18n();
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const isRunning = !!pokemon.timer_started_at;
  const timeText = formatTimer(computeTimerMs(pokemon));

  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => forceUpdate(), 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => setEditOpen(true)}
        className="text-sm font-mono tabular-nums text-text-primary hover:text-accent-blue transition-colors cursor-pointer px-1"
        title={t("timer.editTitle")}
        aria-label={`${t("aria.timerEdit")}: ${timeText}`}
      >
        {timeText}
      </button>
      <div className="flex gap-0.5">
        {isRunning ? (
          <button
            onClick={() => send("timer_stop", { pokemon_id: pokemon.id })}
            className="p-1.5 rounded-none text-accent-yellow hover:bg-bg-hover transition-colors"
            title={t("timer.stop")}
            aria-label={t("aria.timerPause")}
          >
            <Square className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            onClick={() => send("timer_start", { pokemon_id: pokemon.id })}
            disabled={disabled || timerStartBlocked}
            className="p-1.5 rounded-none text-accent-blue hover:bg-bg-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={timerStartBlocked ? t("detector.errNoSource") : t("timer.start")}
            aria-label={t("aria.timerStart")}
          >
            <Play className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={() => setConfirmResetOpen(true)}
          disabled={disabled}
          className="p-1.5 rounded-none text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title={t("timer.reset")}
          aria-label={t("aria.timerReset")}
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>
      {editOpen && (
        <SetTimerModal
          currentMs={computeTimerMs(pokemon)}
          onSave={(ms) => send("timer_set", { pokemon_id: pokemon.id, ms })}
          onClose={() => setEditOpen(false)}
        />
      )}
      {confirmResetOpen && (
        <ConfirmModal
          title={t("confirm.timerResetTitle")}
          message={t("confirm.timerResetMsg")}
          isDestructive
          onConfirm={() => send("timer_reset", { pokemon_id: pokemon.id })}
          onClose={() => setConfirmResetOpen(false)}
        />
      )}
    </div>
  );
}

/** Returns true if the Pokemon has at least one enabled detector template. */
function hasDetectorReady(pokemon: Pokemon): boolean {
  const tmpls = pokemon.detector_config?.templates;
  if (!tmpls || tmpls.length === 0) return false;
  return tmpls.some((t) => t.enabled !== false);
}

/** Returns the base name and form name from Pokemon data, or falls back to parsing the display name. */
function getBaseAndFormName(p: Pokemon): [string, string | null] {
  if (p.base_name || p.form_name) {
    return [p.base_name || p.name, p.form_name || null];
  }
  const m = p.name.match(/^(.+?)\s*\((.+)\)$/);
  return m ? [m[1], m[2]] : [p.name, null];
}

/**
 * Deterministic dot color for a tag, matching the djb2-derived hue used by
 * TagChip so the compact sidebar dots and the full chips stay color-consistent.
 */
function tagDotColor(tag: string): string {
  let hash = 5381;
  for (let i = 0; i < tag.length; i++) {
    hash = (hash * 33) ^ tag.charCodeAt(i);
  }
  return `hsl(${Math.abs(hash) % 360}, 70%, 65%)`;
}

/** Returns true when the timer start should be blocked because the hunt requires a detector source that is not connected. */
function isTimerStartBlocked(pokemon: Pokemon, isCapturing: (id: string) => boolean): boolean {
  const mode = pokemon.hunt_mode || "both";
  if (mode === "timer") return false;
  // "both" falls back to timer-only only when detector is not configured at
  // all for this Pokémon (e.g. plain hand-counting). Once a DetectorConfig
  // exists, the user has opted into auto-detection and we must enforce
  // templates + source before any timer starts.
  if (mode === "both" && !pokemon.detector_config) return false;
  return !hasDetectorReady(pokemon) || !isCapturing(pokemon.id);
}

/** Returns true if a non-running Pokemon can be individually started given its hunt_mode and capture source state. */
function canPokemonStart(
  pokemon: Pokemon,
  isCapturing: (id: string) => boolean,
): boolean {
  const mode = pokemon.hunt_mode || "both";
  if (mode === "timer") return true;
  return hasDetectorReady(pokemon) && isCapturing(pokemon.id);
}

/** SidebarHuntStatus shows compact hunt status, timer, and play/pause per sidebar card. */
function SidebarHuntStatus({ pokemon, send, detectorRunning, disabled = false, timerStartBlocked = false, capture, detectorStatus, setDetectorStatus, clearDetectorStatus }: Readonly<{
  pokemon: Pokemon;
  send: (type: string, payload: unknown) => void;
  detectorRunning: boolean;
  disabled?: boolean;
  timerStartBlocked?: boolean;
  capture: { isCapturing: (id: string) => boolean; getVideoElement: (id: string) => HTMLVideoElement | null };
  detectorStatus: Record<string, unknown>;
  setDetectorStatus: (id: string, status: { state: string; confidence: number; poll_ms: number; cooldown_remaining_ms?: number }) => void;
  clearDetectorStatus: (id: string) => void;
}>) {
  const { t } = useI18n();
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  const timerRunning = !!pokemon.timer_started_at;
  const anyRunning = timerRunning || detectorRunning;

  useEffect(() => {
    if (!timerRunning) return;
    const id = setInterval(() => forceUpdate(), 1000);
    return () => clearInterval(id);
  }, [timerRunning]);

  const totalMs = computeTimerMs(pokemon);
  const mode = pokemon.hunt_mode || "both";
  // "both" behaves like timer-only ONLY when no detector is configured at
  // all. Once a DetectorConfig exists, the user has opted into detection
  // and must satisfy source + template preconditions.
  const effectiveMode: HuntMode = mode === "both" && !pokemon.detector_config ? "timer" : mode;
  const canStartTimer = effectiveMode === "timer" || !timerStartBlocked;
  const canStartDet = canStartDetector(pokemon, detectorStatus as Record<string, { state?: string; confidence?: number }>, capture);
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
      if (canStartDet) tryStartDetection(pokemon, capture, setDetectorStatus);
    }
  };

  return (
    <div className="flex items-center gap-1 shrink-0">
      {/* Detector status icon */}
      {hasDetectorReady(pokemon) && (() => {
        const st = detectorStatus[pokemon.id] as { state?: string } | undefined;
        if (st?.state === "match") return <span className="shrink-0 flex items-center" title={t("detector.stateMatch")}><Sparkles className="w-3 h-3 text-accent-green" aria-label={t("detector.stateMatch")} /></span>;
        if (st) return <span className="shrink-0 flex items-center" title={t("detector.stateIdle")}><Eye className="w-3 h-3 text-accent-blue animate-pulse" aria-label={t("detector.stateIdle")} /></span>;
        if (!capture.isCapturing(pokemon.id)) return <span className="shrink-0 flex items-center" title={t("detector.errNoSource")}><VideoOff className="w-3 h-3 text-accent-red/70" aria-label={t("detector.errNoSource")} /></span>;
        return null;
      })()}
      {/* Timer text */}
      {(timerRunning || totalMs > 0) && (
        <span className={`text-[10px] font-mono tabular-nums leading-3 translate-y-px ${timerRunning ? "text-accent-green" : "text-text-muted"}`}>
          {formatTimer(totalMs)}
        </span>
      )}
      {/* Play/stop toggle */}
      <button
        onClick={handleToggle}
        disabled={!canToggle}
        className={`p-0.5 rounded-none transition-colors ${
          !canToggle ? "text-text-faint opacity-50 cursor-not-allowed" :
          anyRunning ? "text-accent-green hover:text-accent-yellow" :
          "text-text-faint hover:text-accent-green"
        }`}
        title={anyRunning ? t("sidebar.stopHunt") : t("sidebar.startHunt")}
        aria-label={anyRunning ? t("sidebar.stopHunt") : t("sidebar.startHunt")}
      >
        {anyRunning ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
      </button>
    </div>
  );
}

function huntButtonClass(anyRunning: boolean, canStart: boolean, mode: string): string {
  if (anyRunning) return "text-accent-red hover:bg-accent-red/10";
  if (!canStart) return "opacity-30 cursor-not-allowed text-text-muted";
  if (mode === "detector") return "text-accent-purple hover:bg-accent-purple/10";
  if (mode === "timer") return "text-accent-green hover:bg-accent-green/10";
  return "text-accent-blue hover:text-accent-blue hover:bg-accent-blue/10";
}

/** Resolves the overlay settings for a given viewed Pokemon. */
function resolveCurrentOverlay(
  appState: { pokemon: Pokemon[]; active_id: string; settings: { overlay: OverlaySettings } } | null,
  viewedPokemonId: string | null,
): OverlaySettings | null {
  if (!appState) return null;
  const viewed = appState.pokemon.find(
    (p) => p.id === (viewedPokemonId || appState.active_id),
  );
  if (!viewed) return null;
  const mode = viewed.overlay_mode || "default";
  return mode === "custom" && viewed.overlay
    ? viewed.overlay
    : resolveOverlay(viewed, appState.pokemon, appState.settings.overlay);
}

/** Filters a Pokemon list by a search query, matching name, canonical name, or game. */
function filterPokemonByQuery(list: Pokemon[], query: string): Pokemon[] {
  if (!query) return list;
  return list.filter(
    (p) =>
      p.name.toLowerCase().includes(query) ||
      p.canonical_name.toLowerCase().includes(query) ||
      p.game?.toLowerCase().includes(query),
  );
}

/** Resolves overlay settings from a copy source (global or another Pokemon). */
function resolveCopySource(
  sourceId: string,
  pokemon: Pokemon[],
  globalOverlay: OverlaySettings,
): OverlaySettings | null {
  if (sourceId === "global") return globalOverlay;
  const p = pokemon.find((x) => x.id === sourceId);
  return p ? resolveOverlay(p, pokemon, globalOverlay) : null;
}

/** Formats a game key into a short display string. */
function formatGame(game: string): string {
  return game
    ? game.replace("pokemon-", "").replace("letsgo", "L.G. ").toUpperCase()
    : "—";
}

/** Builds a confirmation dialog config for a reset request, or null if the message is not a reset. */
function buildResetConfirmConfig(
  msg: { type: string; payload: unknown },
  pokemon: Pokemon[],
  t: (key: string) => string,
  onConfirm: (pokemonId: string) => void,
  onConfirmGroup: (groupId: string) => void,
): { isOpen: boolean; title: string; message: string; isDestructive: boolean; onConfirm: () => void } | null {
  if (msg.type === "request_reset_confirm") {
    const payload = msg.payload as { pokemon_id: string };
    const match = pokemon.find((p) => p.id === payload.pokemon_id);
    const nameSuffix = match ? ` (${match.name})` : "";
    return {
      isOpen: true,
      title: t("confirm.resetTitle"),
      message: `${t("confirm.resetMsg")}${nameSuffix}`,
      isDestructive: true,
      onConfirm: () => onConfirm(payload.pokemon_id),
    };
  }
  if (msg.type === "request_group_reset_confirm") {
    const payload = msg.payload as { group_id: string };
    return {
      isOpen: true,
      title: t("confirm.resetTitle"),
      message: t("confirm.resetGroupMsg"),
      isDestructive: true,
      onConfirm: () => onConfirmGroup(payload.group_id),
    };
  }
  return null;
}

/** Switches away from the detector tab when the viewed Pokemon gets archived. */
function useForceCounterOnArchive(
  appState: { pokemon: Pokemon[]; active_id: string } | null,
  viewedPokemonId: string | null,
  rightPanelTab: string,
  setRightPanelTab: (tab: PanelTab) => void,
) {
  useEffect(() => {
    const viewed = appState?.pokemon.find((p) => p.id === (viewedPokemonId || appState?.active_id));
    if (viewed?.completed_at && rightPanelTab === "detector") {
      setRightPanelTab("counter");
    }
  }, [appState?.pokemon, viewedPokemonId, appState?.active_id, rightPanelTab]);
}

/** Pauses hotkeys while the overlay editor tab is active. */
function useHotkeyPause(activeTab: string) {
  useEffect(() => {
    if (activeTab === "overlay") {
      void fetch(apiUrl("/api/hotkeys/pause"), { method: "POST" }).catch(() => {});
    } else {
      void fetch(apiUrl("/api/hotkeys/resume"), { method: "POST" }).catch(() => {});
    }
  }, [activeTab]);
}

/** Resolves detector dot styling and title for a sidebar Pokemon sprite. */
function resolveDetectorDot(
  detectorStatus: Record<string, { state?: string; confidence?: number }>,
  pokemonId: string,
  t: (key: string) => string,
  isCapturing?: boolean,
): { dotClass: string; title: string } {
  const isMatch = detectorStatus[pokemonId]?.state === "match";
  const isRunning = !!detectorStatus[pokemonId];
  if (isMatch) return { dotClass: "bg-accent-green", title: t("detector.stateMatch") };
  if (isRunning) return { dotClass: "bg-accent-blue animate-pulse", title: t("detector.stateIdle") };
  if (isCapturing === false) return { dotClass: "bg-accent-red/60", title: t("detector.errNoSource") };
  return { dotClass: "bg-text-faint/40", title: t("detector.stopped") };
}

/** Starts detection for a single Pokemon if it meets all prerequisites. */
function tryStartDetection(
  pokemon: Pokemon,
  capture: { isCapturing: (id: string) => boolean; getVideoElement: (id: string) => HTMLVideoElement | null },
  setDetectorStatus: (id: string, status: { state: string; confidence: number; poll_ms: number; cooldown_remaining_ms?: number }) => void,
): void {
  const cfg = pokemon.detector_config;
  if (!cfg) return;
  startDetectionForPokemon({
    pokemonId: pokemon.id,
    templates: cfg.templates || [],
    config: cfg,
    getVideoElement: () => capture.getVideoElement(pokemon.id),
    onScore: (score, state, cooldownMs) => setDetectorStatus(pokemon.id, { state, confidence: score, poll_ms: 100, cooldown_remaining_ms: cooldownMs }),
  });
}

/** Returns whether a Pokemon's detector should be started (not timer-only, has detector ready, not running, capturing). */
function canStartDetector(
  pokemon: Pokemon,
  detectorStatus: Record<string, unknown>,
  capture: { isCapturing: (id: string) => boolean },
): boolean {
  const mode = pokemon.hunt_mode || "both";
  return mode !== "timer" && hasDetectorReady(pokemon) && !detectorStatus[pokemon.id] && capture.isCapturing(pokemon.id);
}

/** Context needed for sidebar keyboard navigation dispatch. */
interface SidebarKeyboardContext {
  aside: HTMLElement;
  displayList: Pokemon[];
  focusedIdx: number | null;
  selectedIds: Set<string>;
  searchQuery: string;
  setFocusedIdx: React.Dispatch<React.SetStateAction<number | null>>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  bulkDelete: () => void;
}

/** Handles ArrowDown/Up navigation in the sidebar list. */
function handleSidebarArrow(e: KeyboardEvent, ctx: SidebarKeyboardContext): void {
  e.preventDefault();
  const next = e.key === "ArrowDown"
    ? (ctx.focusedIdx === null ? 0 : Math.min(ctx.focusedIdx + 1, ctx.displayList.length - 1))
    : (ctx.focusedIdx === null ? ctx.displayList.length - 1 : Math.max(ctx.focusedIdx - 1, 0));
  ctx.setFocusedIdx(next);
  // Move real DOM focus along with the visual highlight so keyboard/AT users
  // land on the same item the highlight indicates, not just a visual cursor.
  const el = ctx.aside.querySelector<HTMLElement>(`[data-sidebar-idx="${next}"]`);
  el?.focus();
}

/**
 * Toggles selection of the focused sidebar item on Space. Enter (activate) is
 * handled by the item's own onKeyDown so it fires exactly once; routing it here
 * too would double-invoke handleActivate and cancel its view toggle.
 */
function handleSidebarFocusedAction(e: KeyboardEvent, ctx: SidebarKeyboardContext): void {
  if (ctx.focusedIdx === null || !ctx.displayList[ctx.focusedIdx]) return;
  e.preventDefault();
  const item = ctx.displayList[ctx.focusedIdx];
  ctx.setSelectedIds(prev => {
    const n = new Set(prev);
    if (n.has(item.id)) { n.delete(item.id); } else { n.add(item.id); }
    return n;
  });
}

/** Dispatches sidebar keyboard events for navigation and selection. */
function handleSidebarKeyboard(e: KeyboardEvent, ctx: SidebarKeyboardContext): void {
  if (!ctx.aside.contains(document.activeElement) && document.activeElement !== document.body) return;

  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    handleSidebarArrow(e, ctx);
  } else if (e.key === " ") {
    handleSidebarFocusedAction(e, ctx);
  } else if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    ctx.setSelectedIds(new Set(ctx.displayList.map(p => p.id)));
  } else if (e.key === "Escape") {
    if (ctx.selectedIds.size > 0) ctx.setSelectedIds(new Set());
    else if (ctx.searchQuery) ctx.setSearchQuery("");
  } else if (e.key === "Delete" && ctx.selectedIds.size > 0) {
    e.preventDefault();
    ctx.bulkDelete();
  }
}

/** Updates the hunt_mode for a Pokemon via the API with optimistic local update. */
function updateHuntMode(pokemon: Pokemon, mode: HuntMode): void {
  if (pokemon.hunt_mode !== mode) {
    // Optimistic local update so both header and sidebar reflect the change instantly
    const store = useCounterStore.getState();
    if (store.appState) {
      store.setAppState({
        ...store.appState,
        pokemon: store.appState.pokemon.map(p =>
          p.id === pokemon.id ? { ...p, hunt_mode: mode } : p,
        ),
      });
    }
    void fetch(apiUrl(`/api/pokemon/${pokemon.id}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...pokemon, hunt_mode: mode }),
    }).catch(() => {});
  }
}

/** Context needed for sidebar card multi-select. */
interface CardSelectionContext {
  displayList: Pokemon[];
  selectedIds: Set<string>;
  lastSelectedIdx: React.RefObject<number | null>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  handleActivate: (id: string) => void;
  viewedPokemonId: string | null;
}

/** Handle sidebar card clicks with Ctrl/Shift multi-select support. */
function applyCardSelection(
  e: React.MouseEvent,
  pokemonId: string,
  idx: number,
  ctx: CardSelectionContext,
): void {
  if (e.ctrlKey || e.metaKey) {
    ctx.setSelectedIds(prev => {
      const next = new Set(prev);
      // First Ctrl+click: also include the currently viewed pokemon so both end up selected
      if (next.size === 0 && ctx.viewedPokemonId && ctx.viewedPokemonId !== pokemonId) {
        next.add(ctx.viewedPokemonId);
      }
      if (next.has(pokemonId)) next.delete(pokemonId);
      else next.add(pokemonId);
      return next;
    });
    ctx.lastSelectedIdx.current = idx;
  } else if (e.shiftKey && ctx.lastSelectedIdx.current !== null) {
    const from = Math.min(ctx.lastSelectedIdx.current, idx);
    const to = Math.max(ctx.lastSelectedIdx.current, idx);
    ctx.setSelectedIds(prev => {
      const next = new Set(prev);
      for (let i = from; i <= to; i++) next.add(ctx.displayList[i].id);
      return next;
    });
  } else {
    if (ctx.selectedIds.size > 0) ctx.setSelectedIds(new Set());
    ctx.handleActivate(pokemonId);
  }
}

/** Registers a global Cmd+K / Ctrl+K shortcut that focuses the given ref. */
function useFocusShortcut(ref: React.RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, [ref]);
}

type SidebarTab = "active" | "archived";
type SortMode = "recent" | "name" | "encounters" | "game" | "manual";
type SortDir = "asc" | "desc";
type HuntMode = "both" | "timer" | "detector";

/** Loads the persisted sort mode from localStorage, defaulting to "recent". */
function loadSortMode(): SortMode {
  return (localStorage.getItem("encounty-sort-mode") as SortMode) || "recent";
}

/** Loads the persisted sort direction from localStorage, defaulting to "asc". */
function loadSortDir(): SortDir {
  return (localStorage.getItem("encounty-sort-dir") as SortDir) || "asc";
}

/**
 * Font size for the hero counter that shrinks as the number grows so extreme
 * encounter counts never overflow the panel.
 */
function heroCounterFontSize(value: number): string {
  const len = String(value).length;
  if (len > 9) return "clamp(24px, 3vw, 40px)";
  if (len > 6) return "clamp(34px, 4vw, 56px)";
  return "clamp(48px, 5vw, 80px)";
}

/** Sorts a Pokemon list by the given mode and direction. */
function sortPokemonList(list: Pokemon[], mode: SortMode, dir: SortDir): Pokemon[] {
  if (mode === "recent") return dir === "asc" ? list : [...list].reverse();
  // Manual order is absolute (set via drag-and-drop); direction does not apply.
  // Legacy items without sort_order sort to the end.
  if (mode === "manual") {
    return [...list].sort(
      (a, b) => (a.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.sort_order ?? Number.MAX_SAFE_INTEGER),
    );
  }
  const sorted = [...list].sort((a, b) => {
    if (mode === "name") return a.name.localeCompare(b.name);
    if (mode === "encounters") return a.encounters - b.encounters;
    if (mode === "game") return (a.game ?? "").localeCompare(b.game ?? "");
    return 0;
  });
  return dir === "desc" ? sorted.reverse() : sorted;
}

/** Apply a new overlay mode to the given Pokemon, handling confirmation and state updates. */
async function applyOverlayMode(
  newMode: "default" | "custom",
  pokemon: Pokemon,
  appState: AppState,
  t: (key: string) => string,
  updateOverlay: (id: string, mode: OverlayMode, overlay: OverlaySettings | null) => Promise<void>,
  setOverlay: (o: OverlaySettings) => void,
) {
  const currentMode = pokemon.overlay_mode || "default";
  const needsConfirm = currentMode === "custom" && newMode !== "custom";
  if (needsConfirm && !confirm(t("overlay.confirmModeChange"))) return;

  if (newMode === "default") {
    await updateOverlay(pokemon.id, "default", null);
    setOverlay(appState.settings.overlay);
  } else if (newMode === "custom") {
    const resolved = resolveOverlay(pokemon, appState.pokemon, appState.settings.overlay);
    setOverlay(resolved);
    await updateOverlay(pokemon.id, "custom", resolved);
  }
}

/** Renders the empty-list placeholder based on current search query and sidebar tab. */
function EmptyListPlaceholder({
  query,
  sidebarTab,
  onClearAndAdd,
  onAdd,
}: Readonly<{
  query: string;
  sidebarTab: SidebarTab;
  onClearAndAdd: () => void;
  onAdd: () => void;
}>) {
  const { t } = useI18n();
  if (query) {
    return (
      <>
        <Search className="w-8 h-8 text-text-faint mb-3" />
        <p className="text-sm text-text-muted">
          {t("dash.noMatch")} &bdquo;{query}&ldquo;
        </p>
        <button
          onClick={onClearAndAdd}
          className="mt-3 text-xs text-accent-blue hover:underline flex items-center gap-1"
        >
          <Plus className="w-3 h-3" />
          {t("dash.addNew")}
        </button>
      </>
    );
  }
  if (sidebarTab === "active") {
    return (
      <>
        <Gamepad2 className="w-10 h-10 text-text-faint mb-3" />
        <p className="text-sm text-text-muted">
          {t("dash.noPokemon")}
        </p>
        <button
          onClick={onAdd}
          className="mt-4 text-xs text-accent-blue hover:underline"
        >
          {t("dash.addFirst")}
        </button>
      </>
    );
  }
  return (
    <>
      <Trophy className="w-10 h-10 text-text-faint mb-3" />
      <p className="text-sm text-text-muted">
        {t("dash.noArchive")}
      </p>
      <p className="text-xs text-text-faint mt-1">
        {t("dash.noArchiveHint")}
      </p>
    </>
  );
}

/** Returns the CSS class for a header tab button based on active state. */
function tabButtonClass(isActive: boolean): string {
  return `px-4 py-2 rounded-none text-xs font-semibold transition-all flex items-center gap-1.5 ${
    isActive
      ? "bg-accent-blue text-white shadow"
      : "text-text-muted hover:text-text-primary hover:bg-bg-hover"
  }`;
}

/** Tempest micro-label shown next to each panel tab icon, visible at all sizes. */
function tabLabelClass(): string {
  return "uppercase tracking-[0.14em] text-[10px] font-semibold";
}

/** Builds the full CSS class for a sidebar Pokemon list item. */
function buildSidebarItemClass(borderClass: string, isFocused: boolean, isArchived: boolean): string {
  const focusRing = isFocused ? " ring-1 ring-inset ring-accent-blue/40" : "";
  const opacity = isArchived ? " opacity-70" : "";
  return `flex gap-2 2xl:gap-3 px-2.5 py-1.5 2xl:px-4 2xl:py-2 cursor-pointer transition-colors group ${borderClass}${focusRing}${opacity}`;
}

/** Handles Enter/Space keydown to activate a Pokemon in the sidebar. */
function handleActivateKeyDown(e: React.KeyboardEvent, pokemonId: string, onActivate: (id: string) => void): void {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    onActivate(pokemonId);
  }
}

/** Resolves the sprite URL for a Pokemon, falling back if there's an error or no URL. */
function resolveSpriteUrl(pokemonId: string, spriteUrl: string | undefined, imgError: Record<string, string>): string {
  const src = resolveSpriteSrc(spriteUrl);
  return imgError[pokemonId] === src ? SPRITE_FALLBACK : src;
}

/** Returns the border class for a sidebar Pokemon item based on selection state. */
function sidebarItemBorderClass(isSelected: boolean, isViewed: boolean): string {
  if (isSelected) return "bg-accent-blue/15 border-l-2 border-accent-blue";
  if (isViewed) return "bg-accent-blue/10 border-l-2 border-accent-blue";
  return "hover:bg-bg-hover border-l-2 border-transparent";
}

/** Handles sort button click: toggles direction if same mode, otherwise switches mode. */
function handleSortClick(
  clickedMode: SortMode,
  currentMode: SortMode,
  setSortMode: (m: SortMode) => void,
  setSortDir: React.Dispatch<React.SetStateAction<SortDir>>,
  setShowMenu: (v: boolean) => void,
): void {
  if (clickedMode === currentMode) {
    setSortDir(d => d === "asc" ? "desc" : "asc");
  } else {
    setSortMode(clickedMode);
    setSortDir("asc");
  }
  setShowMenu(false);
}

/** Returns CSS classes for the scrollable work area based on the active tab. */
function getWorkAreaClasses(tab: string): { innerMaxWidth: string; outerOverflow: string; outerJustify: string; innerHeight: string } {
  const innerMaxWidthMap: Record<string, string> = {
    counter: "max-w-3xl mt-0",
    overlay: "max-w-full mt-0",
    statistics: "max-w-full mt-0",
    detector: "max-w-full mt-0",
  };
  const isFullBleed = tab === "overlay" || tab === "detector";
  const needsFullHeight = isFullBleed || tab === "statistics";
  return {
    innerMaxWidth: innerMaxWidthMap[tab] ?? "max-w-2xl mt-0 pb-16",
    outerOverflow: isFullBleed ? "overflow-hidden p-0" : "overflow-y-auto p-4 md:p-8",
    outerJustify: tab === "counter" ? "justify-center" : "justify-start",
    innerHeight: needsFullHeight ? "h-full" : "",
  };
}

/** Renders the scrollable work area with tab content. */
function renderWorkArea(tab: string, content: React.ReactNode): React.ReactNode {
  const { innerMaxWidth, outerOverflow, outerJustify, innerHeight } = getWorkAreaClasses(tab);
  return (
    <div className={`flex-1 flex flex-col items-center relative z-10 w-full ${outerOverflow} ${outerJustify}`}>
      <div className={`flex flex-col items-center w-full ${innerHeight} ${innerMaxWidth}`}>
        {content}
      </div>
    </div>
  );
}

/** Resolves the content to render for the active tab. */
function resolveTabContent(
  tab: string,
  pokemon: Pokemon,
  renderCounterTab: (p: Pokemon) => React.ReactNode,
  renderOverlayTab: (p: Pokemon) => React.ReactNode,
  handleDetectorConfigChange: (id: string, cfg: DetectorConfig | null) => void,
  detectorStatus: Record<string, { state?: string; confidence?: number }>,
  onStopHunt?: (pokemonId: string) => void,
  isActiveRoute = true,
): React.ReactNode {
  if (tab === "counter") return renderCounterTab(pokemon);
  if (tab === "overlay") return renderOverlayTab(pokemon);
  if (tab === "detector") {
    return (
      <div className="w-full h-full">
        <DetectorPanel
          key={pokemon.id}
          pokemon={pokemon}
          onConfigChange={(cfg) => handleDetectorConfigChange(pokemon.id, cfg)}
          isRunning={!!pokemon.timer_started_at || detectorStatus[pokemon.id] !== undefined || isLoopRunning(pokemon.id)}
          confidence={detectorStatus[pokemon.id]?.confidence ?? 0}
          detectorState={detectorStatus[pokemon.id]?.state ?? "idle"}
          onStopHunt={() => onStopHunt?.(pokemon.id)}
        />
      </div>
    );
  }
  if (tab === "statistics") {
    // Dashboard stays mounted but display:none on other routes; an unmeasurable
    // recharts container there logs "width(0) height(0)". Drop the charts while
    // hidden, they remount at full size on return.
    if (!isActiveRoute) return null;
    return (
      <div className="w-full h-full">
        <StatisticsPanel pokemonId={pokemon.id} />
      </div>
    );
  }
  return null;
}

/** Marks all selected Pokemon as complete. */
function completePokemonBulk(
  selectedIds: Set<string>,
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>,
): void {
  for (const id of selectedIds) void fetch(apiUrl(`/api/pokemon/${id}/complete`), { method: "POST" }).catch(() => {});
  setSelectedIds(new Set());
}

/** Shows a bulk-delete confirmation dialog for the selected Pokemon. */
function requestBulkDelete(
  selectedIds: Set<string>,
  t: (key: string) => string,
  setConfirmConfig: React.Dispatch<React.SetStateAction<{
    isOpen: boolean; title: string; message: string; isDestructive: boolean; onConfirm: () => void;
  }>>,
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>,
): void {
  if (selectedIds.size === 0) return;
  setConfirmConfig({
    isOpen: true,
    title: t("confirm.deleteTitle"),
    message: `${selectedIds.size} ${t("dash.pokemonSelected")} — ${t("confirm.deleteMsg")}`,
    isDestructive: true,
    onConfirm: () => {
      for (const id of selectedIds) void fetch(apiUrl(`/api/pokemon/${id}`), { method: "DELETE" }).catch(() => {});
      setSelectedIds(new Set());
    },
  });
}

/** Registers sidebar keyboard navigation handlers on the global window. */
function useSidebarKeyboard(
  asideRef: React.RefObject<HTMLElement | null>,
  deps: Omit<SidebarKeyboardContext, "aside">,
) {
  useEffect(() => {
    const aside = asideRef.current;
    if (!aside) return;
    const ctx: SidebarKeyboardContext = { aside, ...deps };
    const handleKey = (e: KeyboardEvent) => handleSidebarKeyboard(e, ctx);
    globalThis.addEventListener("keydown", handleKey);
    return () => globalThis.removeEventListener("keydown", handleKey);
  }, [deps.displayList, deps.focusedIdx, deps.selectedIds, deps.searchQuery]);
}

/** Scrolls the focused sidebar item into view if a focused index is set. */
function scrollFocusedIntoView(focusedIdx: number | null, asideRef: React.RefObject<HTMLElement | null>): void {
  if (focusedIdx === null) return;
  asideRef.current?.querySelector(`[data-sidebar-idx="${focusedIdx}"]`)?.scrollIntoView({ block: "nearest" });
}

/** Finds the currently viewed Pokemon from the list by viewedId or fallback activeId. */
function findViewedPokemon(allPokemon: Pokemon[], viewedId: string | null): Pokemon | null {
  if (!viewedId) return null;
  return allPokemon.find((p) => p.id === viewedId) ?? null;
}

/** Saves a detector configuration for a Pokemon via the API. */
async function saveDetectorConfig(pokemonId: string, cfg: DetectorConfig | null): Promise<void> {
  await fetch(apiUrl(`/api/detector/${pokemonId}/config`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cfg ?? {}),
  });
}

/** Syncs the overlay editor state when the viewed Pokemon or active ID changes. */
function syncOverlayState(
  appState: AppState | null,
  viewedPokemonId: string | null,
  setCurrentOverlay: (o: OverlaySettings) => void,
  setOverlayDirty: (dirty: boolean) => void,
): void {
  const overlay = resolveCurrentOverlay(appState, viewedPokemonId);
  if (overlay) {
    setCurrentOverlay(overlay);
    setOverlayDirty(false);
  }
}

/** Processes a WebSocket message and shows a reset confirmation dialog if appropriate. */
function handleResetConfirmMessage(
  msg: { type: string; payload: unknown },
  pokemon: Pokemon[] | undefined,
  t: (key: string) => string,
  send: (type: string, payload: unknown) => void,
  setConfirmConfig: React.Dispatch<React.SetStateAction<{
    isOpen: boolean; title: string; message: string; isDestructive: boolean; onConfirm: () => void;
  }>>,
): void {
  const config = buildResetConfirmConfig(
    msg, pokemon ?? [], t,
    (pokemonId) => send("reset", { pokemon_id: pokemonId }),
    (groupId) => send("reset_group", { group_id: groupId }),
  );
  if (config) {
    globalThis.electronAPI?.focusWindow();
    setConfirmConfig(config);
  }
}

/** Switches overlay mode for a given Pokemon, delegating to applyOverlayMode. */
async function changePokemonOverlayMode(
  newMode: "default" | "custom",
  pokemon: Pokemon | null,
  appState: AppState,
  t: (key: string) => string,
  updateOverlay: (id: string, mode: OverlayMode, overlay: OverlaySettings | null) => Promise<void>,
  setOverlay: (o: OverlaySettings) => void,
): Promise<void> {
  if (!pokemon) return;
  await applyOverlayMode(newMode, pokemon, appState, t, updateOverlay, setOverlay);
}

/** Saves the current custom overlay if both overlay and Pokemon are available. */
async function saveOverlayIfReady(
  overlay: OverlaySettings | null,
  pokemon: Pokemon | null,
  updateOverlay: (id: string, mode: OverlayMode, overlay: OverlaySettings | null) => Promise<void>,
): Promise<void> {
  if (!overlay || !pokemon) return;
  await updateOverlay(pokemon.id, "custom", overlay);
}

/** Copies overlay settings from a source Pokemon or global defaults. */
function applyCopyOverlay(
  sourceId: string,
  appState: AppState,
  setOverlay: (o: OverlaySettings) => void,
  setDirty: (dirty: boolean) => void,
): void {
  const overlay = resolveCopySource(sourceId, appState.pokemon, appState.settings.overlay);
  if (overlay) setOverlay(overlay);
  setDirty(true);
}

/** Sidebar quick actions bar: start/stop hunts, mode selector, selection actions, and the total encounter count. */
function SidebarQuickActions({
  allPokemon, activeHunts, selectedIds, sidebarTab, detectorStatus,
  showHuntMenu, setShowHuntMenu, send, capture,
  setDetectorStatus, clearDetectorStatus, bulkComplete, bulkDelete, setSelectedIds,
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
  capture: { isCapturing: (id: string) => boolean; getVideoElement: (id: string) => HTMLVideoElement | null };
  setDetectorStatus: (id: string, status: { state: string; confidence: number; poll_ms: number }) => void;
  clearDetectorStatus: (id: string) => void;
  bulkComplete: () => void;
  bulkDelete: () => void;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  viewedPokemonId: string | null;
}>) {
  const { t } = useI18n();
  const activeId = useCounterStore(s => s.appState?.active_id);
  const viewedId = viewedPokemonId || activeId;
  const viewedPokemon = viewedId ? allPokemon.find(p => p.id === viewedId) ?? null : null;
  // selected = explicitly multi-selected pokemon, or the currently viewed pokemon
  const selected = selectedIds.size > 0
    ? allPokemon.filter(p => selectedIds.has(p.id))
    : viewedPokemon ? [viewedPokemon] : [];
  const hasSelection = selected.length > 0;
  // Global running indicators (shown in the bar regardless of selection)
  const hasRunningTimer = activeHunts.some(p => !!p.timer_started_at);
  const hasRunningDetector = activeHunts.some(p => !!detectorStatus[p.id] || isLoopRunning(p.id));
  // Selection-scoped state for the start/stop button
  const withDetector = selected.filter(p => hasDetectorReady(p));
  const hasDetector = withDetector.length > 0;
  const isRunning = (p: Pokemon) => !!p.timer_started_at || !!detectorStatus[p.id] || isLoopRunning(p.id);
  const allRunning = hasSelection && selected.every(isRunning);
  const someRunning = hasSelection && selected.some(isRunning);
  const canStart = hasSelection && selected.filter(p => !isRunning(p)).every(p => canPokemonStart(p, capture.isCapturing));

  const currentMode = resolveHuntMode(selected);

  /** Start each selected pokemon according to its own hunt_mode. */
  const startAll = () => {
    for (const p of selected) {
      if (isRunning(p)) continue; // Skip already-running pokemon
      const mode = p.hunt_mode || "both";
      if (mode !== "detector" && !p.timer_started_at && !isTimerStartBlocked(p, capture.isCapturing)) send("timer_start", { pokemon_id: p.id });
      if (canStartDetector(p, detectorStatus, capture)) {
        tryStartDetection(p, capture, setDetectorStatus);
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
          onClick={() => { if (allRunning) stopAll(); else startAll(); }}
          className={`p-1.5 rounded-none transition-colors ${huntButtonClass(allRunning, canStart, currentMode)}`}
          title={sidebarLabel}
        >
          {sidebarIcon}
        </button>
        <button
          onClick={() => setShowHuntMenu((v: boolean) => !v)}
          className="p-1.5 text-text-muted hover:text-text-primary transition-colors"
          title={sidebarLabel}
        >
          <ChevronDown className="w-3 h-3" />
        </button>
        {showHuntMenu && (
          <>
            <button className="fixed inset-0 z-40 cursor-default" onClick={() => setShowHuntMenu(false)} aria-label="Close" />
            <div className="absolute left-0 top-full mt-1 z-50 bg-bg-secondary border border-border-subtle rounded-none shadow-lg py-1 min-w-40">
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
                {currentMode === "detector" && <Check className="ml-auto w-3 h-3 text-accent-green" />}
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
          <span className="text-[10px] text-accent-blue font-semibold tabular-nums">{selectedIds.size}</span>
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
      <span
        className="t-label gap-1 shrink-0 tabular-nums"
        title={totalEncountersLabel}
      >
        <BarChart3 className="w-3 h-3 text-accent-blue" aria-hidden="true" />
        {totalEncounters}
        <span className="sr-only">{totalEncountersLabel}</span>
      </span>
    </div>
  );
}

/** Resolves the common hunt mode across a selection of Pokemon. */
function resolveHuntMode(pokemon: Pokemon[]): "both" | "timer" | "detector" {
  const modes = pokemon.map(p => p.hunt_mode || "both");
  if (modes.every(m => m === "timer")) return "timer";
  if (modes.every(m => m === "detector")) return "detector";
  return "both";
}

/** Resolves the hunt button label based on running state and mode. */
function resolveHuntLabel(anyRunning: boolean, mode: string, t: (key: string) => string): string {
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
function resolveHuntIcon(anyRunning: boolean, mode: string): React.ReactNode {
  if (mode === "timer") return <Timer className="w-3.5 h-3.5" />;
  if (mode === "detector") return <Eye className="w-3.5 h-3.5" />;
  return anyRunning ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />;
}

/** Resolves the hunt button background color based on running state and mode. */
function resolveHuntBgColor(anyRunning: boolean, mode: string): string {
  if (anyRunning) return "bg-accent-red/15";
  if (mode === "detector") return "bg-accent-purple";
  if (mode === "timer") return "bg-accent-green";
  return "bg-accent-blue";
}

/** Header hunt start/stop split button with mode dropdown. */
function HeaderHuntButton({
  pokemon, detectorStatus, showMenu, setShowMenu, send, capture,
  setDetectorStatus, clearDetectorStatus,
}: Readonly<{
  pokemon: Pokemon;
  detectorStatus: Record<string, { state?: string; confidence?: number }>;
  showMenu: boolean;
  setShowMenu: (v: boolean | ((prev: boolean) => boolean)) => void;
  send: (type: string, payload: unknown) => void;
  capture: { isCapturing: (id: string) => boolean; getVideoElement: (id: string) => HTMLVideoElement | null };
  setDetectorStatus: (id: string, status: { state: string; confidence: number; poll_ms: number }) => void;
  clearDetectorStatus: (id: string) => void;
}>) {
  const { t } = useI18n();
  const { push: pushToast } = useToast();
  const timerRunning = !!pokemon.timer_started_at;
  const detRunning = !!detectorStatus[pokemon.id] || isLoopRunning(pokemon.id);
  const detReady = hasDetectorReady(pokemon);
  const huntMode = pokemon.hunt_mode || "both";
  const anyRunning = timerRunning || detRunning;
  const huntBlocked = !anyRunning && !canPokemonStart(pokemon, capture.isCapturing);

  const buttonLabel = resolveHuntLabel(anyRunning, huntMode, t);
  const modeIcon = resolveHuntIcon(anyRunning, huntMode);
  const bgColor = huntBlocked ? "bg-bg-card border border-border-subtle" : resolveHuntBgColor(anyRunning, huntMode);

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

    if (huntMode !== "detector" && !pokemon.timer_started_at) send("timer_start", { pokemon_id: pokemon.id });
    if (canStartDetector(pokemon, detectorStatus, capture)) {
      tryStartDetection(pokemon, capture, setDetectorStatus);
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
          className={`flex items-center gap-1.5 pl-3 pr-2 py-1.5 text-xs font-bold transition-colors ${
            huntBlocked ? "opacity-50 cursor-not-allowed text-text-muted" : anyRunning ? "text-accent-red hover:bg-accent-red/20" : "hover:bg-white/10"
          }`}
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
        >
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>
      {showMenu && (
        <>
          <button className="fixed inset-0 z-40 cursor-default" onClick={() => setShowMenu(false)} aria-label={t("aria.close")} />
          <div className="absolute right-0 top-full mt-1 z-50 bg-bg-secondary border border-border-subtle rounded-none shadow-lg py-1 min-w-40">
            {[
              { mode: "both" as const, icon: <><Timer className="w-3.5 h-3.5" /><Eye className="w-3.5 h-3.5 -ml-1" /></>, label: t("sidebar.both") },
              { mode: "timer" as const, icon: <Timer className="w-3.5 h-3.5" />, label: t("sidebar.timerOnly") },
              { mode: "detector" as const, icon: <Eye className="w-3.5 h-3.5" />, label: t("sidebar.detectorOnly"), disabled: !detReady && !detRunning },
            ].map(({ mode, icon, label, disabled }) => (
              <button
                key={mode}
                onClick={() => { updateHuntMode(pokemon, mode); setShowMenu(false); }}
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

/**
 * Overflow menu (kebab) in the hunt header bundling the secondary actions
 * Edit, Delete, and (for archived hunts) Reactivate. Uses the same
 * fixed-backdrop dropdown pattern as the sidebar sort menu; Escape closes
 * the menu and focus always returns to the kebab trigger.
 */
function HeaderOverflowMenu({
  pokemon, onEdit, onDelete, onReactivate,
}: Readonly<{
  pokemon: Pokemon;
  onEdit: () => void;
  onDelete: () => void;
  onReactivate: () => void;
}>) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  /** Closes the menu and restores focus to the kebab trigger (WCAG 2.4.3). */
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  /** Closes the menu, then runs the chosen action. */
  const runAction = (action: () => void) => {
    close();
    action();
  };

  return (
    <div
      className="relative shrink-0"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={triggerRef}
        onClick={() => (open ? close() : setOpen(true))}
        className="flex items-center justify-center min-w-8 min-h-8 rounded-none bg-bg-primary border border-border-subtle hover:border-accent-blue/40 text-text-muted hover:text-text-primary transition-colors"
        title={t("dash.moreActions")}
        aria-label={t("dash.moreActions")}
        aria-expanded={open}
      >
        <MoreVertical className="w-3.5 h-3.5" />
      </button>
      {open && (
        <>
          <button className="fixed inset-0 z-40 cursor-default" onClick={close} aria-label={t("aria.close")} />
          <div className="absolute right-0 top-full mt-1 z-50 bg-bg-secondary border border-border-subtle rounded-none shadow-lg py-1 min-w-40">
            <button
              onClick={() => runAction(onEdit)}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-text-secondary hover:bg-bg-primary transition-colors"
              aria-label={t("dash.edit")}
            >
              <Edit2 className="w-3.5 h-3.5" />
              {t("dash.edit")}
            </button>
            {pokemon.completed_at && (
              <button
                onClick={() => runAction(onReactivate)}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-text-secondary hover:bg-bg-primary transition-colors"
                aria-label={t("dash.reactivate")}
              >
                <Undo2 className="w-3.5 h-3.5" />
                {t("dash.reactivate")}
              </button>
            )}
            <button
              onClick={() => runAction(onDelete)}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-accent-red hover:bg-bg-primary transition-colors"
              aria-label={t("dash.delete")}
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t("dash.delete")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Collapsed sidebar sprite-only button for a single Pokemon. */
function CollapsedSidebarItem({
  pokemon, isViewed, detectorStatus, imgError, onActivate, onImgError, t,
}: Readonly<{
  pokemon: Pokemon;
  isViewed: boolean;
  detectorStatus: Record<string, { state?: string; confidence?: number }>;
  imgError: Record<string, string>;
  onActivate: (id: string) => void;
  onImgError: (id: string, src: string) => void;
  t: (key: string) => string;
}>) {
  const src = resolveSpriteUrl(pokemon.id, pokemon.sprite_url, imgError);
  const showDot = hasDetectorReady(pokemon);
  return (
    <button
      onClick={() => onActivate(pokemon.id)}
      className={`w-full p-1.5 flex items-center justify-center transition-colors ${
        isViewed ? "bg-accent-blue/15" : "hover:bg-bg-hover"
      }`}
      title={`${pokemon.name} (${pokemon.encounters.toLocaleString()})`}
    >
      <div className="relative w-7 h-7">
        <img
          src={src}
          alt={pokemon.name}
          className="pokemon-sprite w-full h-full object-contain"
          onError={() => onImgError(pokemon.id, resolveSpriteSrc(pokemon.sprite_url))}
        />
        {showDot && (() => {
          const { dotClass, title } = resolveDetectorDot(detectorStatus, pokemon.id, t);
          return (
            <span
              className={`absolute -top-0.5 -left-0.5 w-2 h-2 rounded-full border border-bg-secondary ${dotClass}`}
              title={title}
            />
          );
        })()}
      </div>
    </button>
  );
}

/** Resolves the step label for encounter buttons (+N / -N). */
function stepLabel(pokemon: Pokemon): string {
  return pokemon.step && pokemon.step > 1 ? String(pokemon.step) : "1";
}

/** Counter tab content: one cohesive hero panel with status, identity, big number, chips, and actions. */
function DashboardCounterTab({
  pokemon, imgError, oddsDisplay, send,
  onImgError, onDecrement, onIncrement, onReset, onSetEncounter, timerStartBlocked = false,
}: Readonly<{
  pokemon: Pokemon;
  imgError: Record<string, string>;
  oddsDisplay: string;
  send: (type: string, payload: unknown) => void;
  onImgError: (id: string, src: string) => void;
  onDecrement: (id: string) => void;
  onIncrement: (id: string) => void;
  onReset: (id: string) => void;
  onSetEncounter: (p: Pokemon) => void;
  timerStartBlocked?: boolean;
}>) {
  const { t } = useI18n();
  const spriteUrl = resolveSpriteUrl(pokemon.id, pokemon.sprite_url, imgError);
  const step = stepLabel(pokemon);
  const hasCustomStep = pokemon.step && pokemon.step > 1;
  const isCompleted = !!pokemon.completed_at;
  const [baseName, formName] = getBaseAndFormName(pokemon);
  // Secondary identity line: form and game, dot-separated, both optional.
  const metaLine = [formName, pokemon.game ? formatGame(pokemon.game) : ""].filter(Boolean).join(" \u00b7 ");

  return (
    <>
      {isCompleted && (
        <div className="flex items-center gap-2.5 px-6 py-2 rounded-none bg-accent-green/10 text-accent-green text-sm mb-2 border border-accent-green/30 shadow-sm mt-8">
          <Trophy className="w-4 h-4" />
          <span className="font-bold">{t("dash.caughtBanner")}</span>
          <span className="w-px h-3 bg-accent-green/30" />
          <span className="text-accent-green/80 text-xs font-medium">
            {new Date(pokemon.completed_at!).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" })}
          </span>
        </div>
      )}

      {/* Hero identity: large full sprite (never the box-trimmed variant)
          and name, stacked above the panel instead of inside it. */}
      <div
        className="flex flex-col items-center gap-1 mt-8"
        style={{ width: "min(100%, clamp(420px, 40vw, 620px))" }}
      >
        <img
          src={spriteUrl}
          alt={pokemon.name}
          onError={() => onImgError(pokemon.id, resolveSpriteSrc(pokemon.sprite_url))}
          className="pokemon-sprite object-contain transition-transform duration-300 hover:scale-110"
          style={{ width: "clamp(160px, 17vw, 216px)", height: "clamp(160px, 17vw, 216px)" }}
        />
        <span className="text-[clamp(32px,3.4vw,46px)] font-extrabold text-text-primary capitalize leading-tight text-center">
          {baseName}
        </span>
        {metaLine && <span className="text-sm text-text-muted capitalize truncate">{metaLine}</span>}
      </div>

      <section
        className="t-panel t-hatch p-5 md:p-6 mt-4"
        style={{ width: "min(100%, clamp(420px, 40vw, 620px))" }}
      >
        {/* Header row: hunt status label left, timer controls right */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          {isCompleted ? (
            <span className="t-label">{t("dash.tabArchive")}</span>
          ) : (
            <span
              className={`t-label t-label--accent ${pokemon.is_active ? "" : "invisible"}`}
              title={pokemon.is_active ? t("dash.tooltipSetActive") : undefined}
              aria-hidden={!pokemon.is_active}
            >
              {t("dash.hotkeyBadge")}
            </span>
          )}
          <PokemonTimer pokemon={pokemon} send={send} disabled={isCompleted} timerStartBlocked={timerStartBlocked} />
        </div>

        {/* Big number. Raw integer on purpose: no thousands separator, fluid clamp size. */}
        <div className="relative text-center my-3" aria-live="polite">
          <div
            className="font-black tabular-nums leading-none tracking-tight text-text-primary break-all"
            style={{ fontSize: heroCounterFontSize(pokemon.encounters) }}
          >
            {pokemon.encounters}
          </div>
          {!isCompleted && (
            <button
              onClick={() => onSetEncounter(pokemon)}
              className="absolute top-0 right-0 p-1.5 rounded-none hover:bg-bg-hover text-text-faint hover:text-text-primary transition-colors"
              title={t("dash.setEncounters")}
              aria-label={t("dash.setEncounters")}
            >
              <Pencil className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Chips row: odds micro label */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="t-label t-label--accent gap-1" title={t("aria.odds")}>
            {t("dash.odds") || "Odds"}
            <span className="tabular-nums">{oddsDisplay}</span>
          </span>
        </div>

        {/* Action row: minus (secondary), plus (primary accent), reset (ghost) */}
        <div className="flex items-center justify-center gap-2 mt-5">
          <button
            onClick={() => !isCompleted && onDecrement(pokemon.id)}
            disabled={isCompleted}
            aria-label={`\u2212${step}`}
            className="flex items-center justify-center h-11 w-11 rounded-none bg-bg-card border border-border-subtle text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={`\u2212${step}`}
          >
            {hasCustomStep ? (
              <span className="text-base font-bold">&minus;{pokemon.step}</span>
            ) : (
              <Minus className="w-5 h-5" />
            )}
          </button>
          <button
            onClick={() => !isCompleted && onIncrement(pokemon.id)}
            disabled={isCompleted}
            aria-label={`+${step}`}
            className="t-cut flex items-center justify-center h-11 min-w-32 px-8 rounded-none bg-accent-blue text-bg-primary font-bold hover:bg-accent-blue/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={`+${step}`}
          >
            {hasCustomStep ? (
              <span className="text-lg font-bold">+{pokemon.step}</span>
            ) : (
              <Plus className="w-6 h-6 stroke-[2.5px]" />
            )}
          </button>
          {!isCompleted && (
            <button
              onClick={() => onReset(pokemon.id)}
              className="flex items-center justify-center h-11 w-11 rounded-none text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors"
              title={t("tooltip.common.reset")}
              aria-label={t("tooltip.common.reset")}
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
        </div>
      </section>
    </>
  );
}

/** Renders a single import-overlay-from-pokemon button in the import dropdown. */
function OverlayImportItem({ pokemon, onCopy }: Readonly<{ pokemon: Pokemon; onCopy: (id: string) => void }>) {
  const icon = pokemon.sprite_url
    ? <img src={pokemon.sprite_url} alt="" className="w-4 h-4 object-contain" />
    : <div className="w-4 h-4 rounded-none bg-bg-hover" />;
  return (
    <button
      onClick={() => onCopy(pokemon.id)}
      className="w-full text-left px-3 py-2 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors flex items-center gap-2"
    >
      {icon}
      {pokemon.name}
    </button>
  );
}

/** Card-style OBS URL copy button for the global overlay placeholder. */
function ObsUrlCardButton({ pokemonId }: Readonly<{ pokemonId: string }>) {
  const { t } = useI18n();
  const { push, dismissByKey } = useToast();
  const [copied, setCopied] = useState(false);
  const baseUrl = apiUrl("") || globalThis.location.origin;
  const url = `${baseUrl}/overlay/${pokemonId}`;

  const copy = () => {
    navigator.clipboard.writeText(url).then(() => {
      dismissByKey("clipboard-copy");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => push({ type: "error", title: t("overlay.errCopyFailed"), key: "clipboard-copy" }));
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={url}
      aria-label={t("aria.copyObsUrl")}
      className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-none bg-bg-card border border-border-subtle hover:border-accent-blue/40 hover:bg-accent-blue/5 text-text-secondary hover:text-accent-blue transition-colors"
    >
      {copied ? <Check className="w-4 h-4 text-accent-green" /> : <Monitor className="w-4 h-4" />}
      <span className="text-[10px] font-medium">{copied ? t("overlay.urlCopied") : t("overlay.obsUrl")}</span>
    </button>
  );
}

/** Overlay tab content, extracted to reduce Dashboard cognitive complexity. */
function DashboardOverlayTab({
  pokemon, overlaySaving, overlaySaved, overlayDirty, currentOverlay,
  allPokemon, onModeChange, onSave, onCopyFrom, onOverlayUpdate,
}: Readonly<{
  pokemon: Pokemon;
  overlaySaving: boolean;
  overlaySaved: boolean;
  overlayDirty: boolean;
  currentOverlay: OverlaySettings | null;
  allPokemon: Pokemon[];
  onModeChange: (mode: "default" | "custom") => void;
  onSave: () => void;
  onCopyFrom: (sourceId: string) => void;
  onOverlayUpdate: (overlay: OverlaySettings) => void;
}>) {
  const { t } = useI18n();
  const overlayMode = pokemon.overlay_mode || "default";
  const modeBase = overlayMode === "custom" ? "custom" : "default";

  const saveIcon = overlaySaving
    ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
    : <Save className="w-3.5 h-3.5" />;

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Control bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-bg-card border-b border-border-subtle shrink-0">
        <OverlayBrowserSourceButton pokemonId={pokemon.id} />

        {modeBase === "custom" && overlaySaved && (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-none text-[10px] font-medium bg-accent-green/10 text-accent-green border border-accent-green/20 shrink-0">
            <Save className="w-3 h-3" />
            {t("overlay.saved")}
          </span>
        )}

        <div className="flex-1" />

        <button
          onClick={() => onModeChange("default")}
          title={t("dash.tooltipOverlayGlobal")}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-none text-xs font-semibold transition-colors shrink-0 ${
            modeBase === "default"
              ? "bg-accent-blue/15 text-accent-blue"
              : "text-text-muted hover:text-text-primary hover:bg-bg-hover"
          }`}
        >
          <Globe className="w-3.5 h-3.5" />
          {t("overlay.global")}
        </button>
        <button
          onClick={() => onModeChange("custom")}
          title={t("dash.tooltipOverlayCustom")}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-none text-xs font-semibold transition-colors shrink-0 ${
            modeBase === "custom"
              ? "bg-accent-purple/15 text-accent-purple"
              : "text-text-muted hover:text-text-primary hover:bg-bg-hover"
          }`}
        >
          <Pencil className="w-3.5 h-3.5" />
          {t("overlay.modeCustom")}
        </button>

        {modeBase === "custom" && (
          <div className="relative group shrink-0">
            <button className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-none text-xs font-semibold bg-bg-primary border border-border-subtle text-text-muted hover:text-text-primary hover:border-accent-blue/30 transition-colors">
              <Download className="w-3.5 h-3.5" />
              {t("overlay.import")}
              <ChevronDown className="w-3 h-3" />
            </button>
            <div className="absolute right-0 top-full mt-1 w-52 bg-bg-secondary border border-border-subtle rounded-none shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 py-1 max-h-60 overflow-y-auto">
              <button
                onClick={() => onCopyFrom("global")}
                className="w-full text-left px-3 py-1.5 text-[11px] text-text-secondary hover:bg-bg-primary transition-colors flex items-center gap-2"
              >
                <Globe className="w-3.5 h-3.5 text-text-muted" />
                {t("overlay.globalLayout")}
              </button>
              {allPokemon
                .filter((p) => p.id !== pokemon.id && p.overlay)
                .map((p) => <OverlayImportItem key={p.id} pokemon={p} onCopy={onCopyFrom} />)}
            </div>
          </div>
        )}

        {modeBase === "custom" && (
          <button
            onClick={onSave}
            disabled={!overlayDirty || overlaySaving}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-none bg-accent-blue hover:bg-accent-blue/90 text-white font-semibold text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            {saveIcon}
            {t("overlay.save")}
          </button>
        )}
      </div>

      {modeBase === "default" && currentOverlay && (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center">
          <div className="text-center space-y-4 max-w-sm">
            <Globe className="w-10 h-10 text-text-muted mx-auto" />
            <p className="text-sm text-text-secondary">
              {t("overlay.usesGlobalDesc")}
            </p>
            <p className="text-xs text-text-muted leading-relaxed">
              {t("overlay.globalChangeNote")}
            </p>
            <div className="grid grid-cols-3 gap-2 pt-2">
              <Link
                to="/overlay-editor"
                className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-none bg-bg-card border border-border-subtle hover:border-accent-blue/40 hover:bg-accent-blue/5 text-text-secondary hover:text-accent-blue transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                <span className="text-[10px] font-medium">{t("overlay.editGlobal")}</span>
              </Link>
              <button
                type="button"
                onClick={() => onModeChange("custom")}
                className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-none bg-bg-card border border-border-subtle hover:border-accent-purple/40 hover:bg-accent-purple/5 text-text-secondary hover:text-accent-purple transition-colors"
              >
                <Pencil className="w-4 h-4" />
                <span className="text-[10px] font-medium">{t("overlay.switchToCustom")}</span>
              </button>
              <ObsUrlCardButton pokemonId={pokemon.id} />
            </div>
          </div>
        </div>
      )}

      {modeBase === "custom" && currentOverlay && (
        <div className="flex-1 min-h-0">
          <OverlayEditor
            settings={currentOverlay}
            activePokemon={pokemon || undefined}
            overlayTargetId={pokemon.id}
            onUpdate={onOverlayUpdate}
            compact
          />
        </div>
      )}
    </div>
  );
}

/** Hook that returns a callback to update a Pokemon's overlay_mode and settings via the API. */
function useOverlayUpdate(
  appState: AppState,
  setOverlayDirty: (dirty: boolean) => void,
  setOverlaySaved: (saved: boolean) => void,
  setOverlaySaving: (saving: boolean) => void,
) {
  const { push: pushToast, dismissByKey } = useToast();
  const { t } = useI18n();
  return async (pokemonId: string, mode: OverlayMode, overlay: OverlaySettings | null) => {
    const p = appState.pokemon.find((x) => x.id === pokemonId);
    if (!p) return;
    setOverlaySaving(true);
    try {
      const payload = {
        name: p.name,
        title: p.title,
        canonical_name: p.canonical_name,
        sprite_url: p.sprite_url,
        sprite_type: p.sprite_type,
        sprite_style: p.sprite_style,
        language: p.language,
        game: p.game,
        hunt_mode: p.hunt_mode,
        step: p.step,
        overlay_mode: mode,
        overlay,
      };
      const res = await fetch(apiUrl(`/api/pokemon/${p.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("overlay save failed");
      dismissByKey("overlay-save");
      setOverlayDirty(false);
      setOverlaySaved(true);
      setTimeout(() => setOverlaySaved(false), 2000);
    } catch (err) {
      console.error(err);
      pushToast({ type: "error", title: t("overlay.errSaveFailed"), key: "overlay-save" });
    }
    setOverlaySaving(false);
  };
}

/** Loading spinner shown while the WebSocket connection is pending. */
function DashboardLoader({ label }: Readonly<{ label: string }>) {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <div className="w-12 h-12 border-2 border-accent-blue border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-text-muted">{label}</p>
      </div>
    </div>
  );
}

interface DashboardProps {
  /**
   * Whether the Dashboard is the currently active route. Dashboard stays
   * mounted (hidden via CSS) when navigating to other pages, so this gates
   * `id="main-content"` to avoid a duplicate id colliding with the other
   * pages' own `<main id="main-content">` and breaking the skip-link.
   */
  readonly isActiveRoute?: boolean;
}

export function Dashboard({ isActiveRoute = true }: Readonly<DashboardProps> = {}) {
  // Narrow selectors: avoid re-rendering on isConnected / flashingIds /
  // lastEncounterPokemonId changes, which the Dashboard does not read. The
  // detectorStatus map is genuinely consumed here (passed to sidebar/cards).
  const appState = useCounterStore((s) => s.appState);
  const flashPokemon = useCounterStore((s) => s.flashPokemon);
  const detectorStatus = useCounterStore((s) => s.detectorStatus);
  const setDetectorStatus = useCounterStore((s) => s.setDetectorStatus);
  const clearDetectorStatus = useCounterStore((s) => s.clearDetectorStatus);
  const { t } = useI18n();
  const capture = useCaptureService();
  useCaptureVersion(); // Re-render when capture sources connect/disconnect
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingPokemon, setEditingPokemon] = useState<Pokemon | null>(null);
  const [imgError, setImgError] = useState<Record<string, string>>({});

  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("active");
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastSelectedIdx = useRef<number | null>(null);
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>(loadSortMode);
  const [sortDir, setSortDir] = useState<SortDir>(loadSortDir);
  // Id of the item currently being dragged / hovered for drag-and-drop reorder.
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  // Whether the drop slot is below (after) the hovered item rather than above.
  // Lets the user drop into the last position by hovering an item's lower half.
  const [dropAfter, setDropAfter] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("encounty-sidebar-collapsed") === "true");
  const [showHuntMenu, setShowHuntMenu] = useState(false);
  const [showHeaderHuntMenu, setShowHeaderHuntMenu] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [activeTagFilters, setActiveTagFilters] = useState<string[]>([]);
  // Funnel toggle: shows the tag filter bar even when no tag filter is active yet.
  const [showTagFilterBar, setShowTagFilterBar] = useState(false);
  const [ungroupedCollapsed, setUngroupedCollapsed] = useState(false);
  const asideRef = useRef<HTMLElement>(null);

  const [viewedPokemonId, setViewedPokemonId] = useState<string | null>(null);
  // Which group is shown in the main panel (mutually exclusive with
  // viewedPokemonId). The view is purely local and independent of the hotkey
  // target (active_id / active_group_id): setting a hotkey target never changes
  // what is shown, and showing something never changes the hotkey target.
  const [viewedGroupId, setViewedGroupId] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<PanelTab>("counter");
  const rightPanelTab = panelTab;
  const [pendingTab, setPendingTab] = useState<PanelTab | null>(null);
  const unsavedDialogRef = useModalA11y<HTMLDivElement>({
    isOpen: !!pendingTab,
    onClose: () => setPendingTab(null),
  });

  // Seed the viewed Pokémon once from the backend's active_id so the panel is
  // not empty on first load. After this the view is driven only by local
  // selection (sidebar click / "show group"), decoupled from the hotkey target.
  const didInitView = useRef(false);
  useEffect(() => {
    if (didInitView.current || !appState) return;
    didInitView.current = true;
    if (appState.active_id) setViewedPokemonId(appState.active_id);
  }, [appState]);

  /** Guarded tab switch — shows confirmation when overlay has unsaved changes. */
  const setRightPanelTab = (tab: PanelTab) => {
    if (tab === rightPanelTab) return;
    if (overlayDirty && rightPanelTab === "overlay") {
      setPendingTab(tab);
      return;
    }
    setPanelTab(tab);
  };

  const [setEncounterPokemon, setSetEncounterPokemon] = useState<Pokemon | null>(null);

  const [currentOverlay, setCurrentOverlay] = useState<OverlaySettings | null>(null);
  const [overlayDirty, setOverlayDirty] = useState(false);
  const [overlaySaving, setOverlaySaving] = useState(false);
  const [overlaySaved, setOverlaySaved] = useState(false);

  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    isDestructive: boolean;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: "",
    message: "",
    isDestructive: false,
    onConfirm: () => {},
  });

  const { send } = useWebSocket((msg) =>
    handleResetConfirmMessage(msg, appState?.pokemon, t, send, setConfirmConfig),
  );

  useFocusShortcut(searchRef);

  // Sync overlay editor state when the viewed Pokemon changes
  useEffect(
    () => syncOverlayState(appState, viewedPokemonId, setCurrentOverlay, setOverlayDirty),
    [viewedPokemonId, appState?.active_id],
  );

  useHotkeyPause(rightPanelTab);

  useForceCounterOnArchive(appState, viewedPokemonId, rightPanelTab, setRightPanelTab);

  // --- Event Handlers ---

  const handleIncrement = (id: string) => {
    send("increment", { pokemon_id: id });
    flashPokemon(id);
  };
  const handleDecrement = (id: string) => send("decrement", { pokemon_id: id });
  const handleReset = (id: string) => {
    setConfirmConfig({
      isOpen: true,
      title: t("confirm.resetTitle"),
      message: t("confirm.resetMsg"),
      isDestructive: true,
      onConfirm: () => send("reset", { pokemon_id: id }),
    });
  };
  const handleActivate = (id: string) => {
    // View-only: show the Pokémon in the main panel, or clear the view when it
    // is already shown so an empty selection stays reachable even while Pokémon
    // exist. This does NOT change the hotkey target (active_id) - that is
    // controlled solely by the keyboard icon. Showing a Pokémon clears any
    // group view.
    setViewedGroupId(null);
    setViewedPokemonId((cur) => (cur === id ? null : id));
    setRightPanelTab("counter");
  };
  const handleDelete = (id: string) => {
    setConfirmConfig({
      isOpen: true,
      title: t("confirm.deleteTitle"),
      message: t("confirm.deleteMsg"),
      isDestructive: true,
      onConfirm: () => {
        void fetch(apiUrl(`/api/pokemon/${id}`), { method: "DELETE" });
      },
    });
  };
  const handleComplete = async (id: string) => {
    await fetch(apiUrl(`/api/pokemon/${id}/complete`), { method: "POST" });
  };
  const handleUncomplete = async (id: string) => {
    await fetch(apiUrl(`/api/pokemon/${id}/uncomplete`), { method: "POST" });
  };
  const handleAddPokemon = async (data: NewPokemonData) => {
    await fetch(apiUrl("/api/pokemon"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  };
  const handleSavePokemon = async (id: string, data: NewPokemonData) => {
    const p = appState!.pokemon.find((x) => x.id === id);
    const payload = { ...data, overlay: p?.overlay, overlay_mode: p?.overlay_mode, step: data.step };
    await fetch(apiUrl(`/api/pokemon/${id}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (data.encounters !== undefined && data.encounters !== p?.encounters) {
      await fetch(apiUrl(`/api/pokemon/${id}/set_encounters`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: data.encounters }),
      });
    }
    const newTimerMs = data.timer_accumulated_ms ?? 0;
    const oldTimerMs = p?.timer_accumulated_ms ?? 0;
    if (newTimerMs !== oldTimerMs) {
      await fetch(apiUrl(`/api/pokemon/${id}/timer/set`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ms: newTimerMs }),
      });
    }
  };

  const handleDetectorConfigChange = (pokemonId: string, cfg: DetectorConfig | null) =>
    saveDetectorConfig(pokemonId, cfg);

  // --- Overlay Handlers ---

  const updatePokemonOverlay = useOverlayUpdate(appState!, setOverlayDirty, setOverlaySaved, setOverlaySaving);

  const handleModeChange = (newMode: "default" | "custom") =>
    changePokemonOverlayMode(newMode, viewedPokemon, appState!, t, updatePokemonOverlay, setCurrentOverlay);

  const saveCurrentOverlay = () =>
    saveOverlayIfReady(currentOverlay, viewedPokemon, updatePokemonOverlay);

  const copyOverlayFrom = (sourceId: string) =>
    applyCopyOverlay(sourceId, appState!, setCurrentOverlay, setOverlayDirty);

  // --- Derived State (computed before hooks to avoid conditional hook calls) ---
  const allPokemon = appState?.pokemon ?? [];
  const groups: Group[] = appState?.groups ?? [];
  const activeHunts = allPokemon.filter((p) => !p.completed_at);
  const archivedHunts = allPokemon.filter((p) => !!p.completed_at);
  const q = searchQuery.trim().toLowerCase();
  // Tag filter applies only on the active tab; archived view stays flat.
  const tagFiltered = sidebarTab === "active" && activeTagFilters.length > 0
    ? activeHunts.filter((p) => {
        const pTags = p.tags ?? [];
        return activeTagFilters.every((t) => pTags.includes(t));
      })
    : (sidebarTab === "active" ? activeHunts : archivedHunts);
  const filtered = filterPokemonByQuery(tagFiltered, q);
  const displayList = sortPokemonList(filtered, sortMode, sortDir);

  // Flattened order exactly as the sidebar renders it (groups by their
  // sort_order, ungrouped last, items in displayList order within each group).
  // Reorder math must use this, not the flat displayList, or "first"/"last"
  // drops land at the wrong index because rendering re-groups the flat list.
  const visualList = (() => {
    const groupRank = new Map<string, number>();
    [...groups].sort((a, b) => a.sort_order - b.sort_order).forEach((g, i) => groupRank.set(g.id, i));
    const rankOf = (p: Pokemon) =>
      p.group_id && groupRank.has(p.group_id) ? (groupRank.get(p.group_id) as number) : Number.MAX_SAFE_INTEGER;
    return [...displayList].sort((a, b) => rankOf(a) - rankOf(b)); // stable: keeps within-group order
  })();

  // --- Drag-and-drop / keyboard reorder ---
  // Persists the given id sequence, optimistically switching to manual sort so
  // the new order is visible immediately. The backend broadcast reconciles.
  // ponytail: sends the order of the currently displayed list; Pokémon hidden
  // by a filter keep their existing sort_order and may interleave. Reorder is
  // meant to be used with no active filter.
  const persistReorder = (orderedIds: string[]) => {
    setSortMode("manual");
    void reorderPokemon(orderedIds).catch(() => {});
  };

  // Moves dragged item to the slot before (or after, for the last position) the
  // last-hovered target. Runs on dragEnd, which always fires on the source row,
  // rather than on drop: the dashed placeholder pushes the hovered row out from
  // under the cursor, so for the first/last slot the native drop lands on a
  // non-droppable area (sticky header or empty space) and onDrop never fires.
  // ponytail: releasing far outside the list still reorders to the last-hovered
  // slot; reorders are cheap to redo, so no extra dragleave bookkeeping.
  const handleDropReorder = () => {
    const targetId = dragOverId;
    const after = dropAfter;
    const sourceId = dragId;
    setDragOverId(null);
    setDropAfter(false);
    setDragId(null);
    if (!sourceId || !targetId || sourceId === targetId) return;
    const source = visualList.find((p) => p.id === sourceId);
    const target = visualList.find((p) => p.id === targetId);
    if (!source || !target) return;
    // Dropping onto a row in another group (or the ungrouped bucket) moves the
    // Pokémon into that group. Group reassignment and reorder touch disjoint
    // fields (group_id vs sort_order), so order of arrival does not matter.
    if ((source.group_id || "") !== (target.group_id || "")) {
      void setPokemonGroup(sourceId, target.group_id || "").catch(() => {});
    }
    const ids = visualList.map((p) => p.id);
    const from = ids.indexOf(sourceId);
    if (from === -1) return;
    ids.splice(from, 1); // remove source, then re-find target in the shrunk list
    const targetIdx = ids.indexOf(targetId);
    if (targetIdx === -1) return;
    ids.splice(after ? targetIdx + 1 : targetIdx, 0, sourceId);
    persistReorder(ids);
  };

  // Keyboard alternative: move a focused item up/down one slot (Alt+Arrow).
  const handleManualMove = (id: string, dir: -1 | 1) => {
    const ids = visualList.map((p) => p.id);
    const from = ids.indexOf(id);
    const to = from + dir;
    if (from === -1 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    persistReorder(ids);
  };

  // Sidebar item keydown: Alt+ArrowUp/Down reorders (keyboard alternative to
  // drag-and-drop, WCAG 2.2); otherwise the default activate handler applies.
  const handleSidebarKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      handleManualMove(id, e.key === "ArrowUp" ? -1 : 1);
      return;
    }
    handleActivateKeyDown(e, id, handleActivate);
  };

  // Pool of every tag currently present on any non-archived Pokémon, deduped and sorted.
  const availableTags = Array.from(
    new Set(activeHunts.flatMap((p) => p.tags ?? [])),
  ).sort((a, b) => a.localeCompare(b));
  const viewedPokemon = findViewedPokemon(allPokemon, viewedPokemonId);
  const oddsDisplay = getOddsFractional(viewedPokemon);

  // Persist sort + sidebar preferences
  useEffect(() => {
    localStorage.setItem("encounty-sort-mode", sortMode);
    localStorage.setItem("encounty-sort-dir", sortDir);
  }, [sortMode, sortDir]);

  useEffect(() => {
    localStorage.setItem("encounty-sidebar-collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  const bulkDelete = () =>
    requestBulkDelete(selectedIds, t, setConfirmConfig, setSelectedIds);

  const bulkComplete = () =>
    completePokemonBulk(selectedIds, setSelectedIds);

  // --- Sidebar keyboard navigation ---
  useSidebarKeyboard(asideRef, {
    displayList, focusedIdx, selectedIds, searchQuery,
    setFocusedIdx, setSelectedIds, setSearchQuery, bulkDelete,
  });

  // Scroll focused item into view
  useEffect(
    () => scrollFocusedIntoView(focusedIdx, asideRef),
    [focusedIdx],
  );

  if (!appState) return <DashboardLoader label={t("nav.connecting")} />;

  // Highlight the viewed Pokémon in the sidebar (local view, not the hotkey target).
  const effectiveViewedId = viewedPokemonId;
  const activeLanguages = appState.settings.languages ?? ["de", "en"];

  const cardSelectionCtx: CardSelectionContext = {
    displayList, selectedIds, lastSelectedIdx, setSelectedIds, handleActivate,
    viewedPokemonId: effectiveViewedId,
  };
  const handleCardClick = (e: React.MouseEvent, pokemonId: string, idx: number) =>
    applyCardSelection(e, pokemonId, idx, cardSelectionCtx);

  const handleClearAndAdd = () => {
    setSearchQuery("");
    setShowAddModal(true);
  };
  const handleOpenAdd = () => setShowAddModal(true);

  /** Renders the right main panel when no Pokemon is selected. */
  const renderNoPokemonPanel = () => {
    // The inline overview shortcut opens the ungrouped bucket, so only offer it
    // when ungrouped Pokémon actually exist. Scoped to the active/archived tab.
    const scopePool = sidebarTab === "active" ? activeHunts : archivedHunts;
    const hasUngrouped = scopePool.some((p) => !p.group_id);
    return (
    <div className="flex flex-col items-center justify-center h-full text-center relative z-10 w-full max-w-4xl mx-auto">
      <Sparkles className="w-8 h-8 text-text-faint mb-6" />
      <h2 className="text-2xl font-semibold text-text-primary mb-2">
        {t("dash.noActive")}
      </h2>
      <p className="text-text-muted text-sm max-w-xs">
        {t("dash.noActiveHint")}
      </p>
      {hasUngrouped && (
      <p className="flex items-center flex-wrap justify-center gap-x-1.5 gap-y-1 text-text-faint text-xs mt-6">
        {t("dash.overviewHintBefore")}
        <button
          type="button"
          onClick={() => { setViewedPokemonId(null); setViewedGroupId(UNGROUPED_VIEW_ID); }}
          title={t("group.viewOverview")}
          aria-label={t("group.viewOverview")}
          className="inline-flex items-center justify-center min-w-6 min-h-6 border border-border-subtle text-text-secondary hover:border-accent-blue/50 hover:text-accent-blue transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue align-middle"
        >
          <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
        {t("dash.overviewHintAfter")}
      </p>
      )}
    </div>
    );
  };

  /**
   * Renders the main panel when no single Pokémon is selected: the viewed
   * group's counter grid (or the synthetic ungrouped bucket) if one is shown,
   * otherwise the empty placeholder.
   */
  const renderNoPokemonOrGroupPanel = () => {
    const isUngrouped = viewedGroupId === UNGROUPED_VIEW_ID;
    const realGroup = groups.find((g) => g.id === viewedGroupId);
    if (!isUngrouped && !realGroup) return renderNoPokemonPanel();
    // The ungrouped bucket has no backing Group, so synthesize one for the view.
    const group: Group = realGroup ?? {
      id: UNGROUPED_VIEW_ID,
      name: t("sidebar.noGroup"),
      color: "#6b7280",
      sort_order: 0,
      collapsed: false,
    };
    // Scoped to the current tab: a group view opened from Active must not leak
    // completed members in, and vice versa (the group entity itself has no
    // active/archived state, only its members do).
    const scopePool = sidebarTab === "active" ? activeHunts : archivedHunts;
    const rawMembers = isUngrouped
      ? scopePool.filter((p) => !p.group_id)
      : scopePool.filter((p) => p.group_id === group.id);
    // Mirror the sidebar's sort so the overview order matches the list.
    const members = sortPokemonList(rawMembers, sortMode, sortDir);
    // ponytail: bulk increment/decrement fan out to per-member messages; there
    // is no dedicated group-increment endpoint. A real group's reset reuses the
    // reset_group message; the ungrouped bucket has no group id, so it fans the
    // reset out per member behind the same single confirmation.
    const onBulkReset = () => setConfirmConfig({
      isOpen: true,
      title: t("confirm.resetTitle"),
      message: t("confirm.resetMsg"),
      isDestructive: true,
      onConfirm: isUngrouped
        ? () => members.forEach((p) => send("reset", { pokemon_id: p.id }))
        : () => send("reset_group", { group_id: group.id }),
    });
    return (
      <div className="h-full w-full relative z-10 flex flex-col min-h-0">
        <GroupCounterView
          group={group}
          members={members}
          onIncrement={handleIncrement}
          onDecrement={handleDecrement}
          onReset={handleReset}
          onEdit={(p) => setEditingPokemon(p)}
          onOpenDetector={(id) => { setViewedGroupId(null); setViewedPokemonId(id); setRightPanelTab("detector"); }}
          onBulkIncrement={() => members.forEach((p) => handleIncrement(p.id))}
          onBulkDecrement={() => members.forEach((p) => send("decrement", { pokemon_id: p.id }))}
          onBulkReset={onBulkReset}
        />
      </div>
    );
  };

  /** Renders a single import-dropdown item for copying overlays from other Pokemon. */
  const renderOverlayTab = (pokemon: Pokemon) => (
    <DashboardOverlayTab
      pokemon={pokemon}
      overlaySaving={overlaySaving}
      overlaySaved={overlaySaved}
      overlayDirty={overlayDirty}
      currentOverlay={currentOverlay}
      allPokemon={allPokemon}
      onModeChange={handleModeChange}
      onSave={saveCurrentOverlay}
      onCopyFrom={copyOverlayFrom}
      onOverlayUpdate={(overlay) => { setCurrentOverlay(overlay); setOverlayDirty(true); }}
    />
  );

  const renderCounterTab = (pokemon: Pokemon) => (
    <DashboardCounterTab
      pokemon={pokemon}
      imgError={imgError}
      oddsDisplay={oddsDisplay}
      send={send}
      onImgError={(id, src) => setImgError((prev) => ({ ...prev, [id]: src }))}
      onDecrement={handleDecrement}
      onIncrement={handleIncrement}
      onReset={handleReset}
      onSetEncounter={setSetEncounterPokemon}
      timerStartBlocked={isTimerStartBlocked(pokemon, capture.isCapturing)}
    />
  );

  /** Renders the tab-specific content inside the scrollable work area. */
  const renderTabContent = (pokemon: Pokemon) =>
    resolveTabContent(
      rightPanelTab, pokemon,
      renderCounterTab, renderOverlayTab,
      handleDetectorConfigChange, detectorStatus,
      (pokemonId: string) => {
        const p = appState?.pokemon.find((pk) => pk.id === pokemonId);
        if (p?.timer_started_at) send("timer_stop", { pokemon_id: pokemonId });
        stopDetectionForPokemon(pokemonId);
        clearDetectorStatus(pokemonId);
      },
      isActiveRoute,
    );

  /** Renders the scrollable inner work area with the active tab content. */
  const renderScrollableContent = (pokemon: Pokemon) =>
    renderWorkArea(rightPanelTab, renderTabContent(pokemon));

  /** Toggles one tag in the active-tag-filter set. */
  const toggleTagFilter = (tag: string) => {
    setActiveTagFilters((prev) =>
      prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag],
    );
  };

  /** Renders one <li> Pokémon row. `idx` is the absolute position in displayList. */
  const renderPokemonItem = (p: Pokemon, idx: number): React.ReactNode => {
    const isViewed = p.id === effectiveViewedId;
    const isHotkeyTarget = p.id === appState.active_id;
    const isArchived = !!p.completed_at;
    const isSelected = selectedIds.has(p.id);
    const src = resolveSpriteUrl(p.id, p.sprite_url, imgError);
    const itemBorderClass = sidebarItemBorderClass(isSelected, isViewed);
    const itemClassName = buildSidebarItemClass(itemBorderClass, focusedIdx === idx, isArchived);
    const [baseName, formName] = getBaseAndFormName(p);
    const tags = p.tags ?? [];
    // Full metadata as tooltip since the merged line truncates.
    const metaTitle = [formName, p.game ? formatGame(p.game) : "", String(p.encounters)]
      .filter(Boolean)
      .join(" · ");
    // While dragging, show an empty dashed slot at the drop position so the
    // other items visibly make room (the dragged row itself is dimmed). The
    // slot sits above the hovered item, or below it when the cursor is over the
    // lower half (which also lets the user drop into the very last position).
    const isDropTarget = !!dragId && dragId !== p.id && dragOverId === p.id;
    const dropSlot = (
      <li
        aria-hidden="true"
        className="h-11 mx-1 my-1 rounded-none border-2 border-dashed border-accent-blue bg-accent-blue/10 pointer-events-none"
      />
    );
    return (
      <Fragment key={p.id}>
        {isDropTarget && !dropAfter && dropSlot}
        <li
          aria-current={isViewed ? "true" : undefined}
          data-sidebar-idx={idx}
          tabIndex={0}
          draggable
          className={`${itemClassName}${dragId === p.id ? " opacity-40" : ""}`}
          onClick={(e) => handleCardClick(e, p.id, idx)}
          onKeyDown={(e) => handleSidebarKeyDown(e, p.id)}
          data-selected={isSelected || undefined}
          onDragStart={() => setDragId(p.id)}
          onDragOver={(e) => {
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            const after = e.clientY > r.top + r.height / 2;
            if (dragOverId !== p.id || dropAfter !== after) { setDragOverId(p.id); setDropAfter(after); }
          }}
          onDrop={(e) => e.preventDefault()}
          onDragEnd={() => handleDropReorder()}
        >
        {/* aria-selected is invalid on a plain li, so the bulk-selection
            state is announced through visually hidden text instead. */}
        {isSelected && <span className="sr-only">{t("timer.selected")}</span>}
        <div className="w-8 h-8 2xl:w-10 2xl:h-10 shrink-0 relative self-start mt-0.5">
          <img
            src={src}
            alt={p.name}
            onError={() => setImgError((prev) => ({ ...prev, [p.id]: resolveSpriteSrc(p.sprite_url) }))}
            className="pokemon-sprite w-full h-full object-contain"
          />
          {isArchived && (
            <div className="absolute -bottom-0.5 -right-0.5 bg-accent-green rounded-none p-0.5">
              <Trophy className="w-2 h-2 text-text-primary" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          {/* Row 1: Name + Actions */}
          <div className="flex items-center gap-1">
            <span className="text-[13px] 2xl:text-sm font-semibold text-text-primary truncate flex-1 capitalize" title={p.name}>
              {baseName}
            </span>
            <div className="flex gap-0.5 items-center shrink-0">
              {hasDetectorReady(p) && (
                capture.isCapturing(p.id)
                  ? <span className="p-0.5" title={t("sidebar.sourceConnected")}><Video className="w-3 h-3 2xl:w-3.5 2xl:h-3.5 text-accent-green" aria-label={t("sidebar.sourceConnected")} /></span>
                  : <span className="p-0.5" title={t("sidebar.sourceDisconnected")}><VideoOff className="w-3 h-3 2xl:w-3.5 2xl:h-3.5 text-accent-red/70" aria-label={t("sidebar.sourceDisconnected")} /></span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); send("set_active", { pokemon_id: p.id }); }}
                className={`min-w-6 min-h-6 flex items-center justify-center rounded-none transition-colors hover:text-accent-blue ${
                  isHotkeyTarget ? "text-accent-blue" : "text-text-faint/40"
                }`}
                title={isHotkeyTarget ? t("dash.hotkeyTargetActive") : t("dash.hotkeyTarget")}
                aria-label={isHotkeyTarget ? t("dash.hotkeyTargetActive") : t("dash.hotkeyTarget")}
                aria-pressed={isHotkeyTarget}
              >
                <Keyboard className="w-3 h-3 2xl:w-3.5 2xl:h-3.5" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setEditingPokemon(p); }}
                className="min-w-6 min-h-6 flex items-center justify-center rounded-none text-text-faint hover:text-text-primary transition-colors"
                title={t("dash.edit")}
              >
                <Pencil className="w-3 h-3 2xl:w-3.5 2xl:h-3.5" />
              </button>
            </div>
          </div>
          {/* Row 2: Form · Game · Count + tag dots + Timer/Play (single merged metadata line) */}
          <div className="flex items-center gap-1.5 text-[11px] 2xl:text-xs text-text-muted">
            <span className="flex-1 min-w-0 truncate" title={metaTitle}>
              {formName && <span className="capitalize">{formName}</span>}
              {formName && p.game && <span className="text-text-faint"> · </span>}
              {p.game && <span>{formatGame(p.game)}</span>}
              {(formName || p.game) && <span className="text-text-faint"> · </span>}
              <span className="tabular-nums">{p.encounters}</span>
            </span>
            {!isViewed && tags.length > 0 && (
              <span className="flex items-center gap-1 shrink-0" title={tags.join(", ")}>
                {tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    aria-hidden="true"
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: tagDotColor(tag) }}
                  />
                ))}
                <span className="sr-only">{tags.join(", ")}</span>
              </span>
            )}
            <SidebarHuntStatus
              pokemon={p}
              send={send}
              detectorRunning={!!detectorStatus[p.id] || isLoopRunning(p.id)}
              disabled={!!p.completed_at}
              timerStartBlocked={isTimerStartBlocked(p, capture.isCapturing)}
              capture={capture}
              detectorStatus={detectorStatus}
              setDetectorStatus={setDetectorStatus}
              clearDetectorStatus={clearDetectorStatus}
            />
          </div>
          {/* Full tag chips only for the currently viewed hunt */}
          {isViewed && tags.length > 0 && (
            <div className="flex flex-wrap gap-1 min-w-0 mt-0.5">
              {tags.slice(0, 3).map((tag) => (
                <TagChip
                  key={tag}
                  tag={tag}
                  size="sm"
                  active={activeTagFilters.includes(tag)}
                  onClick={() => toggleTagFilter(tag)}
                />
              ))}
            </div>
          )}
        </div>
        </li>
        {isDropTarget && dropAfter && dropSlot}
      </Fragment>
    );
  };

  /** Builds index lookup so renderPokemonItem receives stable absolute positions. */
  const indexOfPokemon = (pokemonId: string) =>
    displayList.findIndex((x) => x.id === pokemonId);

  /** Renders the active-tab list grouped by group_id (sorted by sort_order, with "ungrouped" last). */
  const renderGroupedList = (): React.ReactNode => {
    const sortedGroups = [...groups].sort((a, b) => a.sort_order - b.sort_order);
    const byGroup = new Map<string, Pokemon[]>();
    for (const p of displayList) byGroup.set(p.group_id || "", [
      ...(byGroup.get(p.group_id || "") ?? []),
      p,
    ]);

    const sections: React.ReactNode[] = [];
    for (const g of sortedGroups) {
      const members = byGroup.get(g.id) ?? [];
      if (members.length === 0) continue; // hide empty sections
      sections.push(
        <SidebarGroupSection
          key={g.id}
          group={g}
          label={g.name}
          count={members.length}
          collapsed={!!g.collapsed}
          onToggleCollapse={() => handleGroupToggleCollapse(g)}
          onAction={(action) => handleGroupAction(g, action)}
          isHotkeyTarget={appState.active_group_id === g.id}
          onSetHotkeyTarget={() => {
            send("set_active_group", { group_id: appState.active_group_id === g.id ? "" : g.id });
          }}
          isGroupViewed={viewedGroupId === g.id}
          onShowGroupView={() => { setViewedPokemonId(null); setViewedGroupId((cur) => (cur === g.id ? null : g.id)); }}
        >
          {members.map((p) => renderPokemonItem(p, indexOfPokemon(p.id)))}
        </SidebarGroupSection>,
      );
    }
    // Ungrouped bucket always rendered last
    const ungrouped = byGroup.get("") ?? [];
    if (ungrouped.length > 0) {
      sections.push(
        <SidebarGroupSection
          key={UNGROUPED_VIEW_ID}
          group={null}
          label={t("sidebar.noGroup")}
          count={ungrouped.length}
          collapsed={ungroupedCollapsed}
          onToggleCollapse={() => setUngroupedCollapsed((v) => !v)}
          isGroupViewed={viewedGroupId === UNGROUPED_VIEW_ID}
          onShowGroupView={() => { setViewedPokemonId(null); setViewedGroupId((cur) => (cur === UNGROUPED_VIEW_ID ? null : UNGROUPED_VIEW_ID)); }}
        >
          {ungrouped.map((p) => renderPokemonItem(p, indexOfPokemon(p.id)))}
        </SidebarGroupSection>,
      );
    }
    return sections;
  };

  /** Persist group collapse state via REST; the WS broadcast refreshes the store. */
  const handleGroupToggleCollapse = (g: Group) => {
    void updateGroup(g.id, { collapsed: !g.collapsed }).catch(() => {});
  };

  /** Routes group overflow-menu actions. */
  const handleGroupAction = (g: Group, action: GroupAction) => {
    if (action === "rename" || action === "color") {
      setShowGroupModal(true);
      return;
    }
    if (action === "delete") {
      setConfirmConfig({
        isOpen: true,
        title: t("group.delete"),
        message: t("group.deleteConfirm", { name: g.name }),
        isDestructive: true,
        onConfirm: () => {
          void fetch(apiUrl(`/api/groups/${g.id}`), { method: "DELETE" }).catch(() => {});
        },
      });
      return;
    }
    if (action === "start") {
      void startGroupHunt(g.id).catch(() => {});
      return;
    }
    if (action === "stop") {
      void stopGroupHunt(g.id).catch(() => {});
    }
  };

  return (
    <div className="flex h-full">
      {/* LEFT: Pokemon sidebar */}
      <aside ref={asideRef} className={`shrink-0 bg-bg-secondary flex flex-col transition-[width] duration-200 overflow-hidden ${sidebarCollapsed ? "w-0" : "w-72 2xl:w-80"}`}>
        {/* Search bar + Sort + Collapse */}
        <div className="p-3 border-b border-border-subtle">
          <div className="flex items-center gap-1.5 2xl:gap-2">
            <div data-focus-wrapper className="flex-1 min-w-0 flex items-center gap-1.5 bg-bg-primary border border-border-subtle rounded-none px-2 py-1.5 2xl:px-3 2xl:gap-2 focus-within:border-accent-blue/50 focus-within:ring-2 focus-within:ring-accent-blue/30 transition-colors">
              <Search className="w-3.5 h-3.5 text-text-muted shrink-0" />
              <input
                ref={searchRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("dash.searchShortcut")}
                className="flex-1 min-w-0 bg-transparent text-text-primary placeholder-text-faint outline-none focus:outline-none focus-visible:outline-none text-xs"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="text-text-muted hover:text-text-primary"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            {/* Sort dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowSortMenu(v => !v)}
                className="p-1.5 rounded-none bg-bg-primary border border-border-subtle hover:border-accent-blue/40 text-text-muted hover:text-text-primary transition-colors"
                title={t("sidebar.sortBy")}
                aria-label={t("sidebar.sortBy")}
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
              </button>
              {showSortMenu && (
                <>
                  <button className="fixed inset-0 z-40 cursor-default" onClick={() => setShowSortMenu(false)} aria-label={t("aria.close")} />
                  <div className="absolute right-0 top-full mt-1 z-50 bg-bg-secondary border border-border-subtle rounded-none shadow-lg py-1 min-w-36">
                    {([
                      { mode: "recent" as const, label: t("sidebar.sortRecent") },
                      { mode: "name" as const, label: t("sidebar.sortName") },
                      { mode: "encounters" as const, label: t("sidebar.sortEncounters") },
                      { mode: "game" as const, label: t("sidebar.sortGame") },
                      { mode: "manual" as const, label: t("sidebar.sortManual") },
                    ] as const).map(({ mode, label }) => (
                      <button
                        key={mode}
                        onClick={() => handleSortClick(mode, sortMode, setSortMode, setSortDir, setShowSortMenu)}
                        className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-text-secondary hover:bg-bg-primary transition-colors"
                      >
                        {label}
                        {sortMode === mode && (
                          <ChevronDown className={`ml-auto w-3.5 h-3.5 text-accent-blue transition-transform ${sortDir === "asc" ? "rotate-180" : ""}`} />
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            {/* Tag filter toggle */}
            {sidebarTab === "active" && availableTags.length > 0 && (
              <button
                onClick={() => setShowTagFilterBar(v => !v)}
                aria-pressed={showTagFilterBar || activeTagFilters.length > 0}
                className={`p-1.5 rounded-none bg-bg-primary border transition-colors ${
                  showTagFilterBar || activeTagFilters.length > 0
                    ? "border-accent-blue/60 text-accent-blue"
                    : "border-border-subtle hover:border-accent-blue/40 text-text-muted hover:text-text-primary"
                }`}
                title={t("tag.filter")}
                aria-label={t("tag.filter")}
              >
                <Funnel className="w-3.5 h-3.5" />
              </button>
            )}
            {/* Manage groups */}
            <button
              onClick={() => setShowGroupModal(true)}
              className="p-1.5 rounded-none bg-bg-primary border border-border-subtle hover:border-accent-blue/40 text-text-muted hover:text-text-primary transition-colors"
              title={t("group.manage")}
              aria-label={t("group.manage")}
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </button>
            {/* Collapse sidebar */}
            <button
              onClick={() => setSidebarCollapsed(true)}
              className="p-1.5 rounded-none bg-bg-primary border border-border-subtle hover:border-accent-blue/40 text-text-muted hover:text-text-primary transition-colors"
              title={t("sidebar.collapse")}
              aria-label={t("sidebar.collapse")}
            >
              <PanelLeftClose className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Tabs: Active | Archive */}
        <div className="flex border-b border-border-subtle">
          <button
            onClick={() => setSidebarTab("active")}
            className={`flex-1 py-2 text-xs 2xl:text-sm font-semibold transition-colors relative ${
              sidebarTab === "active"
                ? "text-accent-blue"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            <span className="flex items-center justify-center gap-1.5">
              <Sparkles className="w-3 h-3" />
              {t("dash.tabActive")}
              {activeHunts.length > 0 && (
                <span className="border border-accent-blue/40 text-accent-blue text-[10px] px-1.5 py-0.5 rounded-none tabular-nums">
                  {activeHunts.length}
                </span>
              )}
            </span>
            {sidebarTab === "active" && (
              <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-accent-blue rounded-none" />
            )}
          </button>
          <button
            onClick={() => setSidebarTab("archived")}
            className={`flex-1 py-2 text-xs 2xl:text-sm font-semibold transition-colors relative ${
              sidebarTab === "archived"
                ? "text-accent-green"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            <span className="flex items-center justify-center gap-1.5">
              <Trophy className="w-3 h-3" />
              {t("dash.tabArchive")}
              {archivedHunts.length > 0 && (
                <span className="border border-accent-green/40 text-accent-green text-[10px] px-1.5 py-0.5 rounded-none tabular-nums">
                  {archivedHunts.length}
                </span>
              )}
            </span>
            {sidebarTab === "archived" && (
              <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-accent-green rounded-none" />
            )}
          </button>
        </div>

        {/* Quick actions bar */}
        <SidebarQuickActions
          allPokemon={appState.pokemon}
          activeHunts={activeHunts}
          selectedIds={selectedIds}
          sidebarTab={sidebarTab}
          detectorStatus={detectorStatus}
          showHuntMenu={showHuntMenu}
          setShowHuntMenu={setShowHuntMenu}
          send={send}
          capture={capture}
          setDetectorStatus={setDetectorStatus}
          clearDetectorStatus={clearDetectorStatus}
          bulkComplete={bulkComplete}
          bulkDelete={bulkDelete}
          setSelectedIds={setSelectedIds}
          viewedPokemonId={viewedPokemonId}
        />

        {/* Tag filter bar: only when tags exist and a filter is active or the funnel toggle is on */}
        {sidebarTab === "active" && availableTags.length > 0 && (activeTagFilters.length > 0 || showTagFilterBar) && (
          <TagFilterBar
            activeTags={activeTagFilters}
            availableTags={availableTags}
            onToggle={toggleTagFilter}
            onClear={() => setActiveTagFilters([])}
          />
        )}

        {/* Pokémon list */}
        <div className="flex-1 overflow-y-auto">
          {displayList.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-6 text-center">
              <EmptyListPlaceholder query={q} sidebarTab={sidebarTab} onClearAndAdd={handleClearAndAdd} onAdd={handleOpenAdd} />
            </div>
          ) : (
            /* Grouped view: each group section renders its own <ul> so the
               native list content model stays valid (group headers are not
               list items). Used for both tabs so a group's "view" action
               scopes correctly to whichever tab it was opened from. */
            <div className="py-1 select-none">{renderGroupedList()}</div>
          )}
        </div>

        {/* Add button */}
        {sidebarTab === "active" && (
          <div className="p-3 border-t border-border-subtle">
            <button
              onClick={() => setShowAddModal(true)}
              title={t("dash.tooltipAddPokemon")}
              className="t-cut w-full flex items-center justify-center gap-1.5 py-2 2xl:py-2.5 bg-accent-blue hover:bg-accent-blue/80 rounded-none text-xs 2xl:text-sm font-semibold transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              {t("dash.addPokemon")}
            </button>
          </div>
        )}
      </aside>
      {/* Collapsed mini-sidebar: sprites only */}
      {sidebarCollapsed && (
        <div className="shrink-0 w-12 flex flex-col bg-bg-secondary">
          <button
            onClick={() => setSidebarCollapsed(false)}
            className="p-3 text-text-muted hover:text-text-primary transition-colors border-b border-border-subtle"
            title={t("sidebar.expand")}
            aria-label={t("sidebar.expand")}
          >
            <PanelLeftOpen className="w-4 h-4 mx-auto" />
          </button>
          <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">
            {displayList.map((p) => (
              <CollapsedSidebarItem
                key={p.id}
                pokemon={p}
                isViewed={p.id === effectiveViewedId}
                detectorStatus={detectorStatus}
                imgError={imgError}
                onActivate={handleActivate}
                onImgError={(id, src) => setImgError((prev) => ({ ...prev, [id]: src }))}
                t={t}
              />
            ))}
          </div>
          {sidebarTab === "active" && (
            <>
              <div className="border-t border-border-subtle mx-2" />
              <button
                onClick={() => setShowAddModal(true)}
                className="p-2 mx-auto my-2 text-accent-blue hover:text-white hover:bg-accent-blue rounded-none transition-colors"
                title={t("dash.addPokemon")}
                aria-label={t("dash.addPokemon")}
              >
                <Plus className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
      )}
      <div className="w-px shrink-0 bg-border-subtle" />

      <main id={isActiveRoute ? "main-content" : undefined} className="flex-1 flex flex-col relative h-full min-h-0 bg-transparent overflow-hidden">
        <h1 className="sr-only">{t("nav.dashboard")}</h1>

        {viewedPokemon ? (
          <div className="flex flex-col h-full w-full">
            {/* Top Bar (übergeordnet, scrollt nicht mit) */}
            <header className="flex-none px-4 py-2.5 border-b border-border-subtle bg-bg-card z-50 relative grid grid-cols-[auto_1fr_auto] items-center gap-3">

              {/* Left: Tabs */}
              <div className="flex justify-start min-w-0">
                <div className="flex bg-bg-card rounded-none border border-border-subtle p-0.5 shadow-sm min-w-0">
                  <button
                    onClick={() => setRightPanelTab("counter")}
                    className={tabButtonClass(rightPanelTab === "counter")}
                    title={t("dash.tabCounter")}
                    aria-label={t("dash.tabCounter")}
                  >
                    <Tally5 className="w-3.5 h-3.5" />
                    <span className={tabLabelClass()}>{t("dash.tabCounter")}</span>
                  </button>
                  {!viewedPokemon.completed_at && (
                    <button
                      onClick={() => setRightPanelTab("detector")}
                      className={tabButtonClass(rightPanelTab === "detector")}
                      title={t("dash.tabDetector")}
                      aria-label={t("dash.tabDetector")}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span className={tabLabelClass()}>{t("dash.tabDetector")}</span>
                      {detectorStatus[viewedPokemon.id]?.state === "match" && (
                        <span className="w-2 h-2 rounded-full bg-accent-green ml-1.5" />
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => setRightPanelTab("overlay")}
                    className={tabButtonClass(rightPanelTab === "overlay")}
                    title={t("dash.tabOverlay")}
                    aria-label={t("dash.tabOverlay")}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span className={tabLabelClass()}>{t("dash.tabOverlay")}</span>
                  </button>
                  <button
                    onClick={() => setRightPanelTab("statistics")}
                    className={tabButtonClass(rightPanelTab === "statistics")}
                    title={t("dash.tabStatistics")}
                    aria-label={t("dash.tabStatistics")}
                  >
                    <BarChart3 className="w-3.5 h-3.5" />
                    <span className={tabLabelClass()}>{t("dash.tabStatistics")}</span>
                  </button>
                </div>
              </div>

              {/* Center: Pokemon sprite + name + game badge — always centered via grid */}
              <div className="flex items-center gap-2 justify-center min-w-0">
                {isCustomSprite(viewedPokemon.sprite_url) ? (
                  <img
                    src={resolveSpriteUrl(viewedPokemon.id, viewedPokemon.sprite_url, imgError)}
                    alt={viewedPokemon.name}
                    className="h-10 w-auto shrink-0 object-contain"
                    onError={() => setImgError((prev) => ({ ...prev, [viewedPokemon.id]: resolveSpriteSrc(viewedPokemon.sprite_url) }))}
                  />
                ) : (
                  <TrimmedBoxSprite
                    canonicalName={viewedPokemon.canonical_name}
                    spriteType={viewedPokemon.sprite_type}
                    alt={viewedPokemon.name}
                    className="h-10 w-auto shrink-0"
                    fallbackSrc={resolveSpriteSrc(viewedPokemon.sprite_url)}
                  />
                )}
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-sm font-bold text-text-primary leading-tight truncate">{viewedPokemon.name}</span>
                  {viewedPokemon.game && (
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-text-muted leading-tight truncate max-w-28">
                      {formatGame(viewedPokemon.game)}
                    </span>
                  )}
                </div>
              </div>

              {/* Right: primary actions + overflow menu */}
              <div className="flex items-center gap-2 justify-end min-w-0">

              {/* 1. Caught, positive state change before CTA */}
              {!viewedPokemon.completed_at && (
                <button
                  onClick={() => handleComplete(viewedPokemon.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-none bg-accent-blue hover:bg-accent-blue/90 border border-transparent text-xs font-bold transition-colors"
                  aria-label={t("dash.caught")}
                >
                  <PartyPopper className="w-3.5 h-3.5" />
                  <span className="hidden 2xl:inline">{t("dash.caught")}</span>
                </button>
              )}

              {/* 2. Hunt start/stop, primary CTA */}
              {!viewedPokemon.completed_at && (
                <HeaderHuntButton
                  pokemon={viewedPokemon}
                  detectorStatus={detectorStatus}
                  showMenu={showHeaderHuntMenu}
                  setShowMenu={setShowHeaderHuntMenu}
                  send={send}
                  capture={capture}
                  setDetectorStatus={setDetectorStatus}
                  clearDetectorStatus={clearDetectorStatus}
                />
              )}

              {/* 3. Overflow: Edit / Reactivate / Delete */}
              <HeaderOverflowMenu
                pokemon={viewedPokemon}
                onEdit={() => setEditingPokemon(viewedPokemon)}
                onDelete={() => handleDelete(viewedPokemon.id)}
                onReactivate={() => handleUncomplete(viewedPokemon.id)}
              />

              </div>
            </header>

            {/* SCROLLABLE INNER WORK AREA — overlay tab uses full height without scroll */}
            {renderScrollableContent(viewedPokemon)}
        </div>
        ) : (
          renderNoPokemonOrGroupPanel()
        )}
      </main>

      {/* Modals */}
      {showAddModal && (
        <AddPokemonModal
          onAdd={handleAddPokemon}
          onClose={() => setShowAddModal(false)}
          activeLanguages={activeLanguages}
          groups={groups.map((g) => ({ id: g.id, name: g.name, color: g.color }))}
          availableTags={availableTags}
          onManageGroups={() => setShowGroupModal(true)}
        />
      )}
      {editingPokemon && (
        <EditPokemonModal
          pokemon={editingPokemon}
          onSave={handleSavePokemon}
          onClose={() => setEditingPokemon(null)}
          activeLanguages={activeLanguages}
          groups={groups.map((g) => ({ id: g.id, name: g.name, color: g.color }))}
          availableTags={availableTags}
          onManageGroups={() => setShowGroupModal(true)}
        />
      )}
      {showGroupModal && (
        <GroupManagementModal
          groups={groups}
          onClose={() => setShowGroupModal(false)}
        />
      )}
      {confirmConfig.isOpen && (
        <ConfirmModal
          title={confirmConfig.title}
          message={confirmConfig.message}
          isDestructive={confirmConfig.isDestructive}
          onConfirm={confirmConfig.onConfirm}
          onClose={() => setConfirmConfig({ ...confirmConfig, isOpen: false })}
        />
      )}
      {setEncounterPokemon && (
        <SetEncounterModal
          pokemon={setEncounterPokemon}
          onSave={(count) => send("set_encounters", { pokemon_id: setEncounterPokemon.id, count })}
          onClose={() => setSetEncounterPokemon(null)}
        />
      )}

      {/* Unsaved overlay changes — tab switch confirmation */}
      {pendingTab && (
        <div // NOSONAR — backdrop click dismisses unsaved-changes dialog
          ref={unsavedDialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="dashboard-unsaved-title"
          tabIndex={-1}
          className="fixed inset-0 z-90 bg-black/50 backdrop-blur-sm flex items-center justify-center animate-fadeIn"
          onClick={(e) => { if (e.target === e.currentTarget) setPendingTab(null); }}
        >
          <div className="t-panel p-8 flex flex-col items-center gap-5 max-w-md mx-4 shadow-2xl anim-t-crt-in">
            <div className="w-14 h-14 rounded-full border border-accent-yellow/40 flex items-center justify-center">
              <AlertTriangle className="w-7 h-7 text-accent-yellow" />
            </div>
            <div className="text-center space-y-1.5">
              <p id="dashboard-unsaved-title" className="text-lg font-semibold text-text-primary">
                {t("overlay.unsavedTitle")}
              </p>
              <p className="text-sm text-text-muted">
                {t("overlay.unsavedDesc")}
              </p>
            </div>
            <div className="flex gap-3 w-full">
              <button
                type="button"
                onClick={() => setPendingTab(null)}
                className="flex-1 px-4 py-2.5 rounded-none border border-border-subtle text-text-muted hover:bg-bg-hover text-sm font-medium transition-colors"
              >
                {t("overlay.unsavedStay")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOverlayDirty(false);
                  setRightPanelTab(pendingTab);
                  setPendingTab(null);
                }}
                className="flex-1 px-4 py-2.5 rounded-none bg-accent-red hover:brightness-110 text-bg-primary text-sm font-semibold transition-colors"
              >
                {t("overlay.unsavedDiscard")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
