/**
 * Dashboard.tsx — Main counter UI.
 *
 * Displays a split layout: a left sidebar lists all tracked Pokémon and an
 * optional search/filter, while the right panel shows detailed controls for
 * the active Pokémon (increment, decrement, reset, complete/delete).
 * Counter actions are sent over WebSocket for immediate multi-tab sync.
 */
import { useState, useEffect, useRef, useMemo } from "react";
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
  EyeOff,
  Layers,
  Save,
  RefreshCw,
  Keyboard,
  ExternalLink,
  Download,
  ChevronDown,
  Globe,
  Pencil,
  Play,
  Pause,
  Timer,
  BarChart3,
} from "lucide-react";
import { Link } from "react-router";
import { AddPokemonModal, NewPokemonData } from "../components/AddPokemonModal";
import { EditPokemonModal } from "../components/EditPokemonModal";
import { ConfirmModal } from "../components/ConfirmModal";
import { SetEncounterModal } from "../components/SetEncounterModal";
import { StatisticsPanel } from "../components/StatisticsPanel";
import { DetectorPanel } from "../components/DetectorPanel";
import { OverlayEditor } from "../components/OverlayEditor";
import { useCounterStore, DetectorStatusEntry } from "../hooks/useCounterState";
import { useWebSocket } from "../hooks/useWebSocket";
import { Pokemon, DetectorConfig, DetectorRect, OverlaySettings, OverlayMode } from "../types";
import { useI18n } from "../contexts/I18nContext";
import { useToast } from "../contexts/ToastContext";
import { resolveOverlay } from "../utils/overlay";

const API = "/api";

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
function PokemonTimer({ pokemon, send }: { readonly pokemon: Pokemon; readonly send: (type: string, payload: unknown) => void }) {
  const { t } = useI18n();
  const [, setTick] = useState(0);
  const isRunning = !!pokemon.timer_started_at;

  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  return (
    <div className="flex items-center gap-3 mt-6">
      <Timer className="w-4 h-4 text-text-muted" />
      <span className="text-lg font-mono tabular-nums text-text-primary">{formatTimer(computeTimerMs(pokemon))}</span>
      <div className="flex gap-1.5">
        {!isRunning ? (
          <button
            onClick={() => send("timer_start", { pokemon_id: pokemon.id })}
            className="p-1.5 rounded-lg bg-accent-green/20 hover:bg-accent-green/30 text-accent-green transition-colors"
            title={t("timer.start")}
          >
            <Play className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            onClick={() => send("timer_stop", { pokemon_id: pokemon.id })}
            className="p-1.5 rounded-lg bg-accent-yellow/20 hover:bg-accent-yellow/30 text-accent-yellow transition-colors"
            title={t("timer.stop")}
          >
            <Pause className="w-3.5 h-3.5" />
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

/** SidebarTimer shows a compact timer + play/pause in the sidebar Pokemon list. */
function SidebarTimer({ pokemon, send }: { readonly pokemon: Pokemon; readonly send: (type: string, payload: unknown) => void }) {
  const { t } = useI18n();
  const [, setTick] = useState(0);
  const isRunning = !!pokemon.timer_started_at;

  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setTick(n => n + 1), 1000);
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

type SidebarTab = "active" | "archived";

export function Dashboard() {
  const { appState, isConnected, flashPokemon, detectorStatus } = useCounterStore();
  const { t } = useI18n();
  const { push: pushToast } = useToast();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingPokemon, setEditingPokemon] = useState<Pokemon | null>(null);
  const [imgError, setImgError] = useState<Record<string, boolean>>({});

  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("active");
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastSelectedIdx = useRef<number | null>(null);

  const [viewedPokemonId, setViewedPokemonId] = useState<string | null>(null);
  const [rightPanelTab, setRightPanelTab] = useState<"counter" | "detector" | "overlay" | "statistics">("counter");

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

  const { send } = useWebSocket((msg) => {
    if (msg.type === "request_reset_confirm") {
      window.electronAPI?.focusWindow();
      const payload = msg.payload as { pokemon_id: string };
      const pokemon = appState?.pokemon.find(
        (p) => p.id === payload.pokemon_id,
      );
      setConfirmConfig({
        isOpen: true,
        title: t("confirm.resetTitle"),
        message: `${t("confirm.resetMsg")}${pokemon ? ` (${pokemon.name})` : ""}`,
        isDestructive: true,
        onConfirm: () => send("reset", { pokemon_id: payload.pokemon_id }),
      });
    }
  });

  // Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Sync overlay editor state when the viewed Pokemon changes
  useEffect(() => {
    if (!appState) return;
    const viewed = appState.pokemon.find(
      (p) => p.id === (viewedPokemonId || appState.active_id),
    );
    if (!viewed) return;
    const mode = viewed.overlay_mode || "default";
    if (mode === "custom" && viewed.overlay) {
      setCurrentOverlay(viewed.overlay);
    } else {
      setCurrentOverlay(
        resolveOverlay(viewed, appState.pokemon, appState.settings.overlay),
      );
    }
    setOverlayDirty(false);
  }, [viewedPokemonId, appState?.active_id]);

  // Pause/resume hotkeys when switching to/from overlay tab
  useEffect(() => {
    if (rightPanelTab === "overlay") {
      fetch("/api/hotkeys/pause", { method: "POST" }).catch(() => {});
    } else {
      fetch("/api/hotkeys/resume", { method: "POST" }).catch(() => {});
    }
  }, [rightPanelTab]);

  // Force counter tab if the viewed pokemon gets archived while on detector tab
  useEffect(() => {
    const viewed = appState?.pokemon.find((p) => p.id === (viewedPokemonId || appState?.active_id));
    if (viewed?.completed_at && rightPanelTab === "detector") {
      setRightPanelTab("counter");
    }
  }, [appState?.pokemon, viewedPokemonId, appState?.active_id, rightPanelTab]);

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
  const handleActivate = (id: string) => setViewedPokemonId(id);
  const handleDelete = (id: string) => {
    setConfirmConfig({
      isOpen: true,
      title: t("confirm.deleteTitle"),
      message: t("confirm.deleteMsg"),
      isDestructive: true,
      onConfirm: async () => {
        await fetch(`${API}/pokemon/${id}`, { method: "DELETE" });
      },
    });
  };
  const handleComplete = async (id: string) => {
    await fetch(`${API}/pokemon/${id}/complete`, { method: "POST" });
  };
  const handleUncomplete = async (id: string) => {
    await fetch(`${API}/pokemon/${id}/uncomplete`, { method: "POST" });
  };
  const handleAddPokemon = async (data: NewPokemonData) => {
    await fetch(`${API}/pokemon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setShowAddModal(false);
  };
  const handleSavePokemon = async (id: string, data: NewPokemonData) => {
    const p = appState!.pokemon.find((x) => x.id === id);
    const payload = { ...data, overlay: p?.overlay, overlay_mode: p?.overlay_mode, step: data.step };
    await fetch(`${API}/pokemon/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setEditingPokemon(null);
  };

  const handleDetectorConfigChange = async (pokemonId: string, cfg: DetectorConfig | null) => {
    await fetch(`${API}/detector/${pokemonId}/config`, {
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
      await fetch(`/api/pokemon/${p.id}`, {
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
    const currentMode = viewedPokemon.overlay_mode || "default";

    // Warn when leaving custom mode
    if (currentMode === "custom" && newMode !== "custom") {
      if (!confirm(t("overlay.confirmModeChange"))) return;
    }

    if (newMode === "default") {
      await updatePokemonOverlay(viewedPokemon.id, "default", null);
      setCurrentOverlay(appState!.settings.overlay);
    } else if (newMode === "custom") {
      // Initialize custom overlay from current resolved settings
      const resolved = resolveOverlay(
        viewedPokemon,
        appState!.pokemon,
        appState!.settings.overlay,
      );
      setCurrentOverlay(resolved);
      await updatePokemonOverlay(viewedPokemon.id, "custom", resolved);
    }
  };

  /** Save the current custom overlay for the viewed Pokemon. */
  const saveCurrentOverlay = async () => {
    if (!currentOverlay || !viewedPokemon) return;
    await updatePokemonOverlay(viewedPokemon.id, "custom", currentOverlay);
  };


  /** Copy overlay settings from another Pokemon or default. */
  const copyOverlayFrom = (sourceId: string) => {
    if (sourceId === "global") {
      setCurrentOverlay(appState!.settings.overlay);
    } else {
      const p = appState!.pokemon.find((x) => x.id === sourceId);
      if (p) {
        const resolved = resolveOverlay(
          p,
          appState!.pokemon,
          appState!.settings.overlay,
        );
        setCurrentOverlay(resolved);
      }
    }
    setOverlayDirty(true);
  };

  if (!appState) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-accent-blue border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-text-muted">{t("nav.connecting")}</p>
        </div>
      </div>
    );
  }

  // --- Derived State ---

  const viewedPokemon =
    appState.pokemon.find((p) => p.id === (viewedPokemonId || appState.active_id)) ?? null;
  const totalEncounters = appState.pokemon.reduce(
    (s, p) => s + p.encounters,
    0,
  );

  const HUNT_ODDS: Record<string, string> = {
    encounter: "4096", soft_reset: "4096", fossil: "4096", gift: "4096",
    radar: "~200", horde: "~820", sos: "683", masuda: "683",
    outbreak: "4096", sandwich: "683",
  };
  const oddsDisplay = (() => {
    if (!viewedPokemon) return "1/4096";
    if (viewedPokemon.hunt_type && HUNT_ODDS[viewedPokemon.hunt_type]) {
      return `1/${HUNT_ODDS[viewedPokemon.hunt_type]}`;
    }
    const oldGen = /red|blue|yellow|gold|silver|crystal|ruby|sapphire|emerald|firered|leafgreen|diamond|pearl|platinum|heartgold|soulsilver|black|white/.test(viewedPokemon.game ?? "");
    return oldGen ? "1/8192" : "1/4096";
  })();

  // Split Pokémon into active hunts and archived
  const activeHunts = appState.pokemon.filter((p) => !p.completed_at);
  const archivedHunts = appState.pokemon.filter((p) => !!p.completed_at);

  // Filter by search query
  const q = searchQuery.trim().toLowerCase();
  const filterPokemon = (list: Pokemon[]) =>
    q
      ? list.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.canonical_name.toLowerCase().includes(q) ||
            (p.game && p.game.toLowerCase().includes(q)),
        )
      : list;

  const displayList = filterPokemon(
    sidebarTab === "active" ? activeHunts : archivedHunts,
  );

  const formatGame = (game: string) =>
    game
      ? game.replace("pokemon-", "").replace("letsgo", "L.G. ").toUpperCase()
      : "—";

  const FALLBACK = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='40' fill='%23333'/><text y='.9em' font-size='60' x='50%' text-anchor='middle' dominant-baseline='middle'>?</text></svg>`;

  return (
    <div className="flex h-full">
      {/* LEFT: Pokemon sidebar */}
      <aside className="w-72 2xl:w-80 shrink-0 bg-bg-secondary flex flex-col">
        {/* Stats bar */}
        <div className="flex items-center justify-between px-4 py-2 2xl:py-2.5 border-b border-border-subtle text-[11px] 2xl:text-xs text-text-muted glass-card rounded-none border-x-0 border-t-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Zap className="w-3 h-3 text-accent-yellow" />
              <span className="tabular-nums">{totalEncounters}</span>
              <span>{t("dash.total")}</span>
            </div>
          </div>
          {activeHunts.length > 0 && (() => {
            const anyRunning = activeHunts.some(p => !!p.timer_started_at);
            return (
              <button
                onClick={() => {
                  const action = anyRunning ? "timer_stop" : "timer_start";
                  for (const p of activeHunts) {
                    if (anyRunning ? !!p.timer_started_at : !p.timer_started_at) {
                      send(action, { pokemon_id: p.id });
                    }
                  }
                }}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-md transition-colors ${
                  anyRunning
                    ? "text-accent-green hover:text-accent-yellow hover:bg-accent-yellow/10"
                    : "text-text-faint hover:text-accent-green hover:bg-accent-green/10"
                }`}
                title={anyRunning ? t("timer.stopAll") : t("timer.startAll")}
              >
                {anyRunning ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                <Timer className="w-3 h-3" />
              </button>
            );
          })()}
        </div>

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
          const hasStoppedTimer = sel.some(p => !p.timer_started_at);
          const withDetector = sel.filter(p => p.detector_config?.templates?.length);
          const hasDetector = withDetector.length > 0;
          const hasRunningDetector = sel.some(p => detectorStatus[p.id]);
          const dis = "opacity-30 cursor-not-allowed";
          return (
            <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border-subtle">
              {/* Timer start */}
              <button
                disabled={!hasStoppedTimer}
                onClick={() => { for (const p of sel) if (!p.timer_started_at) send("timer_start", { pokemon_id: p.id }); }}
                className={`p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors ${!hasStoppedTimer ? dis : ""}`}
                title={t("timer.startAll")}
              >
                <Play className="w-3.5 h-3.5" />
              </button>
              {/* Timer stop */}
              <button
                disabled={!hasRunningTimer}
                onClick={() => { for (const p of sel) if (p.timer_started_at) send("timer_stop", { pokemon_id: p.id }); }}
                className={`p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors ${!hasRunningTimer ? dis : ""}`}
                title={t("timer.stopAll")}
              >
                <Pause className="w-3.5 h-3.5" />
              </button>

              <div className="w-px h-4 bg-border-subtle mx-0.5" />

              {/* Detector start */}
              <button
                disabled={!hasDetector}
                onClick={() => {
                  if (selectedIds.size > 0) {
                    const uncfg = sel.filter(p => !p.detector_config?.templates?.length);
                    if (uncfg.length > 0) {
                      pushToast({ type: "info", title: t("detector.notConfigured"), message: uncfg.map(p => p.name).join(", ") });
                    }
                  }
                  for (const p of withDetector) fetch(`/api/detector/${p.id}/start`, { method: "POST" }).catch(() => {});
                }}
                className={`p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors ${!hasDetector ? dis : ""}`}
                title={t("detector.startSelected")}
              >
                <Eye className="w-3.5 h-3.5" />
              </button>
              {/* Detector stop */}
              <button
                disabled={!hasRunningDetector}
                onClick={() => { for (const p of sel) fetch(`/api/detector/${p.id}/stop`, { method: "POST" }).catch(() => {}); }}
                className={`p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors ${!hasRunningDetector ? dis : ""}`}
                title={t("detector.stopSelected")}
              >
                <EyeOff className="w-3.5 h-3.5" />
              </button>

              {/* Spacer + selection info */}
              <div className="flex-1" />
              {selectedIds.size > 0 && (
                <div className="flex items-center gap-1">
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
            </div>
          );
        })()}

        {/* Pokémon list */}
        <div className="flex-1 overflow-y-auto">
          {displayList.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-6 text-center">
              {q ? (
                <>
                  <Search className="w-8 h-8 text-text-faint mb-3" />
                  <p className="text-sm text-text-muted">
                    {t("dash.noMatch")} „{q}"
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
              ) : sidebarTab === "active" ? (
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
              ) : (
                <>
                  <Trophy className="w-10 h-10 text-text-faint mb-3" />
                  <p className="text-sm text-text-muted">
                    {t("dash.noArchive")}
                  </p>
                  <p className="text-xs text-text-faint mt-1">
                    {t("dash.noArchiveHint")}
                  </p>
                </>
              )}
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
                return (
                  <li
                    key={p.id}
                    onClick={(e) => {
                      if (e.ctrlKey || e.metaKey) {
                        // Ctrl+Click: toggle single item
                        setSelectedIds(prev => {
                          const next = new Set(prev);
                          if (next.has(p.id)) next.delete(p.id);
                          else next.add(p.id);
                          return next;
                        });
                        lastSelectedIdx.current = idx;
                      } else if (e.shiftKey && lastSelectedIdx.current !== null) {
                        // Shift+Click: range select
                        const from = Math.min(lastSelectedIdx.current, idx);
                        const to = Math.max(lastSelectedIdx.current, idx);
                        setSelectedIds(prev => {
                          const next = new Set(prev);
                          for (let i = from; i <= to; i++) next.add(displayList[i].id);
                          return next;
                        });
                      } else {
                        // Normal click: activate pokemon, clear selection
                        if (selectedIds.size > 0) setSelectedIds(new Set());
                        handleActivate(p.id);
                      }
                    }}
                    className={`flex items-center gap-3 px-4 py-2.5 2xl:px-5 2xl:py-3 cursor-pointer transition-colors group hover-glow ${
                      isSelected
                        ? "bg-accent-blue/15 border-l-2 border-accent-blue"
                        : isViewed
                          ? "bg-accent-blue/10 border-l-2 border-accent-blue"
                          : "hover:bg-bg-hover border-l-2 border-transparent"
                    } ${isArchived ? "opacity-70" : ""}`}
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
                      {p.detector_config && (
                        <div
                          className={`absolute -top-0.5 -left-0.5 w-2 h-2 2xl:w-2.5 2xl:h-2.5 rounded-full border border-bg-secondary ${
                            detectorStatus[p.id]?.state === "match_active"
                              ? "bg-accent-green"
                              : p.detector_config.enabled && detectorStatus[p.id]
                                ? "bg-accent-blue animate-pulse"
                                : "bg-text-faint/40"
                          }`}
                          title={
                            detectorStatus[p.id]?.state === "match_active"
                              ? t("detector.stateMatch")
                              : p.detector_config.enabled && detectorStatus[p.id]
                                ? t("detector.stateIdle")
                                : t("detector.stopped")
                          }
                        />
                      )}
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
                      <SidebarTimer pokemon={p} send={send} />
                    </div>
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

        {!viewedPokemon ? (
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
        ) : (
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
                    <span className="text-xs uppercase tracking-wider font-semibold truncate max-w-[120px] md:max-w-none">
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

                {!viewedPokemon.completed_at ? (
                  <button
                    onClick={() => handleComplete(viewedPokemon.id)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-accent-green text-white shadow-sm hover:bg-accent-green/90 border border-transparent text-xs font-bold transition-all"
                  >
                    <PartyPopper className="w-3.5 h-3.5" />
                    {t("dash.caught")}
                  </button>
                ) : (
                  <button
                    onClick={() => handleUncomplete(viewedPokemon.id)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-bg-card border border-border-subtle hover:border-accent-yellow/40 text-text-muted hover:text-accent-yellow text-xs font-semibold shadow-sm transition-all hover:bg-bg-hover"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                    {t("dash.reactivate")}
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
            <div className={`flex-1 flex flex-col items-center relative z-10 w-full ${rightPanelTab === "overlay" ? "overflow-hidden p-0" : "overflow-y-auto p-4 md:p-8"} ${rightPanelTab === "counter" ? "justify-center" : "justify-start"}`}>


              <div className={`flex flex-col items-center w-full ${rightPanelTab === "overlay" ? "h-full" : ""} ${rightPanelTab === "counter" ? "max-w-3xl mt-0" : rightPanelTab === "overlay" ? "max-w-full mt-0" : "max-w-2xl mt-0 pb-16"}`}>
              
              {rightPanelTab === "counter" ? (
                <>
                  {/* Archived banner */}
                  {viewedPokemon.completed_at && (
                    <div className="flex items-center gap-2.5 px-6 py-2 rounded-full bg-accent-green/10 text-accent-green text-sm mb-6 border border-accent-green/30 shadow-sm mt-12">
                      <Trophy className="w-4 h-4" />
                      <span className="font-bold">{t("dash.caughtBanner")}</span>
                      <span className="w-px h-3 bg-accent-green/30" />
                      <span className="text-accent-green/80 text-xs font-medium">
                        {new Date(viewedPokemon.completed_at).toLocaleDateString(
                          "de-DE",
                          { day: "2-digit", month: "short", year: "numeric" },
                        )}
                      </span>
                    </div>
                  )}

                  {/* Solid Card for Sprite */}
                  <div className="relative w-full aspect-2/1 max-h-[300px] mb-8 mt-12 flex items-center justify-center">
                    {/* Clean, no-glow sprite container */}
                    <div className="relative z-10 p-8 flex flex-col items-center">
                      <img
                        src={
                          imgError[viewedPokemon.id] || !viewedPokemon.sprite_url
                            ? FALLBACK
                            : viewedPokemon.sprite_url
                        }
                        alt={viewedPokemon.name}
                        onError={() =>
                          setImgError((prev) => ({
                            ...prev,
                            [viewedPokemon.id]: true,
                          }))
                        }
                        className="pokemon-sprite w-56 h-56 2xl:w-64 2xl:h-64 object-contain relative z-10 drop-shadow-xl transition-transform duration-300 hover:scale-110"
                      />
                    </div>
                    {/* Pokemon Name Overlay */}
                    <h2 className="absolute -bottom-2 text-4xl 2xl:text-5xl font-black text-text-primary capitalize tracking-wide drop-shadow-md z-20">
                      {viewedPokemon.name}
                    </h2>
                  </div>

                  {/* Main Counter Section */}
                  <div className="flex items-center gap-6 mt-8 w-full justify-center">
                    {/* Minus Button */}
                    <button
                      onClick={() => !viewedPokemon.completed_at && handleDecrement(viewedPokemon.id)}
                      disabled={!!viewedPokemon.completed_at}
                      className="flex items-center justify-center w-16 h-16 2xl:w-20 2xl:h-20 rounded-2xl bg-bg-card border border-border-subtle hover:bg-bg-hover text-text-muted hover:text-text-primary transition-all active:scale-95 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      title={`−${viewedPokemon.step && viewedPokemon.step > 1 ? viewedPokemon.step : 1}`}
                    >
                      {viewedPokemon.step && viewedPokemon.step > 1 ? (
                        <span className="text-lg font-bold">−{viewedPokemon.step}</span>
                      ) : (
                        <Minus className="w-8 h-8" />
                      )}
                    </button>

                    {/* Solid Counter Card */}
                    <div className="bg-bg-card rounded-3xl px-16 py-8 2xl:px-20 2xl:py-10 text-center border border-border-subtle shadow-md min-w-[340px] relative group">
                      <div
                        className="text-7xl 2xl:text-8xl font-black tabular-nums leading-none tracking-tight text-text-primary"
                      >
                        {viewedPokemon.encounters.toLocaleString()}
                      </div>
                      {!viewedPokemon.completed_at && (
                        <button
                          onClick={() => setSetEncounterPokemon(viewedPokemon)}
                          className="absolute top-3 right-3 p-1.5 rounded-lg bg-bg-hover/0 hover:bg-bg-hover text-text-faint hover:text-text-primary transition-all opacity-0 group-hover:opacity-100"
                          title={t("dash.setEncounters")}
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    {/* Plus Button */}
                    <button
                      onClick={() => !viewedPokemon.completed_at && handleIncrement(viewedPokemon.id)}
                      disabled={!!viewedPokemon.completed_at}
                      className="flex items-center justify-center w-20 h-20 2xl:w-24 2xl:h-24 rounded-2xl bg-accent-green border border-transparent hover:bg-accent-green/90 text-white transition-all active:scale-95 shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                      title={`+${viewedPokemon.step && viewedPokemon.step > 1 ? viewedPokemon.step : 1}`}
                    >
                      {viewedPokemon.step && viewedPokemon.step > 1 ? (
                        <span className="text-2xl font-bold">+{viewedPokemon.step}</span>
                      ) : (
                        <Plus className="w-10 h-10 stroke-[3px]" />
                      )}
                    </button>
                  </div>

                  {/* Reset Button */}
                  {!viewedPokemon.completed_at && (
                    <button
                       onClick={() => handleReset(viewedPokemon.id)}
                       className="mt-6 flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-bg-card border border-border-subtle hover:bg-bg-hover text-text-muted hover:text-text-primary transition-all shadow-sm text-xs font-semibold"
                     >
                       <RotateCcw className="w-4 h-4" />
                       Reset Counter
                     </button>
                  )}

                  {/* Per-Pokemon Timer */}
                  <PokemonTimer pokemon={viewedPokemon} send={send} />

                  {/* Bottom Statistics Cards */}
                  <div className="grid grid-cols-2 gap-6 mt-12 w-full max-w-xl mx-auto">
                    {/* Encounter */}
                    <div className="bg-bg-card border border-border-subtle shadow-sm rounded-2xl p-5 flex flex-col items-center justify-center hover:bg-bg-hover transition-colors">
                      <div className="text-text-muted text-[11px] 2xl:text-xs font-bold uppercase tracking-widest mb-1">{t("dash.phase") || "Encounter"}</div>
                      <div className="text-xl 2xl:text-2xl font-black text-text-primary">{viewedPokemon.encounters.toLocaleString()}</div>
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
              ) : rightPanelTab === "detector" ? (
                /* Auto-Detection Panel Tab */
                <div className="w-full">
                  <div className="text-center mb-6">
                     <h2 className="text-2xl font-semibold text-text-primary mb-2 flex items-center justify-center gap-2">
                        <Eye className="w-6 h-6 text-accent-blue" />
                        {t("dash.tabDetector")}: {viewedPokemon.name}
                     </h2>
                     <p className="text-sm text-text-muted max-w-md mx-auto">
                        {t("detector.tabHint")}
                     </p>
                     <p className="text-xs text-text-faint mt-1 max-w-md mx-auto">
                        {t("dash.detectorHint")}
                     </p>
                  </div>
                  <DetectorPanel
                    pokemon={viewedPokemon}
                    onConfigChange={(cfg) => handleDetectorConfigChange(viewedPokemon.id, cfg)}
                    isRunning={detectorStatus[viewedPokemon.id] !== undefined}
                    confidence={detectorStatus[viewedPokemon.id]?.confidence ?? 0}
                    detectorState={detectorStatus[viewedPokemon.id]?.state ?? "idle"}
                  />
                </div>
              ) : rightPanelTab === "overlay" ? (
                /* Overlay Editor Panel Tab */
                (() => {
                  const overlayMode = viewedPokemon.overlay_mode || "default";
                  const modeBase = overlayMode === "custom" ? "custom" : "default";

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
                                .filter((p) => p.id !== viewedPokemon.id && p.overlay)
                                .map((p) => (
                                  <button
                                    key={p.id}
                                    onClick={() => copyOverlayFrom(p.id)}
                                    className="w-full text-left px-3 py-2 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors flex items-center gap-2"
                                  >
                                    {p.sprite_url ? (
                                      <img src={p.sprite_url} alt="" className="w-4 h-4 object-contain" />
                                    ) : (
                                      <div className="w-4 h-4 rounded bg-bg-hover" />
                                    )}
                                    {p.name}
                                  </button>
                                ))}
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
                              {overlaySaving ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Save className="w-3.5 h-3.5" />
                              )}
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
                            activePokemon={viewedPokemon || undefined}
                            overlayTargetId={viewedPokemon.id}
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
                })()
              ) : rightPanelTab === "statistics" ? (
                <div className="w-full max-w-3xl mx-auto">
                  <StatisticsPanel pokemonId={viewedPokemon.id} />
                </div>
              ) : null}
            </div>
          </div>
        </div>
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
