/**
 * Dashboard.tsx — Main counter UI.
 *
 * Displays a split layout: a left sidebar lists all tracked Pokémon and an
 * optional search/filter, while the right panel shows detailed controls for
 * the active Pokémon (increment, decrement, reset, complete/delete).
 * Counter actions are sent over WebSocket for immediate multi-tab sync.
 */
import { useState, useEffect, useRef, useReducer } from "react";
import {
  Plus,
  Minus,
  RotateCcw,
  Zap,
  Edit2,
  Gamepad2,
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
  Pause,
  Timer,
  BarChart3,
  Check,
  Target,
  Keyboard,
  ArrowUpDown,
  PanelLeftClose,
  PanelLeftOpen,
  Tally5,
  AlertTriangle,
  Monitor,
} from "lucide-react";
import { Link } from "react-router";
import { AddPokemonModal, NewPokemonData } from "../components/pokemon/AddPokemonModal";
import { EditPokemonModal } from "../components/pokemon/EditPokemonModal";
import { ConfirmModal } from "../components/shared/ConfirmModal";
import { SetEncounterModal } from "../components/shared/SetEncounterModal";
import { StatisticsPanel } from "../components/shared/StatisticsPanel";
import { DetectorPanel } from "../components/detector/DetectorPanel";
import { isLoopRunning } from "../engine/DetectionLoop";
import { startDetectionForPokemon, stopDetectionForPokemon } from "../engine/startDetection";
import { OverlayEditor } from "../components/overlay-editor/OverlayEditor";
import { useCounterStore } from "../hooks/useCounterState";
import { useWebSocket } from "../hooks/useWebSocket";
import { Pokemon, DetectorConfig, OverlaySettings, OverlayMode, GameEntry, AppState } from "../types";
import { useI18n } from "../contexts/I18nContext";
import { useCaptureService } from "../contexts/CaptureServiceContext";
import { useToast } from "../contexts/ToastContext";
import { resolveOverlay } from "../utils/overlay";
import { getMethodOdds, formatOdds } from "../utils/gameGroups";
import { SPRITE_FALLBACK } from "../utils/sprites";
import { TrimmedBoxSprite } from "../components/shared/TrimmedBoxSprite";

import { apiUrl } from "../utils/api";
import { OverlayBrowserSourceButton } from "../components/shared/OverlayBrowserSourceButton";

/** Tab identifiers for the right content panel. */
type PanelTab = "counter" | "detector" | "overlay" | "statistics";

// --- Timer helpers ---

/** Formats milliseconds as HH:MM:SS. */
function formatTimer(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Computes the current total timer value for a Pokemon (accumulated + running). */
function computeTimerMs(pokemon: Pokemon): number {
  const acc = pokemon.timer_accumulated_ms || 0;
  if (!pokemon.timer_started_at) return acc;
  return acc + (Date.now() - new Date(pokemon.timer_started_at).getTime());
}

/** PokemonTimer renders play/pause/reset controls and a live timer display for the main panel. */
function PokemonTimer({ pokemon, send, disabled = false }: Readonly<{ pokemon: Pokemon; send: (type: string, payload: unknown) => void; disabled?: boolean }>) {
  const { t } = useI18n();
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  const isRunning = !!pokemon.timer_started_at;

  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => forceUpdate(), 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  return (
    <div className="flex items-center gap-3 mt-6">
      <Timer className="w-4 h-4 text-text-muted" />
      <span className="text-lg font-mono tabular-nums text-text-primary">{formatTimer(computeTimerMs(pokemon))}</span>
      <div className="flex gap-1.5">
        {isRunning ? (
          <button
            onClick={() => send("timer_stop", { pokemon_id: pokemon.id })}
            className="p-1.5 rounded-lg bg-accent-yellow/20 hover:bg-accent-yellow/30 text-accent-yellow transition-colors"
            title={t("timer.stop")}
            aria-label={t("aria.timerPause")}
          >
            <Pause className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            onClick={() => send("timer_start", { pokemon_id: pokemon.id })}
            disabled={disabled}
            className="p-1.5 rounded-lg bg-accent-green/20 hover:bg-accent-green/30 text-accent-green transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={t("timer.start")}
            aria-label={t("aria.timerStart")}
          >
            <Play className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={() => send("timer_reset", { pokemon_id: pokemon.id })}
          disabled={disabled}
          className="p-1.5 rounded-lg bg-bg-card hover:bg-bg-hover text-text-muted hover:text-text-primary border border-border-subtle transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title={t("timer.reset")}
          aria-label={t("aria.timerReset")}
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

/** Returns true if the Pokemon has at least one enabled detector template. */
function hasDetectorReady(pokemon: Pokemon): boolean {
  const tmpls = pokemon.detector_config?.templates;
  if (!tmpls || tmpls.length === 0) return false;
  return tmpls.some((t) => t.enabled !== false);
}

/** SidebarTimer shows a compact timer + play/pause in the sidebar Pokemon list. */
function SidebarTimer({ pokemon, send, disabled = false }: Readonly<{ pokemon: Pokemon; send: (type: string, payload: unknown) => void; disabled?: boolean }>) {
  const { t } = useI18n();
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  const isRunning = !!pokemon.timer_started_at;

  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => forceUpdate(), 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  const totalMs = computeTimerMs(pokemon);
  const canToggle = isRunning || !disabled;

  const toggleClass = isRunning
    ? "text-accent-green hover:text-accent-yellow"
    : "text-text-faint hover:text-accent-green";
  const disabledClass = "text-text-faint opacity-50 cursor-not-allowed";

  return (
    <div className="flex items-center gap-1 mt-0.5">
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (canToggle) send(isRunning ? "timer_stop" : "timer_start", { pokemon_id: pokemon.id });
        }}
        disabled={!canToggle}
        className={`p-0.5 rounded transition-colors ${canToggle ? toggleClass : disabledClass}`}
        title={isRunning ? t("timer.stop") : t("timer.start")}
      >
        {isRunning ? <Pause className="w-2.5 h-2.5" /> : <Play className="w-2.5 h-2.5" />}
      </button>
      {(isRunning || totalMs > 0) && (
        <span className={`text-[10px] font-mono tabular-nums ${isRunning ? "text-accent-green" : "text-text-muted"}`}>
          {formatTimer(totalMs)}
        </span>
      )}
    </div>
  );
}

function huntButtonClass(anyRunning: boolean, canStart: boolean, mode: string): string {
  if (anyRunning) return "text-red-400 hover:text-red-300 hover:bg-red-500/10";
  if (!canStart) return "opacity-30 cursor-not-allowed text-text-muted";
  if (mode === "detector") return "text-purple-400 hover:text-purple-300 hover:bg-purple-500/10";
  if (mode === "timer") return "text-accent-green hover:text-accent-green hover:bg-accent-green/10";
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

/** Computes the shiny odds display string for the given Pokemon and game list. */
function computeOddsDisplay(pokemon: Pokemon | null, games: GameEntry[]): string {
  if (!pokemon) return "1/4096";

  const gameKey = pokemon.game || "";
  const hasCharm = pokemon.shiny_charm ?? false;
  const ht = pokemon.hunt_type || "encounter";

  // Use game-group-specific odds when available
  if (gameKey) {
    const odds = getMethodOdds(gameKey, ht, hasCharm);
    return formatOdds(odds);
  }

  // Fallback for pokemon without a game set
  const gameGen = games.find((g) => g.key === gameKey)?.generation ?? null;
  const isOldGen = gameGen !== null && gameGen >= 2 && gameGen <= 5;
  return isOldGen ? "1/8192" : "1/4096";
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
): { isOpen: boolean; title: string; message: string; isDestructive: boolean; onConfirm: () => void } | null {
  if (msg.type !== "request_reset_confirm") return null;
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

/** Fetches the games list on mount for generation-aware odds display. */
function useGames(): GameEntry[] {
  const [games, setGames] = useState<GameEntry[]>([]);
  useEffect(() => {
    fetch(apiUrl("/api/games"))
      .then((r) => r.json())
      .then((data: GameEntry[]) => { if (Array.isArray(data)) setGames(data); })
      .catch(() => {});
  }, []);
  return games;
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
): { dotClass: string; title: string } {
  const isMatch = detectorStatus[pokemonId]?.state === "match";
  const isRunning = !!detectorStatus[pokemonId];
  if (isMatch) return { dotClass: "bg-accent-green", title: t("detector.stateMatch") };
  if (isRunning) return { dotClass: "bg-accent-blue animate-pulse", title: t("detector.stateIdle") };
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
  handleActivate: (id: string) => void;
  bulkDelete: () => void;
}

/** Handles ArrowDown/Up navigation in the sidebar list. */
function handleSidebarArrow(e: KeyboardEvent, ctx: SidebarKeyboardContext): void {
  e.preventDefault();
  if (e.key === "ArrowDown") {
    ctx.setFocusedIdx(prev => prev === null ? 0 : Math.min(prev + 1, ctx.displayList.length - 1));
  } else {
    ctx.setFocusedIdx(prev => prev === null ? ctx.displayList.length - 1 : Math.max(prev - 1, 0));
  }
}

/** Handles Enter (activate) and Space (toggle select) on focused sidebar item. */
function handleSidebarFocusedAction(e: KeyboardEvent, ctx: SidebarKeyboardContext): void {
  if (ctx.focusedIdx === null || !ctx.displayList[ctx.focusedIdx]) return;
  e.preventDefault();
  const item = ctx.displayList[ctx.focusedIdx];
  if (e.key === "Enter") {
    ctx.handleActivate(item.id);
  } else {
    ctx.setSelectedIds(prev => {
      const n = new Set(prev);
      if (n.has(item.id)) { n.delete(item.id); } else { n.add(item.id); }
      return n;
    });
  }
}

/** Dispatches sidebar keyboard events for navigation and selection. */
function handleSidebarKeyboard(e: KeyboardEvent, ctx: SidebarKeyboardContext): void {
  if (!ctx.aside.contains(document.activeElement) && document.activeElement !== document.body) return;

  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    handleSidebarArrow(e, ctx);
  } else if (e.key === "Enter" || e.key === " ") {
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

/** Updates the hunt_mode for a Pokemon via the API. */
function updateHuntMode(pokemon: Pokemon, mode: HuntMode): void {
  if (pokemon.hunt_mode !== mode) {
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
type SortMode = "recent" | "name" | "encounters" | "game";
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

/** Sorts a Pokemon list by the given mode and direction. */
function sortPokemonList(list: Pokemon[], mode: SortMode, dir: SortDir): Pokemon[] {
  if (mode === "recent") return dir === "asc" ? list : [...list].reverse();
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
  return `px-4 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
    isActive
      ? "bg-accent-blue text-white shadow"
      : "text-text-muted hover:text-text-primary hover:bg-bg-hover"
  }`;
}

/** Builds the full CSS class for a sidebar Pokemon list item. */
function buildSidebarItemClass(borderClass: string, isFocused: boolean, isArchived: boolean): string {
  const focusRing = isFocused ? " ring-1 ring-inset ring-accent-blue/40" : "";
  const opacity = isArchived ? " opacity-70" : "";
  return `flex items-center gap-3 px-3 py-2 2xl:px-4 2xl:py-2.5 cursor-pointer transition-colors group ${borderClass}${focusRing}${opacity}`;
}

/** Handles Enter/Space keydown to activate a Pokemon in the sidebar. */
function handleActivateKeyDown(e: React.KeyboardEvent, pokemonId: string, onActivate: (id: string) => void): void {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    onActivate(pokemonId);
  }
}

/** Resolves the sprite URL for a Pokemon, falling back if there's an error or no URL. */
function resolveSpriteUrl(pokemonId: string, spriteUrl: string | undefined, imgError: Record<string, boolean>): string {
  return imgError[pokemonId] || !spriteUrl ? SPRITE_FALLBACK : spriteUrl;
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
      setConfirmConfig(prev => ({ ...prev, isOpen: false }));
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
function findViewedPokemon(allPokemon: Pokemon[], viewedId: string | null, activeId: string): Pokemon | null {
  const targetId = viewedId || activeId;
  return allPokemon.find((p) => p.id === targetId) ?? null;
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

/** Sidebar quick actions bar: start/stop hunts, mode selector, selection actions. */
function SidebarQuickActions({
  allPokemon, activeHunts, selectedIds, sidebarTab, detectorStatus,
  totalEncounters, showHuntMenu, setShowHuntMenu, send, capture,
  setDetectorStatus, clearDetectorStatus, bulkComplete, bulkDelete, setSelectedIds,
}: Readonly<{
  allPokemon: Pokemon[];
  activeHunts: Pokemon[];
  selectedIds: Set<string>;
  sidebarTab: SidebarTab;
  detectorStatus: Record<string, { state?: string; confidence?: number }>;
  totalEncounters: number;
  showHuntMenu: boolean;
  setShowHuntMenu: (v: boolean | ((prev: boolean) => boolean)) => void;
  send: (type: string, payload: unknown) => void;
  capture: { isCapturing: (id: string) => boolean; getVideoElement: (id: string) => HTMLVideoElement | null };
  setDetectorStatus: (id: string, status: { state: string; confidence: number; poll_ms: number }) => void;
  clearDetectorStatus: (id: string) => void;
  bulkComplete: () => void;
  bulkDelete: () => void;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
}>) {
  const { t } = useI18n();
  const sel = selectedIds.size > 0
    ? allPokemon.filter(p => selectedIds.has(p.id))
    : activeHunts;
  const hasRunningTimer = sel.some(p => !!p.timer_started_at);
  const withDetector = sel.filter(p => hasDetectorReady(p));
  const hasDetector = withDetector.length > 0;
  const hasRunningDetector = sel.some(p => !!detectorStatus[p.id] || isLoopRunning(p.id));
  const anyRunning = hasRunningTimer || hasRunningDetector;
  const canStart = sel.length > 0;

  const currentMode = resolveHuntMode(sel);

  const startAll = () => {
    for (const p of sel) {
      const mode = p.hunt_mode || "both";
      if (mode !== "detector" && !p.timer_started_at) send("timer_start", { pokemon_id: p.id });
      if (canStartDetector(p, detectorStatus, capture)) {
        tryStartDetection(p, capture, setDetectorStatus);
      }
    }
  };
  const stopAll = () => {
    for (const p of sel) {
      if (p.timer_started_at) send("timer_stop", { pokemon_id: p.id });
      stopDetectionForPokemon(p.id);
      clearDetectorStatus(p.id);
    }
  };
  const setHuntMode = (mode: HuntMode) => {
    for (const p of sel) updateHuntMode(p, mode);
    setShowHuntMenu(false);
  };

  const sidebarLabel = resolveHuntLabel(anyRunning, currentMode, t);
  const sidebarIcon = resolveHuntIcon(anyRunning, currentMode);

  return (
    <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border-subtle">
      <div className="relative flex items-center">
        <button
          disabled={!canStart && !anyRunning}
          onClick={() => { if (anyRunning) stopAll(); else startAll(); }}
          className={`p-1.5 rounded-lg transition-colors ${huntButtonClass(anyRunning, canStart, currentMode)}`}
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
            <div className="absolute left-0 top-full mt-1 z-50 bg-bg-secondary border border-border-subtle rounded-lg shadow-lg py-1 min-w-40">
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
        <div className="flex items-center gap-1.5 mr-2">
          <span className="text-[10px] text-accent-blue font-semibold tabular-nums">{selectedIds.size}</span>
          {sidebarTab === "active" && (
            <button
              onClick={bulkComplete}
              className="p-1 rounded text-text-faint hover:text-accent-green transition-colors"
              title={t("dash.caught")}
              aria-label={t("dash.caught")}
            >
              <PartyPopper className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={bulkDelete}
            className="p-1 rounded text-text-faint hover:text-accent-red transition-colors"
            title={t("dash.delete")}
            aria-label={t("dash.delete")}
          >
            <Trash2 className="w-3 h-3" />
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="p-0.5 rounded text-text-faint hover:text-text-primary transition-colors"
            title={t("timer.clearSelection")}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
      <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
        <Zap className="w-3 h-3 text-accent-yellow" />
        <span className="tabular-nums">{totalEncounters}</span>
      </div>
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
  return anyRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />;
}

/** Resolves the hunt button background color based on running state and mode. */
function resolveHuntBgColor(anyRunning: boolean, mode: string): string {
  if (anyRunning) return "bg-red-500/15";
  if (mode === "detector") return "bg-purple-600";
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

  const buttonLabel = resolveHuntLabel(anyRunning, huntMode, t);
  const modeIcon = resolveHuntIcon(anyRunning, huntMode);
  const bgColor = resolveHuntBgColor(anyRunning, huntMode);

  const handleToggle = () => {
    if (anyRunning) {
      if (timerRunning) send("timer_stop", { pokemon_id: pokemon.id });
      // Always stop loop + clear status when stopping a hunt
      stopDetectionForPokemon(pokemon.id);
      clearDetectorStatus(pokemon.id);
    } else {
      const needsDetector = huntMode !== "timer";

      // Block start if detection is required but prerequisites are missing
      if (needsDetector) {
        if (!hasDetectorReady(pokemon)) {
          pushToast({ type: "error", title: t("detector.errNoTemplates") });
          return;
        }
        if (!capture.isCapturing(pokemon.id)) {
          pushToast({ type: "error", title: t("detector.errNoSource") });
          return;
        }
      }

      if (huntMode !== "detector" && !pokemon.timer_started_at) send("timer_start", { pokemon_id: pokemon.id });
      if (canStartDetector(pokemon, detectorStatus, capture)) {
        tryStartDetection(pokemon, capture, setDetectorStatus);
      }
    }
  };

  return (
    <div className="relative shrink-0" data-detector-tutorial="controls">
      <div className={`flex items-center rounded-full overflow-hidden ${bgColor}`}>
        <button
          onClick={handleToggle}
          className={`flex items-center gap-1.5 pl-3 pr-2 py-1.5 text-xs font-bold transition-colors ${
            anyRunning ? "text-red-400 hover:bg-red-500/20" : "hover:bg-white/10"
          }`}
          aria-label={buttonLabel}
        >
          {modeIcon}
          <span className="hidden sm:inline">{buttonLabel}</span>
        </button>
        <div className={`w-px h-4 ${anyRunning ? "bg-red-400/30" : "bg-white/20"}`} />
        <button
          onClick={() => setShowMenu((v: boolean) => !v)}
          className={`px-1.5 py-1.5 transition-colors ${
            anyRunning ? "text-red-400 hover:bg-red-500/20" : "hover:bg-white/10"
          }`}
          aria-label={t("sidebar.both")}
        >
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>
      {showMenu && (
        <>
          <button className="fixed inset-0 z-40 cursor-default" onClick={() => setShowMenu(false)} aria-label={t("aria.close")} />
          <div className="absolute right-0 top-full mt-1 z-50 bg-bg-secondary border border-border-subtle rounded-lg shadow-lg py-1 min-w-40">
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

/** Collapsed sidebar sprite-only button for a single Pokemon. */
function CollapsedSidebarItem({
  pokemon, isViewed, detectorStatus, imgError, onActivate, onImgError, t,
}: Readonly<{
  pokemon: Pokemon;
  isViewed: boolean;
  detectorStatus: Record<string, { state?: string; confidence?: number }>;
  imgError: Record<string, boolean>;
  onActivate: (id: string) => void;
  onImgError: (id: string) => void;
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
          onError={() => onImgError(pokemon.id)}
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

/** Counter tab content: sprite, encounter buttons, timer, and stats. */
function DashboardCounterTab({
  pokemon, imgError, oddsDisplay, send,
  onImgError, onDecrement, onIncrement, onReset, onSetEncounter,
}: Readonly<{
  pokemon: Pokemon;
  imgError: Record<string, boolean>;
  oddsDisplay: string;
  send: (type: string, payload: unknown) => void;
  onImgError: (id: string) => void;
  onDecrement: (id: string) => void;
  onIncrement: (id: string) => void;
  onReset: (id: string) => void;
  onSetEncounter: (p: Pokemon) => void;
}>) {
  const { t } = useI18n();
  const FALLBACK = SPRITE_FALLBACK;
  const spriteUrl = imgError[pokemon.id] || !pokemon.sprite_url ? FALLBACK : pokemon.sprite_url;
  const step = stepLabel(pokemon);
  const hasCustomStep = pokemon.step && pokemon.step > 1;
  const isCompleted = !!pokemon.completed_at;

  return (
    <>
      {isCompleted && (
        <div className="flex items-center gap-2.5 px-6 py-2 rounded-full bg-accent-green/10 text-accent-green text-sm mb-6 border border-accent-green/30 shadow-sm mt-8">
          <Trophy className="w-4 h-4" />
          <span className="font-bold">{t("dash.caughtBanner")}</span>
          <span className="w-px h-3 bg-accent-green/30" />
          <span className="text-accent-green/80 text-xs font-medium">
            {new Date(pokemon.completed_at!).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" })}
          </span>
        </div>
      )}

      <div className="relative w-full max-h-64 mb-4 mt-8 flex items-center justify-center">
        <div className="relative z-10 flex flex-col items-center">
          <img
            src={spriteUrl}
            alt={pokemon.name}
            onError={() => onImgError(pokemon.id)}
            className="pokemon-sprite w-48 h-48 2xl:w-56 2xl:h-56 object-contain drop-shadow-xl transition-transform duration-300 hover:scale-110"
          />
        </div>
      </div>
      <h2 className="text-3xl 2xl:text-4xl font-black text-text-primary capitalize tracking-wide drop-shadow-md text-center mb-2">
        {pokemon.name}
      </h2>

      <PokemonTimer pokemon={pokemon} send={send} disabled={isCompleted} />

      <div className="flex items-center gap-4 2xl:gap-6 mt-6 w-full justify-center">
        <button
          onClick={() => !isCompleted && onDecrement(pokemon.id)}
          disabled={isCompleted}
          aria-label={`\u2212${step}`}
          className="flex items-center justify-center w-14 h-14 2xl:w-18 2xl:h-18 rounded-2xl bg-bg-card border border-border-subtle hover:border-accent-blue/40 hover:bg-accent-blue/5 text-text-muted hover:text-accent-blue transition-all active:scale-95 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          title={`\u2212${step}`}
        >
          {hasCustomStep ? (
            <span className="text-lg font-bold">&minus;{pokemon.step}</span>
          ) : (
            <Minus className="w-7 h-7" />
          )}
        </button>

        <div className="bg-bg-card rounded-3xl px-12 py-6 2xl:px-16 2xl:py-8 text-center border border-border-subtle shadow-lg min-w-72 relative group" aria-live="polite">
          <div className="text-6xl 2xl:text-7xl font-black tabular-nums leading-none tracking-tight text-text-primary">
            {pokemon.encounters.toLocaleString()}
          </div>
          {!isCompleted && (
            <button
              onClick={() => onSetEncounter(pokemon)}
              className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-bg-hover text-text-faint hover:text-text-primary transition-all opacity-0 group-hover:opacity-100"
              title={t("dash.setEncounters")}
              aria-label={t("dash.setEncounters")}
            >
              <Pencil className="w-4 h-4" />
            </button>
          )}
          {!isCompleted && (
            <button
              onClick={() => onReset(pokemon.id)}
              className="mt-3 text-[11px] text-text-muted hover:text-text-secondary transition-colors flex items-center gap-1 mx-auto"
              title={t("tooltip.common.reset")}
            >
              <RotateCcw className="w-3 h-3" />
              {t("tooltip.common.reset")}
            </button>
          )}
        </div>

        <button
          onClick={() => !isCompleted && onIncrement(pokemon.id)}
          disabled={isCompleted}
          aria-label={`+${step}`}
          className="flex items-center justify-center w-18 h-18 2xl:w-22 2xl:h-22 rounded-2xl bg-accent-green hover:bg-accent-green/90 transition-all active:scale-95 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
          title={`+${step}`}
        >
          {hasCustomStep ? (
            <span className="text-2xl font-bold">+{pokemon.step}</span>
          ) : (
            <Plus className="w-9 h-9 stroke-[3px]" />
          )}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 mt-10 w-full max-w-lg mx-auto">
        <div className="bg-bg-card border border-border-subtle shadow-sm rounded-2xl p-4 flex items-center gap-3 hover:border-accent-blue/30 transition-colors">
          <div className="w-10 h-10 rounded-xl bg-accent-blue/10 flex items-center justify-center shrink-0">
            <Zap className="w-5 h-5 text-accent-blue" />
          </div>
          <div>
            <div className="text-text-muted text-[10px] font-bold uppercase tracking-widest">{t("dash.phase") || "Encounter"}</div>
            <div className="text-lg font-black text-text-primary tabular-nums">{pokemon.encounters.toLocaleString()}</div>
          </div>
        </div>
        <div className="bg-bg-card border border-border-subtle shadow-sm rounded-2xl p-4 flex items-center gap-3 hover:border-accent-blue/30 transition-colors" title={t("aria.odds")}>
          <div className="w-10 h-10 rounded-xl bg-accent-purple/10 flex items-center justify-center shrink-0">
            <Target className="w-5 h-5 text-accent-purple" />
          </div>
          <div>
            <div className="text-text-muted text-[10px] font-bold uppercase tracking-widest">{t("dash.odds") || "Odds"}</div>
            <div className="text-lg font-black text-accent-blue tabular-nums">{oddsDisplay}</div>
          </div>
        </div>
      </div>
    </>
  );
}

/** Renders a single import-overlay-from-pokemon button in the import dropdown. */
function OverlayImportItem({ pokemon, onCopy }: Readonly<{ pokemon: Pokemon; onCopy: (id: string) => void }>) {
  const icon = pokemon.sprite_url
    ? <img src={pokemon.sprite_url} alt="" className="w-4 h-4 object-contain" />
    : <div className="w-4 h-4 rounded bg-bg-hover" />;
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
  const [copied, setCopied] = useState(false);
  const baseUrl = apiUrl("") || globalThis.location.origin;
  const url = `${baseUrl}/overlay/${pokemonId}`;

  const copy = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={url}
      aria-label={t("aria.copyObsUrl")}
      className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl bg-bg-card border border-border-subtle hover:border-accent-blue/40 hover:bg-accent-blue/5 text-text-secondary hover:text-accent-blue transition-colors"
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
          <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-green-500/10 text-green-400 border border-green-500/20 shrink-0">
            <Save className="w-3 h-3" />
            {t("overlay.saved")}
          </span>
        )}

        <div className="flex-1" />

        <button
          onClick={() => onModeChange("default")}
          title={t("dash.tooltipOverlayGlobal")}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0 ${
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
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0 ${
            modeBase === "custom"
              ? "bg-purple-500/15 text-purple-400"
              : "text-text-muted hover:text-text-primary hover:bg-bg-hover"
          }`}
        >
          <Pencil className="w-3.5 h-3.5" />
          {t("overlay.modeCustom")}
        </button>

        {modeBase === "custom" && (
          <div className="relative group shrink-0">
            <button className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-bg-primary border border-border-subtle text-text-muted hover:text-text-primary hover:border-accent-blue/30 transition-colors">
              <Download className="w-3.5 h-3.5" />
              {t("overlay.import")}
              <ChevronDown className="w-3 h-3" />
            </button>
            <div className="absolute right-0 top-full mt-1 w-52 bg-bg-secondary border border-border-subtle rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 py-1 max-h-60 overflow-y-auto">
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
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-accent-blue hover:bg-accent-blue/90 text-white font-semibold text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
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
                className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl bg-bg-card border border-border-subtle hover:border-accent-blue/40 hover:bg-accent-blue/5 text-text-secondary hover:text-accent-blue transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                <span className="text-[10px] font-medium">{t("overlay.editGlobal")}</span>
              </Link>
              <button
                type="button"
                onClick={() => onModeChange("custom")}
                className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl bg-bg-card border border-border-subtle hover:border-purple-500/40 hover:bg-purple-500/5 text-text-secondary hover:text-purple-400 transition-colors"
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
      await fetch(apiUrl(`/api/pokemon/${p.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setOverlayDirty(false);
      setOverlaySaved(true);
      setTimeout(() => setOverlaySaved(false), 2000);
    } catch (err) {
      console.error(err);
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

export function Dashboard() {
  const { appState, flashPokemon, detectorStatus, setDetectorStatus, clearDetectorStatus } = useCounterStore();
  const { t } = useI18n();
  const capture = useCaptureService();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingPokemon, setEditingPokemon] = useState<Pokemon | null>(null);
  const [imgError, setImgError] = useState<Record<string, boolean>>({});

  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("active");
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastSelectedIdx = useRef<number | null>(null);
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>(loadSortMode);
  const [sortDir, setSortDir] = useState<SortDir>(loadSortDir);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("encounty-sidebar-collapsed") === "true");
  const [showHuntMenu, setShowHuntMenu] = useState(false);
  const [showHeaderHuntMenu, setShowHeaderHuntMenu] = useState(false);
  const asideRef = useRef<HTMLElement>(null);

  const [viewedPokemonId, setViewedPokemonId] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<PanelTab>("counter");
  const rightPanelTab = panelTab;
  const [pendingTab, setPendingTab] = useState<PanelTab | null>(null);

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

  const games = useGames();

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
    setViewedPokemonId(id);
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
    setShowAddModal(false);
  };
  const handleSavePokemon = async (id: string, data: NewPokemonData) => {
    const p = appState!.pokemon.find((x) => x.id === id);
    const payload = { ...data, overlay: p?.overlay, overlay_mode: p?.overlay_mode, step: data.step };
    await fetch(apiUrl(`/api/pokemon/${id}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setEditingPokemon(null);
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
  const activeHunts = allPokemon.filter((p) => !p.completed_at);
  const archivedHunts = allPokemon.filter((p) => !!p.completed_at);
  const q = searchQuery.trim().toLowerCase();
  const filtered = filterPokemonByQuery(
    sidebarTab === "active" ? activeHunts : archivedHunts,
    q,
  );
  const displayList = sortPokemonList(filtered, sortMode, sortDir);
  const viewedPokemon = findViewedPokemon(allPokemon, viewedPokemonId, appState?.active_id ?? "");
  const totalEncounters = allPokemon.reduce((s, p) => s + p.encounters, 0);
  const oddsDisplay = computeOddsDisplay(viewedPokemon, games);

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
    setFocusedIdx, setSelectedIds, setSearchQuery, handleActivate, bulkDelete,
  });

  // Scroll focused item into view
  useEffect(
    () => scrollFocusedIntoView(focusedIdx, asideRef),
    [focusedIdx],
  );

  if (!appState) return <DashboardLoader label={t("nav.connecting")} />;

  const effectiveViewedId = viewedPokemonId || appState.active_id;
  const activeLanguages = appState.settings.languages ?? ["de", "en"];

  const cardSelectionCtx: CardSelectionContext = {
    displayList, selectedIds, lastSelectedIdx, setSelectedIds, handleActivate,
  };
  const handleCardClick = (e: React.MouseEvent, pokemonId: string, idx: number) =>
    applyCardSelection(e, pokemonId, idx, cardSelectionCtx);

  const handleClearAndAdd = () => {
    setSearchQuery("");
    setShowAddModal(true);
  };
  const handleOpenAdd = () => setShowAddModal(true);

  /** Renders the right main panel when no Pokemon is selected. */
  const renderNoPokemonPanel = () => (
    <div className="flex flex-col items-center justify-center h-full text-center relative z-10 w-full max-w-4xl mx-auto">
      <div className="w-20 h-20 rounded-full bg-bg-card border border-border-subtle flex items-center justify-center mb-6 shadow-sm">
        <Sparkles className="w-8 h-8 text-text-faint" />
      </div>
      <h2 className="text-2xl font-semibold text-text-primary mb-2">
        {t("dash.noActive")}
      </h2>
      <p className="text-text-muted text-sm max-w-xs">
        {t("dash.noActiveHint")}
      </p>
    </div>
  );

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
      onImgError={(id) => setImgError((prev) => ({ ...prev, [id]: true }))}
      onDecrement={handleDecrement}
      onIncrement={handleIncrement}
      onReset={handleReset}
      onSetEncounter={setSetEncounterPokemon}
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
    );

  /** Renders the scrollable inner work area with the active tab content. */
  const renderScrollableContent = (pokemon: Pokemon) =>
    renderWorkArea(rightPanelTab, renderTabContent(pokemon));

  return (
    <div className="flex h-full">
      {/* LEFT: Pokemon sidebar */}
      <aside ref={asideRef} className={`shrink-0 bg-bg-secondary flex flex-col transition-[width] duration-200 overflow-hidden ${sidebarCollapsed ? "w-0" : "w-72 2xl:w-80"}`}>
        {/* Search bar + Sort + Collapse */}
        <div className="p-3 border-b border-border-subtle min-w-72">
          <div className="flex items-center gap-2">
            <div data-focus-wrapper className="flex-1 flex items-center gap-2 bg-bg-primary border border-border-subtle rounded-lg px-3 py-1.5 focus-within:border-accent-blue/50 focus-within:ring-2 focus-within:ring-accent-blue/30 transition-colors">
              <Search className="w-3.5 h-3.5 text-text-muted shrink-0" />
              <input
                ref={searchRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("dash.searchShortcut")}
                className="flex-1 bg-transparent text-text-primary placeholder-text-faint outline-none focus:outline-none focus-visible:outline-none text-xs"
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
                className="p-1.5 rounded-lg bg-bg-primary border border-border-subtle hover:border-accent-blue/40 text-text-muted hover:text-text-primary transition-colors"
                title={t("sidebar.sortBy")}
                aria-label={t("sidebar.sortBy")}
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
              </button>
              {showSortMenu && (
                <>
                  <button className="fixed inset-0 z-40 cursor-default" onClick={() => setShowSortMenu(false)} aria-label={t("aria.close")} />
                  <div className="absolute right-0 top-full mt-1 z-50 bg-bg-secondary border border-border-subtle rounded-lg shadow-lg py-1 min-w-36">
                    {([
                      { mode: "recent" as const, label: t("sidebar.sortRecent") },
                      { mode: "name" as const, label: t("sidebar.sortName") },
                      { mode: "encounters" as const, label: t("sidebar.sortEncounters") },
                      { mode: "game" as const, label: t("sidebar.sortGame") },
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
            {/* Collapse sidebar */}
            <button
              onClick={() => setSidebarCollapsed(true)}
              className="p-1.5 rounded-lg bg-bg-primary border border-border-subtle hover:border-accent-blue/40 text-text-muted hover:text-text-primary transition-colors"
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
                <span className="bg-accent-blue/20 text-accent-blue text-[10px] px-1.5 py-0.5 rounded-full tabular-nums">
                  {activeHunts.length}
                </span>
              )}
            </span>
            {sidebarTab === "active" && (
              <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-accent-blue rounded-full" />
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
                <span className="bg-accent-green/20 text-accent-green text-[10px] px-1.5 py-0.5 rounded-full tabular-nums">
                  {archivedHunts.length}
                </span>
              )}
            </span>
            {sidebarTab === "archived" && (
              <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-accent-green rounded-full" />
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
          totalEncounters={totalEncounters}
          showHuntMenu={showHuntMenu}
          setShowHuntMenu={setShowHuntMenu}
          send={send}
          capture={capture}
          setDetectorStatus={setDetectorStatus}
          clearDetectorStatus={clearDetectorStatus}
          bulkComplete={bulkComplete}
          bulkDelete={bulkDelete}
          setSelectedIds={setSelectedIds}
        />

        {/* Pokémon list */}
        <div className="flex-1 overflow-y-auto">
          {displayList.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-6 text-center">
              <EmptyListPlaceholder query={q} sidebarTab={sidebarTab} onClearAndAdd={handleClearAndAdd} onAdd={handleOpenAdd} />
            </div>
          ) : (
            <ul className="py-1 select-none">
              {displayList.map((p, idx) => {
                const isViewed = p.id === effectiveViewedId;
                const isHotkeyTarget = p.id === appState.active_id;
                const isArchived = !!p.completed_at;
                const isSelected = selectedIds.has(p.id);
                const src = resolveSpriteUrl(p.id, p.sprite_url, imgError);
                const itemBorderClass = sidebarItemBorderClass(isSelected, isViewed);
                const itemClassName = buildSidebarItemClass(
                  itemBorderClass, focusedIdx === idx, isArchived,
                );
                return (
                  <li
                    key={p.id}
                    data-sidebar-idx={idx}
                    className={itemClassName}
                  >
                    <button
                      type="button"
                      onKeyDown={(e) => handleActivateKeyDown(e, p.id, handleActivate)}
                      onClick={(e) => handleCardClick(e, p.id, idx)}
                      className="flex items-center gap-2.5 w-full text-left bg-transparent border-none p-0 cursor-pointer min-w-0"
                    >
                    {/* Sprite */}
                    <div className="w-8 h-8 2xl:w-10 2xl:h-10 shrink-0 relative">
                      <img
                        src={src}
                        alt={p.name}
                        onError={() =>
                          setImgError((prev) => ({ ...prev, [p.id]: true }))
                        }
                        className="pokemon-sprite w-full h-full object-contain"
                      />
                      {isArchived && (
                        <div className="absolute -bottom-0.5 -right-0.5 bg-accent-green rounded-full p-0.5">
                          <Trophy className="w-2 h-2 text-text-primary" />
                        </div>
                      )}
                      {hasDetectorReady(p) && (() => {
                        const { dotClass, title: dotTitle } = resolveDetectorDot(detectorStatus, p.id, t);
                        return (
                        <div
                          className={`absolute -top-0.5 -left-0.5 w-2 h-2 rounded-full border border-bg-secondary ${dotClass}`}
                          title={dotTitle}
                        />
                        );
                      })()}
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <span className="text-[13px] 2xl:text-sm font-semibold text-text-primary truncate block capitalize">
                        {p.name}
                      </span>
                      <div className="flex items-center gap-1.5 mt-0.5 text-[11px] 2xl:text-xs text-text-muted">
                        <span className="tabular-nums shrink-0">{p.encounters.toLocaleString()}</span>
                        {p.game && (
                          <>
                            <span className="text-text-faint">·</span>
                            <span className="truncate">{formatGame(p.game)}</span>
                          </>
                        )}
                      </div>
                    </div>
                    </button>
                    {/* Timer */}
                    <SidebarTimer pokemon={p} send={send} disabled={!!p.completed_at} />
                    {/* Actions (visible on hover) */}
                    <div className="flex gap-0.5 items-center shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          send("set_active", { pokemon_id: p.id });
                        }}
                        className={`p-1 rounded transition-colors ${
                          isHotkeyTarget
                            ? "text-accent-blue"
                            : "opacity-0 group-hover:opacity-100 text-text-faint hover:text-accent-blue"
                        }`}
                        title={isHotkeyTarget ? t("dash.hotkeyTargetActive") : t("dash.hotkeyTarget")}
                      >
                        <Keyboard className={`w-3 h-3 2xl:w-3.5 2xl:h-3.5`} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingPokemon(p);
                        }}
                        className="p-1 rounded text-text-faint hover:text-text-primary transition-colors opacity-0 group-hover:opacity-100"
                        title={t("dash.edit")}
                      >
                        <Pencil className="w-3 h-3 2xl:w-3.5 2xl:h-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Add button */}
        {sidebarTab === "active" && (
          <div className="p-3 border-t border-border-subtle">
            <button
              onClick={() => setShowAddModal(true)}
              title={t("dash.tooltipAddPokemon")}
              className="w-full flex items-center justify-center gap-1.5 py-2 2xl:py-2.5 bg-accent-blue hover:bg-accent-blue/80 text-white rounded-lg text-xs 2xl:text-sm font-semibold transition-colors"
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
                onImgError={(id) => setImgError((prev) => ({ ...prev, [id]: true }))}
                t={t}
              />
            ))}
          </div>
          {sidebarTab === "active" && (
            <>
              <div className="border-t border-border-subtle mx-2" />
              <button
                onClick={() => setShowAddModal(true)}
                className="p-2 mx-auto my-2 text-accent-blue hover:text-white hover:bg-accent-blue rounded-lg transition-colors"
                title={t("dash.addPokemon")}
                aria-label={t("dash.addPokemon")}
              >
                <Plus className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
      )}
      <div className="glow-line-v shrink-0" />

      <main id="main-content" className="flex-1 flex flex-col relative h-full min-h-0 bg-transparent overflow-hidden">

        {viewedPokemon ? (
          <div className="flex flex-col h-full w-full">
            {/* Top Bar (übergeordnet, scrollt nicht mit) */}
            <header className="flex-none px-4 py-2.5 border-b border-border-subtle bg-bg-card z-50 relative grid grid-cols-[1fr_auto_1fr] items-center gap-3">

              {/* Left: Tabs */}
              <div className="flex justify-start">
                <div className="flex bg-bg-card rounded-xl border border-border-subtle p-0.5 shadow-sm">
                  <button
                    onClick={() => setRightPanelTab("counter")}
                    className={tabButtonClass(rightPanelTab === "counter")}
                  >
                    <Tally5 className="w-3.5 h-3.5" />
                    {t("dash.tabCounter")}
                  </button>
                  {!viewedPokemon.completed_at && (
                    <button
                      onClick={() => setRightPanelTab("detector")}
                      className={tabButtonClass(rightPanelTab === "detector")}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      {t("dash.tabDetector")}
                      {detectorStatus[viewedPokemon.id]?.state === "match" && (
                        <span className="w-2 h-2 rounded-full bg-green-400 ml-1.5" />
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => setRightPanelTab("overlay")}
                    className={tabButtonClass(rightPanelTab === "overlay")}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    {t("dash.tabOverlay")}
                  </button>
                  <button
                    onClick={() => setRightPanelTab("statistics")}
                    className={tabButtonClass(rightPanelTab === "statistics")}
                  >
                    <BarChart3 className="w-3.5 h-3.5" />
                    {t("dash.tabStatistics")}
                  </button>
                </div>
              </div>

              {/* Center: Pokemon sprite + name + game badge — always centered via grid */}
              <div className="flex items-center gap-2 justify-center">
                <TrimmedBoxSprite
                  canonicalName={viewedPokemon.canonical_name}
                  spriteType={viewedPokemon.sprite_type}
                  alt={viewedPokemon.name}
                  className="h-10 w-auto"
                  hideOnFail
                />
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-bold text-text-primary leading-tight">{viewedPokemon.name}</span>
                  {viewedPokemon.game && (
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-text-muted leading-tight truncate max-w-28">
                      {formatGame(viewedPokemon.game)}
                    </span>
                  )}
                </div>
              </div>

              {/* Right: Action buttons + Hunt CTA */}
              <div className="flex items-center gap-2 justify-end">

              {/* 1. Edit — common utility action */}
              <button
                onClick={() => setEditingPokemon(viewedPokemon)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-bg-primary border border-border-subtle hover:border-accent-blue/40 text-text-muted hover:text-text-primary text-xs font-semibold transition-colors"
                aria-label={t("dash.edit")}
              >
                <Edit2 className="w-3.5 h-3.5" />
                <span className="hidden xl:inline">{t("dash.edit")}</span>
              </button>

              {/* 2. Delete — destructive */}
              <button
                onClick={() => handleDelete(viewedPokemon.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-bg-primary border border-border-subtle hover:border-accent-red/40 text-text-muted hover:text-accent-red text-xs font-semibold transition-colors"
                aria-label={t("dash.delete")}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden xl:inline">{t("dash.delete")}</span>
              </button>

              {/* 3. Caught / Reactivate — positive state change before CTA */}
              {viewedPokemon.completed_at ? (
                <button
                  onClick={() => handleUncomplete(viewedPokemon.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-bg-primary border border-border-subtle hover:border-accent-yellow/40 text-text-muted hover:text-accent-yellow text-xs font-semibold transition-colors"
                  aria-label={t("dash.reactivate")}
                >
                  <Undo2 className="w-3.5 h-3.5" />
                  <span className="hidden xl:inline">{t("dash.reactivate")}</span>
                </button>
              ) : (
                <button
                  onClick={() => handleComplete(viewedPokemon.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent-green text-white hover:bg-accent-green/90 border border-transparent text-xs font-bold transition-colors"
                  aria-label={t("dash.caught")}
                >
                  <PartyPopper className="w-3.5 h-3.5" />
                  <span className="hidden xl:inline">{t("dash.caught")}</span>
                </button>
              )}

              {/* 4. Hunt start/stop — primary CTA, rightmost */}
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

              </div>
            </header>

            {/* SCROLLABLE INNER WORK AREA — overlay tab uses full height without scroll */}
            {renderScrollableContent(viewedPokemon)}
        </div>
        ) : (
          renderNoPokemonPanel()
        )}
      </main>

      {/* Modals */}
      {showAddModal && (
        <AddPokemonModal
          onAdd={handleAddPokemon}
          onClose={() => setShowAddModal(false)}
          activeLanguages={activeLanguages}
        />
      )}
      {editingPokemon && (
        <EditPokemonModal
          pokemon={editingPokemon}
          onSave={handleSavePokemon}
          onClose={() => setEditingPokemon(null)}
          activeLanguages={activeLanguages}
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
          onSave={(count) => {
            send("set_encounters", { pokemon_id: setEncounterPokemon.id, count });
            setSetEncounterPokemon(null);
          }}
          onClose={() => setSetEncounterPokemon(null)}
        />
      )}

      {/* Unsaved overlay changes — tab switch confirmation */}
      {pendingTab && (
        <div // NOSONAR — backdrop click dismisses unsaved-changes dialog
          className="fixed inset-0 z-90 bg-black/50 backdrop-blur-sm flex items-center justify-center animate-fadeIn"
          onClick={(e) => { if (e.target === e.currentTarget) setPendingTab(null); }}
          onKeyDown={(e) => { if (e.key === "Escape") setPendingTab(null); }}
        >
          <div className="bg-bg-secondary border border-border-subtle rounded-2xl p-8 flex flex-col items-center gap-5 max-w-md mx-4 shadow-2xl">
            <div className="w-14 h-14 rounded-full bg-amber-500/15 flex items-center justify-center">
              <AlertTriangle className="w-7 h-7 text-amber-500" />
            </div>
            <div className="text-center space-y-1.5">
              <p className="text-lg font-semibold text-text-primary">
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
                className="flex-1 px-4 py-2.5 rounded-xl border border-border-subtle text-text-muted hover:bg-bg-hover text-sm font-medium transition-colors"
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
                className="flex-1 px-4 py-2.5 rounded-xl bg-accent-red hover:bg-red-500 text-white text-sm font-semibold transition-colors"
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
