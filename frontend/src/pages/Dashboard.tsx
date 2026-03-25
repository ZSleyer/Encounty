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
  Star,
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
} from "lucide-react";
import { Link } from "react-router";
import { AddPokemonModal, NewPokemonData } from "../components/pokemon/AddPokemonModal";
import { EditPokemonModal } from "../components/pokemon/EditPokemonModal";
import { ConfirmModal } from "../components/shared/ConfirmModal";
import { SetEncounterModal } from "../components/shared/SetEncounterModal";
import { StatisticsPanel } from "../components/shared/StatisticsPanel";
import { DetectorPanel } from "../components/detector/DetectorPanel";
import { isLoopRunning } from "../engine/DetectionLoop";
import { OverlayEditor } from "../components/overlay-editor/OverlayEditor";
import { useCounterStore } from "../hooks/useCounterState";
import { useWebSocket } from "../hooks/useWebSocket";
import { Pokemon, DetectorConfig, OverlaySettings, OverlayMode, GameEntry, AppState } from "../types";
import { useI18n } from "../contexts/I18nContext";
import { resolveOverlay } from "../utils/overlay";
import { SPRITE_FALLBACK } from "../utils/sprites";
import { apiUrl } from "../utils/api";

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
function PokemonTimer({ pokemon, send }: Readonly<{ pokemon: Pokemon; send: (type: string, payload: unknown) => void }>) {
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
          >
            <Pause className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            onClick={() => send("timer_start", { pokemon_id: pokemon.id })}
            className="p-1.5 rounded-lg bg-accent-green/20 hover:bg-accent-green/30 text-accent-green transition-colors"
            title={t("timer.start")}
          >
            <Play className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={() => send("timer_reset", { pokemon_id: pokemon.id })}
          className="p-1.5 rounded-lg bg-bg-card hover:bg-bg-hover text-text-muted hover:text-text-primary border border-border-subtle transition-colors"
          title={t("timer.reset")}
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
function SidebarTimer({ pokemon, send }: Readonly<{ pokemon: Pokemon; send: (type: string, payload: unknown) => void }>) {
  const { t } = useI18n();
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  const isRunning = !!pokemon.timer_started_at;

  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => forceUpdate(), 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  const totalMs = computeTimerMs(pokemon);

  return (
    <div className="flex items-center gap-1 mt-0.5">
      <button
        onClick={(e) => {
          e.stopPropagation();
          send(isRunning ? "timer_stop" : "timer_start", { pokemon_id: pokemon.id });
        }}
        className={`p-0.5 rounded transition-colors ${
          isRunning
            ? "text-accent-green hover:text-accent-yellow"
            : "text-text-faint hover:text-accent-green"
        }`}
        title={isRunning ? t("timer.stop") : t("timer.start")}
      >
        {isRunning ? <Pause className="w-2.5 h-2.5" /> : <Play className="w-2.5 h-2.5" />}
      </button>
      {(isRunning || totalMs > 0) && (
        <span className={`text-[10px] font-mono tabular-nums ${isRunning ? "text-accent-green" : "text-text-faint"}`}>
          {formatTimer(totalMs)}
        </span>
      )}
    </div>
  );
}

function huntButtonClass(anyRunning: boolean, canStart: boolean): string {
  if (anyRunning) return "text-accent-green hover:text-accent-yellow hover:bg-accent-yellow/10";
  if (canStart) return "text-text-muted hover:text-accent-green hover:bg-accent-green/10";
  return "opacity-30 cursor-not-allowed text-text-muted";
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

  const gameGen = pokemon.game
    ? games.find((g) => g.key === pokemon.game)?.generation ?? null
    : null;
  const isOldGen = gameGen !== null && gameGen >= 2 && gameGen <= 5;
  const baseDenom = isOldGen ? 8192 : 4096;

  const ht = pokemon.hunt_type;
  if (!ht || ht === "encounter" || ht === "soft_reset" || ht === "fossil" || ht === "gift") {
    return `1/${baseDenom}`;
  }

  const METHOD_ODDS: Record<string, string> = {
    masuda: "683", radar: "~200", horde: "~820",
    sos: "683", outbreak: `${baseDenom}`, sandwich: "683",
  };
  return `1/${METHOD_ODDS[ht] ?? baseDenom}`;
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
  setRightPanelTab: (tab: "counter" | "detector" | "overlay" | "statistics") => void,
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
  const isMatch = detectorStatus[pokemonId]?.state === "match_active";
  const isRunning = !!detectorStatus[pokemonId];
  if (isMatch) return { dotClass: "bg-accent-green", title: t("detector.stateMatch") };
  if (isRunning) return { dotClass: "bg-accent-blue animate-pulse", title: t("detector.stateIdle") };
  return { dotClass: "bg-text-faint/40", title: t("detector.stopped") };
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
  const { appState, flashPokemon, detectorStatus } = useCounterStore();
  const { t } = useI18n();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingPokemon, setEditingPokemon] = useState<Pokemon | null>(null);
  const [imgError, setImgError] = useState<Record<string, boolean>>({});

  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("active");
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastSelectedIdx = useRef<number | null>(null);
  const [showHuntMenu, setShowHuntMenu] = useState(false);

  const [viewedPokemonId, setViewedPokemonId] = useState<string | null>(null);
  const [rightPanelTab, setRightPanelTab] = useState<"counter" | "detector" | "overlay" | "statistics">("counter");

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

  const { send } = useWebSocket((msg) => {
    const config = buildResetConfirmConfig(
      msg, appState?.pokemon ?? [], t,
      (pokemonId) => send("reset", { pokemon_id: pokemonId }),
    );
    if (config) {
      globalThis.electronAPI?.focusWindow();
      setConfirmConfig(config);
    }
  });

  useFocusShortcut(searchRef);

  // Sync overlay editor state when the viewed Pokemon changes
  useEffect(() => {
    const overlay = resolveCurrentOverlay(appState, viewedPokemonId);
    if (overlay) {
      setCurrentOverlay(overlay);
      setOverlayDirty(false);
    }
  }, [viewedPokemonId, appState?.active_id]);

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

  const handleDetectorConfigChange = async (pokemonId: string, cfg: DetectorConfig | null) => {
    await fetch(apiUrl(`/api/detector/${pokemonId}/config`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg ?? {}),
    });
  };

  // --- Overlay Handlers ---

  /** Update a Pokemon's overlay_mode and optionally its overlay settings. */
  const updatePokemonOverlay = async (
    pokemonId: string,
    mode: OverlayMode,
    overlay: OverlaySettings | null,
  ) => {
    const p = appState!.pokemon.find((x) => x.id === pokemonId);
    if (!p) return;
    setOverlaySaving(true);
    try {
      const payload = {
        name: p.name,
        canonical_name: p.canonical_name,
        sprite_url: p.sprite_url,
        sprite_type: p.sprite_type,
        language: p.language,
        game: p.game,
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

  /** Switch overlay mode for the currently viewed Pokemon. */
  const handleModeChange = async (newMode: "default" | "custom") => {
    if (!viewedPokemon) return;
    await applyOverlayMode(
      newMode, viewedPokemon, appState!, t,
      updatePokemonOverlay, setCurrentOverlay,
    );
  };

  /** Save the current custom overlay for the viewed Pokemon. */
  const saveCurrentOverlay = async () => {
    if (!currentOverlay || !viewedPokemon) return;
    await updatePokemonOverlay(viewedPokemon.id, "custom", currentOverlay);
  };


  /** Copy overlay settings from another Pokemon or default. */
  const copyOverlayFrom = (sourceId: string) => {
    const overlay = resolveCopySource(sourceId, appState!.pokemon, appState!.settings.overlay);
    if (overlay) setCurrentOverlay(overlay);
    setOverlayDirty(true);
  };

  if (!appState) return <DashboardLoader label={t("nav.connecting")} />;

  // --- Derived State ---

  const viewedPokemon =
    appState.pokemon.find((p) => p.id === (viewedPokemonId || appState.active_id)) ?? null;
  const totalEncounters = appState.pokemon.reduce(
    (s, p) => s + p.encounters,
    0,
  );

  const oddsDisplay = computeOddsDisplay(viewedPokemon, games);

  // Split Pokémon into active hunts and archived
  const activeHunts = appState.pokemon.filter((p) => !p.completed_at);
  const archivedHunts = appState.pokemon.filter((p) => !!p.completed_at);

  // Filter by search query
  const q = searchQuery.trim().toLowerCase();
  const displayList = filterPokemonByQuery(
    sidebarTab === "active" ? activeHunts : archivedHunts,
    q,
  );

  const FALLBACK = SPRITE_FALLBACK;

  /** Handle sidebar card clicks with Ctrl/Shift multi-select support. */
  const handleCardClick = (e: React.MouseEvent, pokemonId: string, idx: number) => {
    if (e.ctrlKey || e.metaKey) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(pokemonId)) next.delete(pokemonId);
        else next.add(pokemonId);
        return next;
      });
      lastSelectedIdx.current = idx;
    } else if (e.shiftKey && lastSelectedIdx.current !== null) {
      const from = Math.min(lastSelectedIdx.current, idx);
      const to = Math.max(lastSelectedIdx.current, idx);
      setSelectedIds(prev => {
        const next = new Set(prev);
        for (let i = from; i <= to; i++) next.add(displayList[i].id);
        return next;
      });
    } else {
      if (selectedIds.size > 0) setSelectedIds(new Set());
      handleActivate(pokemonId);
    }
  };

  /** Renders the empty-list placeholder based on current search query and sidebar tab. */
  const renderEmptyList = () => {
    if (q) {
      return (
        <>
          <Search className="w-8 h-8 text-text-faint mb-3" />
          <p className="text-sm text-text-muted">
            {t("dash.noMatch")} &bdquo;{q}&ldquo;
          </p>
          <button
            onClick={() => {
              setSearchQuery("");
              setShowAddModal(true);
            }}
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
            onClick={() => setShowAddModal(true)}
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
  };

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
  const renderImportItem = (p: Pokemon) => {
    const icon = p.sprite_url
      ? <img src={p.sprite_url} alt="" className="w-4 h-4 object-contain" />
      : <div className="w-4 h-4 rounded bg-bg-hover" />;
    return (
      <button
        key={p.id}
        onClick={() => copyOverlayFrom(p.id)}
        className="w-full text-left px-3 py-2 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors flex items-center gap-2"
      >
        {icon}
        {p.name}
      </button>
    );
  };

  /** Renders the overlay editor tab panel content. */
  const renderOverlayTab = (pokemon: Pokemon) => {
    const overlayMode = pokemon.overlay_mode || "default";
    const modeBase = overlayMode === "custom" ? "custom" : "default";

    const saveIcon = overlaySaving
      ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
      : <Save className="w-3.5 h-3.5" />;

    return (
      <div className="w-full h-full flex flex-col min-h-0 px-4 pt-4">
        {/* Toolbar */}
        <div className="flex items-center gap-2 mb-3 shrink-0">
          {/* Mode toggle — two icon buttons */}
          <button
            onClick={() => handleModeChange("default")}
            title={t("dash.tooltipOverlayGlobal")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              modeBase === "default"
                ? "bg-accent-blue/15 text-accent-blue ring-1 ring-accent-blue/30"
                : "text-text-muted hover:text-text-primary hover:bg-bg-hover"
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            Global
          </button>
          <button
            onClick={() => handleModeChange("custom")}
            title={t("dash.tooltipOverlayCustom")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              modeBase === "custom"
                ? "bg-accent-blue/15 text-accent-blue ring-1 ring-accent-blue/30"
                : "text-text-muted hover:text-text-primary hover:bg-bg-hover"
            }`}
          >
            <Pencil className="w-3.5 h-3.5" />
            Eigenes
          </button>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Import dropdown (custom mode only) */}
          {modeBase === "custom" && (
            <div className="relative group">
              <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-text-muted hover:text-text-primary hover:bg-bg-hover border border-border-subtle transition-all">
                <Download className="w-3.5 h-3.5" />
                Importieren
                <ChevronDown className="w-3 h-3" />
              </button>
              <div className="absolute right-0 top-full mt-1 w-52 bg-bg-card border border-border-subtle rounded-xl shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 py-1 max-h-60 overflow-y-auto">
                <button
                  onClick={() => copyOverlayFrom("global")}
                  className="w-full text-left px-3 py-2 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors flex items-center gap-2"
                >
                  <Globe className="w-3.5 h-3.5 text-text-muted" />
                  Globales Layout
                </button>
                {appState?.pokemon
                  .filter((p) => p.id !== pokemon.id && p.overlay)
                  .map(renderImportItem)}
              </div>
            </div>
          )}

          {/* Save status + button (custom mode only) */}
          {modeBase === "custom" && (
            <>
              {overlaySaved && (
                <span className="flex items-center gap-1 text-[11px] text-accent-green">
                  <Save className="w-3 h-3" /> Gespeichert
                </span>
              )}
              <button
                onClick={saveCurrentOverlay}
                disabled={!overlayDirty || overlaySaving}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-blue hover:bg-blue-500 text-white font-semibold text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saveIcon}
                Speichern
              </button>
            </>
          )}
        </div>

        {/* Content */}
        {modeBase === "default" && currentOverlay && (
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center">
            <div className="text-center space-y-3 max-w-sm">
              <Globe className="w-10 h-10 text-text-muted/40 mx-auto" />
              <p className="text-sm text-text-secondary">
                Dieses Pokémon nutzt das <strong>globale Layout</strong>.
              </p>
              <p className="text-xs text-text-muted leading-relaxed">
                Änderungen am globalen Layout gelten für alle Pokémon ohne eigenes Layout.
              </p>
              <Link
                to="/overlay-editor"
                className="inline-flex items-center gap-2 mt-2 px-4 py-2 rounded-lg bg-accent-blue hover:bg-blue-500 text-white text-xs font-semibold transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Globales Layout bearbeiten
              </Link>
            </div>
          </div>
        )}

        {modeBase === "custom" && currentOverlay && (
          <div className="flex-1 min-h-0">
            <OverlayEditor
              settings={currentOverlay}
              activePokemon={pokemon || undefined}
              overlayTargetId={pokemon.id}
              onUpdate={(overlay) => {
                setCurrentOverlay(overlay);
                setOverlayDirty(true);
              }}
              compact
            />
          </div>
        )}
      </div>
    );
  };

  /** Renders the counter tab with sprite, encounter buttons, timer, and stats. */
  const renderCounterTab = (pokemon: Pokemon) => (
    <>
      {/* Archived banner */}
      {pokemon.completed_at && (
        <div className="flex items-center gap-2.5 px-6 py-2 rounded-full bg-accent-green/10 text-accent-green text-sm mb-6 border border-accent-green/30 shadow-sm mt-12">
          <Trophy className="w-4 h-4" />
          <span className="font-bold">{t("dash.caughtBanner")}</span>
          <span className="w-px h-3 bg-accent-green/30" />
          <span className="text-accent-green/80 text-xs font-medium">
            {new Date(pokemon.completed_at).toLocaleDateString(
              "de-DE",
              { day: "2-digit", month: "short", year: "numeric" },
            )}
          </span>
        </div>
      )}

      {/* Solid Card for Sprite */}
      <div className="relative w-full aspect-2/1 max-h-75 mb-8 mt-12 flex items-center justify-center">
        {/* Clean, no-glow sprite container */}
        <div className="relative z-10 p-8 flex flex-col items-center">
          <img
            src={
              imgError[pokemon.id] || !pokemon.sprite_url
                ? FALLBACK
                : pokemon.sprite_url
            }
            alt={pokemon.name}
            onError={() =>
              setImgError((prev) => ({
                ...prev,
                [pokemon.id]: true,
              }))
            }
            className="pokemon-sprite w-56 h-56 2xl:w-64 2xl:h-64 object-contain relative z-10 drop-shadow-xl transition-transform duration-300 hover:scale-110"
          />
        </div>
        {/* Pokemon Name Overlay */}
        <h2 className="absolute -bottom-2 text-4xl 2xl:text-5xl font-black text-text-primary capitalize tracking-wide drop-shadow-md z-20">
          {pokemon.name}
        </h2>
      </div>

      {/* Main Counter Section */}
      <div className="flex items-center gap-6 mt-8 w-full justify-center">
        {/* Minus Button */}
        <button
          onClick={() => !pokemon.completed_at && handleDecrement(pokemon.id)}
          disabled={!!pokemon.completed_at}
          className="flex items-center justify-center w-16 h-16 2xl:w-20 2xl:h-20 rounded-2xl bg-bg-card border border-border-subtle hover:bg-bg-hover text-text-muted hover:text-text-primary transition-all active:scale-95 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          title={`−${pokemon.step && pokemon.step > 1 ? pokemon.step : 1}`}
        >
          {pokemon.step && pokemon.step > 1 ? (
            <span className="text-lg font-bold">−{pokemon.step}</span>
          ) : (
            <Minus className="w-8 h-8" />
          )}
        </button>

        {/* Solid Counter Card */}
        <div className="bg-bg-card rounded-3xl px-16 py-8 2xl:px-20 2xl:py-10 text-center border border-border-subtle shadow-md min-w-85 relative group">
          <div
            className="text-7xl 2xl:text-8xl font-black tabular-nums leading-none tracking-tight text-text-primary"
          >
            {pokemon.encounters.toLocaleString()}
          </div>
          {!pokemon.completed_at && (
            <button
              onClick={() => setSetEncounterPokemon(pokemon)}
              className="absolute top-3 right-3 p-1.5 rounded-lg bg-bg-hover/0 hover:bg-bg-hover text-text-faint hover:text-text-primary transition-all opacity-0 group-hover:opacity-100"
              title={t("dash.setEncounters")}
            >
              <Pencil className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Plus Button */}
        <button
          onClick={() => !pokemon.completed_at && handleIncrement(pokemon.id)}
          disabled={!!pokemon.completed_at}
          className="flex items-center justify-center w-20 h-20 2xl:w-24 2xl:h-24 rounded-2xl bg-accent-green border border-transparent hover:bg-accent-green/90 text-white transition-all active:scale-95 shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
          title={`+${pokemon.step && pokemon.step > 1 ? pokemon.step : 1}`}
        >
          {pokemon.step && pokemon.step > 1 ? (
            <span className="text-2xl font-bold">+{pokemon.step}</span>
          ) : (
            <Plus className="w-10 h-10 stroke-[3px]" />
          )}
        </button>
      </div>

      {/* Reset Button */}
      {!pokemon.completed_at && (
        <button
           onClick={() => handleReset(pokemon.id)}
           className="mt-6 flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-bg-card border border-border-subtle hover:bg-bg-hover text-text-muted hover:text-text-primary transition-all shadow-sm text-xs font-semibold"
         >
           <RotateCcw className="w-4 h-4" />
           Reset Counter
         </button>
      )}

      {/* Per-Pokemon Timer */}
      <PokemonTimer pokemon={pokemon} send={send} />

      {/* Bottom Statistics Cards */}
      <div className="grid grid-cols-2 gap-6 mt-12 w-full max-w-xl mx-auto">
        {/* Encounter */}
        <div className="bg-bg-card border border-border-subtle shadow-sm rounded-2xl p-5 flex flex-col items-center justify-center hover:bg-bg-hover transition-colors">
          <div className="text-text-muted text-[11px] 2xl:text-xs font-bold uppercase tracking-widest mb-1">{t("dash.phase") || "Encounter"}</div>
          <div className="text-xl 2xl:text-2xl font-black text-text-primary">{pokemon.encounters.toLocaleString()}</div>
        </div>
        {/* Odds */}
        <div className="bg-bg-card border border-border-subtle shadow-sm rounded-2xl p-5 flex flex-col items-center justify-center hover:bg-bg-hover transition-colors">
          <div className="text-text-muted text-[11px] 2xl:text-xs font-bold uppercase tracking-widest mb-1">{t("dash.odds") || "Odds"}</div>
          <div className="text-xl 2xl:text-2xl font-black text-accent-blue">
            {oddsDisplay}
          </div>
        </div>
      </div>
    </>
  );

  /** Renders the tab-specific content inside the scrollable work area. */
  const renderTabContent = (pokemon: Pokemon) => {
    if (rightPanelTab === "counter") return renderCounterTab(pokemon);

    if (rightPanelTab === "detector") {
      return (
        <div className="w-full">
          <div className="text-center mb-6">
             <h2 className="text-2xl font-semibold text-text-primary mb-2 flex items-center justify-center gap-2">
                <Eye className="w-6 h-6 text-accent-blue" />
                {t("dash.tabDetector")}: {pokemon.name}
             </h2>
             <p className="text-sm text-text-muted max-w-md mx-auto">
                {t("detector.tabHint")}
             </p>
             <p className="text-xs text-text-faint mt-1 max-w-md mx-auto">
                {t("dash.detectorHint")}
             </p>
          </div>
          <DetectorPanel
            key={pokemon.id}
            pokemon={pokemon}
            onConfigChange={(cfg) => handleDetectorConfigChange(pokemon.id, cfg)}
            isRunning={detectorStatus[pokemon.id] !== undefined || isLoopRunning(pokemon.id)}
            confidence={detectorStatus[pokemon.id]?.confidence ?? 0}
            detectorState={detectorStatus[pokemon.id]?.state ?? "idle"}
          />
        </div>
      );
    }

    if (rightPanelTab === "overlay") {
      return renderOverlayTab(pokemon);
    }

    if (rightPanelTab === "statistics") {
      return (
        <div className="w-full max-w-3xl mx-auto">
          <StatisticsPanel pokemonId={pokemon.id} />
        </div>
      );
    }

    return null;
  };

  /** Renders the scrollable inner work area with the active tab content. */
  const renderScrollableContent = (pokemon: Pokemon) => {
    const overlayOrDefault = rightPanelTab === "overlay" ? "max-w-full mt-0" : "max-w-2xl mt-0 pb-16";
    const innerMaxWidth = rightPanelTab === "counter" ? "max-w-3xl mt-0" : overlayOrDefault;
    const outerOverflow = rightPanelTab === "overlay" ? "overflow-hidden p-0" : "overflow-y-auto p-4 md:p-8";
    const outerJustify = rightPanelTab === "counter" ? "justify-center" : "justify-start";
    const innerHeight = rightPanelTab === "overlay" ? "h-full" : "";

    return (
      <div className={`flex-1 flex flex-col items-center relative z-10 w-full ${outerOverflow} ${outerJustify}`}>
        <div className={`flex flex-col items-center w-full ${innerHeight} ${innerMaxWidth}`}>
          {renderTabContent(pokemon)}
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full">
      {/* LEFT: Pokemon sidebar */}
      <aside className="w-72 2xl:w-80 shrink-0 bg-bg-secondary flex flex-col">
        {/* Search bar */}
        <div className="p-3 border-b border-border-subtle">
          <div className="flex items-center gap-2 bg-bg-primary border border-border-subtle rounded-lg px-3 py-1.5">
            <Search className="w-3.5 h-3.5 text-text-muted shrink-0" />
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("dash.searchShortcut")}
              className="flex-1 bg-transparent text-text-primary placeholder-text-faint outline-none text-xs"
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
        {(() => {
          const sel = selectedIds.size > 0
            ? appState.pokemon.filter(p => selectedIds.has(p.id))
            : activeHunts;
          const hasRunningTimer = sel.some(p => !!p.timer_started_at);
          const withDetector = sel.filter(p => hasDetectorReady(p));
          const hasDetector = withDetector.length > 0;
          const hasRunningDetector = sel.some(p => !!detectorStatus[p.id]);
          const anyRunning = hasRunningTimer || hasRunningDetector;
          const canStart = sel.length > 0;

          const currentMode = (() => {
            const modes = sel.map(p => p.hunt_mode || "both");
            if (modes.every(m => m === "timer")) return "timer";
            if (modes.every(m => m === "detector")) return "detector";
            return "both";
          })();

          const startAll = () => {
            for (const p of sel) {
              const mode = p.hunt_mode || "both";
              if (mode !== "detector" && !p.timer_started_at) send("timer_start", { pokemon_id: p.id });
              if (mode !== "timer" && hasDetectorReady(p) && !detectorStatus[p.id]) {
                void fetch(apiUrl(`/api/detector/${p.id}/start`), { method: "POST" }).catch(() => {});
              }
            }
          };
          const stopAll = () => {
            for (const p of sel) {
              if (p.timer_started_at) send("timer_stop", { pokemon_id: p.id });
              if (detectorStatus[p.id]) void fetch(apiUrl(`/api/detector/${p.id}/stop`), { method: "POST" }).catch(() => {});
            }
          };
          const setHuntMode = (mode: "both" | "timer" | "detector") => {
            for (const p of sel) {
              if (p.hunt_mode !== mode) {
                void fetch(apiUrl(`/api/pokemon/${p.id}`), {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ ...p, hunt_mode: mode }),
                }).catch(() => {});
              }
            }
            setShowHuntMenu(false);
          };

          return (
            <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border-subtle">
              {/* Combined Play / Pause */}
              <div className="relative flex items-center">
                <button
                  disabled={!canStart && !anyRunning}
                  onClick={() => { if (anyRunning) stopAll(); else startAll(); }}
                  className={`p-1.5 rounded-lg transition-colors ${
                    huntButtonClass(anyRunning, canStart)
                  }`}
                  title={anyRunning ? t("sidebar.stopHunt") : t("sidebar.startHunt")}
                >
                  {anyRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={() => setShowHuntMenu((v) => !v)}
                  className="p-0.5 -ml-0.5 text-text-faint hover:text-text-muted transition-colors"
                  title={t("sidebar.both")}
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

              {/* Status indicators */}
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

              {/* Spacer + selection info + total */}
              <div className="flex-1" />
              {selectedIds.size > 0 && (
                <div className="flex items-center gap-1 mr-2">
                  <span className="text-[10px] text-text-faint tabular-nums">{selectedIds.size}</span>
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
        })()}

        {/* Pokémon list */}
        <div className="flex-1 overflow-y-auto">
          {displayList.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-6 text-center">
              {renderEmptyList()}
            </div>
          ) : (
            <ul className="py-1 select-none">
              {displayList.map((p, idx) => {
                const isViewed = p.id === (viewedPokemonId || appState.active_id);
                const isHotkeyTarget = p.id === appState.active_id;
                const isArchived = !!p.completed_at;
                const isSelected = selectedIds.has(p.id);
                const src =
                  imgError[p.id] || !p.sprite_url ? FALLBACK : p.sprite_url;
                let itemBorderClass: string;
                if (isSelected) {
                  itemBorderClass = "bg-accent-blue/15 border-l-2 border-accent-blue";
                } else if (isViewed) {
                  itemBorderClass = "bg-accent-blue/10 border-l-2 border-accent-blue";
                } else {
                  itemBorderClass = "hover:bg-bg-hover border-l-2 border-transparent";
                }
                const itemClassName = `flex items-center gap-3 px-4 py-2.5 2xl:px-5 2xl:py-3 cursor-pointer transition-colors group hover-glow ${itemBorderClass} ${isArchived ? "opacity-70" : ""}`;
                return (
                  <li
                    key={p.id}
                    className={itemClassName}
                  >
                    <button
                      type="button"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleActivate(p.id);
                        }
                      }}
                      onClick={(e) => handleCardClick(e, p.id, idx)}
                      className="flex items-center gap-3 w-full text-left bg-transparent border-none p-0 cursor-pointer"
                    >
                    <div className="w-9 h-9 2xl:w-11 2xl:h-11 shrink-0 relative">
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
                          <Trophy className="w-2.5 h-2.5 text-text-primary" />
                        </div>
                      )}
                      {hasDetectorReady(p) && (() => {
                        const { dotClass, title: dotTitle } = resolveDetectorDot(detectorStatus, p.id, t);
                        return (
                        <div
                          className={`absolute -top-0.5 -left-0.5 w-2 h-2 2xl:w-2.5 2xl:h-2.5 rounded-full border border-bg-secondary ${dotClass}`}
                          title={dotTitle}
                        />
                        );
                      })()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm 2xl:text-base font-semibold text-text-primary truncate capitalize">
                          {p.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-xs 2xl:text-sm text-text-muted tabular-nums">
                          {p.encounters} {t("dash.enc")}
                        </span>
                        {p.game && (
                          <span className="text-[10px] text-text-faint uppercase">
                            {formatGame(p.game)}
                          </span>
                        )}
                      </div>
                    </div>
                    </button>
                      <SidebarTimer pokemon={p} send={send} />
                    <div className="flex gap-1 items-center">
                      {/* Hotkey target star — sets active_id (hotkey target) */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          send("set_active", { pokemon_id: p.id });
                        }}
                        className={`p-1 rounded transition-colors ${
                          isHotkeyTarget
                            ? "text-accent-yellow"
                            : "opacity-0 group-hover:opacity-100 text-text-muted hover:text-accent-yellow"
                        }`}
                        title={isHotkeyTarget ? t("dash.hotkeyTargetActive") : t("dash.hotkeyTarget")}
                      >
                        <Star className={`w-3.5 h-3.5 2xl:w-4 2xl:h-4 ${isHotkeyTarget ? "fill-accent-yellow" : ""}`} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingPokemon(p);
                        }}
                        className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors opacity-0 group-hover:opacity-100"
                        title={t("dash.edit")}
                      >
                        <Edit2 className="w-3.5 h-3.5" />
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
              className="w-full flex items-center justify-center gap-1.5 py-2 2xl:py-2.5 bg-accent-blue hover:bg-accent-blue/80 text-white rounded-lg text-xs 2xl:text-sm font-semibold transition-colors hover-glow"
            >
              <Plus className="w-3.5 h-3.5" />
              {t("dash.addPokemon")}
            </button>
          </div>
        )}
      </aside>
      <div className="glow-line-v shrink-0" />

      <main className="flex-1 flex flex-col relative h-full min-h-0 bg-transparent overflow-hidden">

        {viewedPokemon ? (
          <div className="flex flex-col h-full w-full">
            {/* Top Bar (übergeordnet, scrollt nicht mit) */}
            <header className="flex-none px-6 md:px-8 py-5 flex flex-wrap items-center justify-between gap-4 border-b border-border-subtle bg-bg-card z-50 relative shadow-md">
              
              {/* Left: Tabs */}
              <div className="flex-[1_1_auto] md:flex-1 flex justify-start min-w-0 order-2 md:order-1">
                <div className="flex bg-bg-card rounded-xl border border-border-subtle p-1 shadow-sm shrink-0">
                  <button
                    onClick={() => setRightPanelTab("counter")}
                    className={`px-6 py-1.5 2xl:px-7 2xl:py-2 rounded-lg text-xs 2xl:text-sm font-semibold transition-all ${
                      rightPanelTab === "counter"
                        ? "bg-accent-blue text-white shadow"
                        : "text-text-muted hover:text-text-primary hover:bg-bg-hover"
                    }`}
                  >
                    {t("dash.tabCounter")}
                  </button>
                  {!viewedPokemon.completed_at && (
                    <button
                      onClick={() => setRightPanelTab("detector")}
                      className={`px-6 py-1.5 2xl:px-7 2xl:py-2 rounded-lg text-xs 2xl:text-sm font-semibold transition-all flex items-center gap-1.5 ${
                        rightPanelTab === "detector"
                          ? "bg-accent-blue text-white shadow"
                          : "text-text-muted hover:text-text-primary hover:bg-bg-hover"
                      }`}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      {t("dash.tabDetector")}
                      {detectorStatus[viewedPokemon.id]?.state === "match_active" && (
                        <span className="w-2 h-2 rounded-full bg-green-400 ml-1.5" />
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => setRightPanelTab("overlay")}
                    className={`px-6 py-1.5 2xl:px-7 2xl:py-2 rounded-lg text-xs 2xl:text-sm font-semibold transition-all flex items-center gap-1.5 ${
                      rightPanelTab === "overlay"
                        ? "bg-accent-blue text-white shadow"
                        : "text-text-muted hover:text-text-primary hover:bg-bg-hover"
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    {t("dash.tabOverlay")}
                  </button>
                  <button
                    onClick={() => setRightPanelTab("statistics")}
                    className={`px-6 py-1.5 2xl:px-7 2xl:py-2 rounded-lg text-xs 2xl:text-sm font-semibold transition-all flex items-center gap-1.5 ${
                      rightPanelTab === "statistics"
                        ? "bg-accent-blue text-white shadow"
                        : "text-text-muted hover:text-text-primary hover:bg-bg-hover"
                    }`}
                  >
                    <BarChart3 className="w-3.5 h-3.5" />
                    {t("dash.tabStatistics")}
                  </button>
                </div>
              </div>

              {/* Center: Game Badge */}
              <div className="flex shrink-0 items-center justify-center order-1 w-full md:w-auto md:order-2">
                {viewedPokemon.game && (
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-bg-card border border-border-subtle shadow-sm text-text-muted">
                    <Gamepad2 className="w-4 h-4" />
                    <span className="text-xs uppercase tracking-wider font-semibold truncate max-w-30 md:max-w-none">
                      {formatGame(viewedPokemon.game)}
                    </span>
                  </div>
                )}
              </div>

              {/* Right: Action row (Edit / Catch / Delete) */}
              <div className="flex-[1_1_auto] md:flex-1 flex justify-end gap-2 shrink-0 order-3 md:order-3">
                <button
                  onClick={() => setEditingPokemon(viewedPokemon)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-bg-card border border-border-subtle shadow-sm hover:border-accent-blue/40 text-text-muted hover:text-text-primary text-xs font-semibold transition-all hover:bg-bg-hover"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  {t("dash.edit")}
                </button>

                {viewedPokemon.completed_at ? (
                  <button
                    onClick={() => handleUncomplete(viewedPokemon.id)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-bg-card border border-border-subtle hover:border-accent-yellow/40 text-text-muted hover:text-accent-yellow text-xs font-semibold shadow-sm transition-all hover:bg-bg-hover"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                    {t("dash.reactivate")}
                  </button>
                ) : (
                  <button
                    onClick={() => handleComplete(viewedPokemon.id)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-accent-green text-white shadow-sm hover:bg-accent-green/90 border border-transparent text-xs font-bold transition-all"
                  >
                    <PartyPopper className="w-3.5 h-3.5" />
                    {t("dash.caught")}
                  </button>
                )}

                <button
                  onClick={() => handleDelete(viewedPokemon.id)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-bg-card border border-border-subtle shadow-sm hover:border-accent-red/40 text-text-muted hover:text-accent-red text-xs font-semibold transition-all hover:bg-bg-hover"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {t("dash.delete")}
                </button>
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
          activeLanguages={appState.settings.languages ?? ["de", "en"]}
        />
      )}
      {editingPokemon && (
        <EditPokemonModal
          pokemon={editingPokemon}
          onSave={handleSavePokemon}
          onClose={() => setEditingPokemon(null)}
          activeLanguages={appState.settings.languages ?? ["de", "en"]}
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
    </div>
  );
}
