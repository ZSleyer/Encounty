/**
 * Dashboard.tsx: Main counter UI.
 *
 * Displays a split layout: a left sidebar lists all tracked Pokémon and an
 * optional search/filter, while the right panel shows detailed controls for
 * the active Pokémon (increment, decrement, reset, complete/delete).
 * Counter actions are sent over WebSocket for immediate multi-tab sync.
 */
import { useState, useEffect, useMemo, useRef, Fragment, memo } from "react";
import {
  Plus,
  LayoutGrid,
  Search,
  Trophy,
  Sparkles,
  X,
  PartyPopper,
  Eye,
  Layers,
  ChevronDown,
  Pencil,
  BarChart3,
  Keyboard,
  Funnel,
  ArrowUpDown,
  PanelLeftClose,
  PanelLeftOpen,
  Tally5,
  AlertTriangle,
  Video,
  VideoOff,
  FolderPlus,
  XCircle,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router";
import { AddPokemonModal, NewPokemonData } from "../components/pokemon/AddPokemonModal";
import { EditPokemonModal } from "../components/pokemon/EditPokemonModal";
import { EndPhaseModal } from "../components/pokemon/EndPhaseModal";
import { CaughtChoiceModal, type CaughtChoice } from "../components/pokemon/CaughtChoiceModal";
import { FailedChoiceModal, type FailedChoice } from "../components/pokemon/FailedChoiceModal";
import { CatchMetaModal } from "../components/pokemon/CatchMetaModal";
import { ConfirmModal } from "../components/shared/ConfirmModal";
import { PokedexAssignmentModal } from "../components/dex/PokedexAssignmentModal";
import { SetEncounterModal } from "../components/shared/SetEncounterModal";
import { SourcePickerModal, type SelectedSource } from "../components/detector/SourcePickerModal";
import { isLoopRunning } from "../engine/DetectionLoop";
import { stopDetectionForPokemon } from "../engine/startDetection";
import { useCounterStore } from "../hooks/useCounterState";
import { useWebSocket } from "../hooks/useWebSocket";
import { Pokemon, DetectorConfig, OverlaySettings, Group, CatchMetaUpdate } from "../types";
import { TagChip } from "../components/shared/TagChip";
import { TagFilterBar } from "../components/shared/TagFilterBar";
import { SidebarGroupSection, type GroupAction } from "../components/shared/SidebarGroupSection";
import { GroupManagementModal } from "../components/shared/GroupManagementModal";
import { GroupCounterView } from "../components/group/GroupCounterView";
import { updateGroup } from "../utils/groupsApi";
import { useI18n } from "../contexts/I18nContext";
import { useAnchorName, anchorTriggerStyle, anchoredMenuStyle } from "../utils/anchoredMenu";
import { useCaptureService, useCaptureVersion } from "../contexts/CaptureServiceContext";
import { useToast } from "../contexts/ToastContext";
import { getOddsFractional } from "../utils/odds";
import { computePhaseStats } from "../utils/phase";
import { resolveSpriteSrc, isCustomSprite } from "../utils/sprites";
import { TrimmedBoxSprite } from "../components/shared/TrimmedBoxSprite";
import { FreezableSprite } from "../components/shared/FreezableSprite";

import { apiUrl, reorderPokemon, setPokemonGroup } from "../utils/api";
import { markSpeciesSeen } from "../utils/dexSeen";
import { pokemonDisplayName } from "../utils/pokemon";
import { clearGroupSource, getGroupSource, saveGroupSource } from "../utils/captureSourceMemory";

import { computeTimerMs } from "../utils/timer";
import { useFocusShortcut } from "../hooks/useFocusShortcut";
import { useModalA11y } from "../hooks/useModalA11y";

import { CollapsedSidebarItem } from "../components/dashboard/CollapsedSidebarItem";
import { DashboardCounterTab } from "../components/dashboard/DashboardCounterTab";
import { DashboardLoader } from "../components/dashboard/DashboardLoader";
import { DashboardOverlayTab } from "../components/dashboard/DashboardOverlayTab";
import { EmptyListPlaceholder } from "../components/dashboard/EmptyListPlaceholder";
import { HeaderHuntButton } from "../components/dashboard/HeaderHuntButton";
import { HeaderOverflowMenu } from "../components/dashboard/HeaderOverflowMenu";
import { SidebarHuntStatus } from "../components/dashboard/SidebarHuntStatus";
import { SidebarQuickActions } from "../components/dashboard/SidebarQuickActions";
import { completePokemonBulk, requestBulkDelete } from "../components/dashboard/bulkActions";
import {
  resolveGroupSource,
  saveDetectorConfig,
  saveGroupSourceType,
} from "../components/dashboard/detectorSources";
import {
  canPokemonStart,
  hasDetectorReady,
  isTimerStartBlocked,
  canStartDetector,
  keyDetectorStart,
  tryStartDetection,
} from "../components/dashboard/huntMode";
import {
  applyCopyOverlay,
  changePokemonOverlayMode,
  saveOverlayIfReady,
  syncOverlayState,
} from "../components/dashboard/overlayActions";
import {
  buildPhaseIndex,
  phaseOriginLabel,
  targetPhaseCatch,
  type PhaseCatchPayload,
} from "../components/dashboard/phaseHelpers";
import {
  buildSidebarItemClass,
  formatGame,
  getBaseAndFormName,
  resolveSpriteUrl,
  sidebarItemBorderClass,
  sidebarSpriteUrl,
  sidebarTabClass,
  sidebarTabLabel,
  tabButtonClass,
  tabLabelClass,
  tagDotColor,
} from "../components/dashboard/presentation";
import { handleResetConfirmMessage } from "../components/dashboard/resetConfirm";
import {
  applyCardSelection,
  handleActivateKeyDown,
  scrollFocusedIntoView,
  useSidebarKeyboard,
  type CardSelectionContext,
} from "../components/dashboard/sidebarKeyboard";
import {
  filterPokemonByQuery,
  handleSortClick,
  loadSortDir,
  loadSortMode,
  sortPokemonList,
} from "../components/dashboard/sidebarSort";
import type { PanelTab, SidebarTab, SortDir, SortMode } from "../components/dashboard/types";
import { useForceCounterOnArchive } from "../components/dashboard/useForceCounterOnArchive";
import { useHotkeyPause } from "../components/dashboard/useHotkeyPause";
import { useOverlayUpdate } from "../components/dashboard/useOverlayUpdate";
import { renderWorkArea, resolveTabContent } from "../components/dashboard/workArea";

/** Sentinel viewedGroupId value selecting the synthetic "ungrouped" bucket. */
const UNGROUPED_VIEW_ID = "__ungrouped__";

// Shared toast key for the bulk start/stop feedback of a group.
const keyGroupHunt = "group-hunt";

/** Finds the currently viewed Pokemon from the list by viewedId or fallback activeId. */
function findViewedPokemon(allPokemon: Pokemon[], viewedId: string | null): Pokemon | null {
  if (!viewedId) return null;
  return allPokemon.find((p) => p.id === viewedId) ?? null;
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

/**
 * Memoised: the Dashboard stays mounted behind every other route, and its only
 * prop is a boolean. Without this it re-renders its whole tree on every render
 * of the app shell, including the one that starts the route reveal animation,
 * which is exactly the frame that must not be spent on work nobody sees.
 */
export const Dashboard = memo(function Dashboard({
  isActiveRoute = true,
}: Readonly<DashboardProps> = {}) {
  // Narrow selectors: avoid re-rendering on isConnected / flashingIds /
  // lastEncounterPokemonId changes, which the Dashboard does not read. The
  // detectorStatus map is genuinely consumed here (passed to sidebar/cards).
  const appState = useCounterStore((s) => s.appState);
  const flashPokemon = useCounterStore((s) => s.flashPokemon);
  const detectorStatus = useCounterStore((s) => s.detectorStatus);
  const setDetectorStatus = useCounterStore((s) => s.setDetectorStatus);
  const clearDetectorStatus = useCounterStore((s) => s.clearDetectorStatus);
  const { t } = useI18n();
  const sortMenuAnchor = useAnchorName("sidebar-sort");
  const capture = useCaptureService();
  const { push: pushToast } = useToast();
  useCaptureVersion(); // Re-render when capture sources connect/disconnect
  const location = useLocation();
  const navigate = useNavigate();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingPokemon, setEditingPokemon] = useState<Pokemon | null>(null);
  // Only the id: the modal shows live encounters and timer, so a snapshot
  // would go stale as soon as the hotkey keeps counting while it is open.
  const [endPhaseId, setEndPhaseId] = useState<string | null>(null);
  // True while endPhaseId's EndPhaseModal is closing out a failed phase
  // rather than a caught one: routes its onSubmit to handleEndPhaseFailed and
  // switches the modal to its "failed" variant. Reset on close so the modal
  // never reopens in the wrong mode for the next hunt.
  const [endPhaseFailed, setEndPhaseFailed] = useState(false);
  // Hunt whose "Caught!" button asked what actually happened, id for the same
  // reason as endPhaseId.
  const [caughtChoiceId, setCaughtChoiceId] = useState<string | null>(null);
  // Hunt whose "Failed" button asked what actually happened, mirrors
  // caughtChoiceId for the fail flow.
  const [failedChoiceId, setFailedChoiceId] = useState<string | null>(null);
  // Entry whose optional catch details are being recorded. Set only after the
  // catch itself is persisted, and shared by the post-catch step and the edit
  // action coming back from the Dex, so only ever one dialog is mounted.
  const [catchMetaId, setCatchMetaId] = useState<string | null>(null);
  const [assignmentCompleteId, setAssignmentCompleteId] = useState<string | null>(null);
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("encounty-sidebar-collapsed") === "true",
  );
  const [showHuntMenu, setShowHuntMenu] = useState(false);
  const [showHeaderHuntMenu, setShowHeaderHuntMenu] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupSourcePicker, setGroupSourcePicker] = useState<{
    groupId: string;
    sourceType: "browser_display" | "browser_camera";
  } | null>(null);
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

  /** Guarded tab switch, shows confirmation when overlay has unsaved changes. */
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
  /**
   * Archives a hunt and then offers the optional catch details. The metadata
   * step opens only after the write succeeded, so skipping it, closing it or
   * crashing in it can never lose the catch itself.
   */
  const handleComplete = async (id: string) => {
    const pokemon = allPokemon.find((entry) => entry.id === id);
    if (pokemon && (pokemon.pokedex_ids ?? ["default"]).length === 0) {
      setAssignmentCompleteId(id);
      return;
    }
    const res = await fetch(apiUrl(`/api/pokemon/${id}/complete`), { method: "POST" });
    if (res.ok) setCatchMetaId(id);
  };
  const handleUncomplete = async (id: string) => {
    await fetch(apiUrl(`/api/pokemon/${id}/uncomplete`), { method: "POST" });
  };
  /**
   * Archives a hunt as failed: the shiny was seen but never caught. Unlike
   * handleComplete this never opens the catch-metadata step, since nothing
   * was actually caught, but it does sync the species as "seen" in the
   * Pokédex through the manual override system.
   */
  const handleFailPokemon = async (id: string) => {
    // Captured before the request: a successful fail moves the entry out of
    // the active list, and the fire-and-forget dex sync below must not race
    // that state update to read the canonical name back off it.
    const canonicalName = allPokemon.find((p) => p.id === id)?.canonical_name ?? "";
    const res = await fetch(apiUrl(`/api/pokemon/${id}/fail`), { method: "POST" });
    if (res.ok) void markSpeciesSeen(canonicalName);
  };
  /** Opens the destructive confirmation for failing a whole hunt (not just a phase). */
  const confirmFailHunt = (id: string) => {
    setConfirmConfig({
      isOpen: true,
      title: t("confirm.failTitle"),
      message: t("confirm.failMsg"),
      isDestructive: true,
      onConfirm: () => void handleFailPokemon(id),
    });
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
    const payload = {
      ...data,
      nickname: p?.nickname,
      overlay: p?.overlay,
      overlay_mode: p?.overlay_mode,
      step: data.step,
    };
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

  const updatePokemonOverlay = useOverlayUpdate(
    appState!,
    setOverlayDirty,
    setOverlaySaved,
    setOverlaySaving,
  );

  const handleModeChange = (newMode: "default" | "custom") =>
    changePokemonOverlayMode(
      newMode,
      viewedPokemon,
      appState!,
      t,
      updatePokemonOverlay,
      setCurrentOverlay,
    );

  const saveCurrentOverlay = () =>
    saveOverlayIfReady(currentOverlay, viewedPokemon, updatePokemonOverlay);

  const copyOverlayFrom = (sourceId: string) =>
    applyCopyOverlay(sourceId, appState!, setCurrentOverlay, setOverlayDirty);

  // --- Derived State (computed before hooks to avoid conditional hook calls) ---
  const allPokemon = appState?.pokemon ?? [];
  const groups: Group[] = appState?.groups ?? [];
  const activeHunts = allPokemon.filter((p) => !p.completed_at);
  // Quick access to what has already been caught. The /dex route stays the full
  // grid view; this list only shortcuts back to an entry from the Dashboard.
  // Hand-entered catches stay out: this list is about hunts that actually ran
  // here. They remain fully visible in the pokedex.
  const caughtHunts = allPokemon.filter((p) => !!p.completed_at && p.entry_source !== "manual");
  const q = searchQuery.trim().toLowerCase();
  const tabPool = sidebarTab === "active" ? activeHunts : caughtHunts;
  // Tag filter applies only on the active tab; the caught list stays flat.
  const tagFiltered =
    sidebarTab === "active" && activeTagFilters.length > 0
      ? tabPool.filter((p) => {
          const pTags = p.tags ?? [];
          return activeTagFilters.every((t) => pTags.includes(t));
        })
      : tabPool;
  const filtered = filterPokemonByQuery(tagFiltered, q);
  const displayList = sortPokemonList(filtered, sortMode, sortDir);

  // Flattened order exactly as the sidebar renders it (groups by their
  // sort_order, ungrouped last, items in displayList order within each group).
  // Reorder math must use this, not the flat displayList, or "first"/"last"
  // drops land at the wrong index because rendering re-groups the flat list.
  const visualList = (() => {
    const groupRank = new Map<string, number>();
    [...groups]
      .sort((a, b) => a.sort_order - b.sort_order)
      .forEach((g, i) => groupRank.set(g.id, i));
    const rankOf = (p: Pokemon) =>
      p.group_id && groupRank.has(p.group_id)
        ? (groupRank.get(p.group_id) as number)
        : Number.MAX_SAFE_INTEGER;
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
  const availableTags = Array.from(new Set(activeHunts.flatMap((p) => p.tags ?? []))).sort((a, b) =>
    a.localeCompare(b),
  );
  const viewedPokemon = findViewedPokemon(allPokemon, viewedPokemonId);
  const oddsDisplay = getOddsFractional(viewedPokemon);
  // Built once per snapshot: renderPokemonItem would otherwise rescan the whole
  // list per row, making the sidebar quadratic.
  const phaseIndex = useMemo(() => buildPhaseIndex(allPokemon), [allPokemon]);
  // The hunt whose phase is being ended, resolved live so counting on with the
  // hotkey keeps the modal summary in sync with what the backend will freeze.
  const endPhaseParent = allPokemon.find((p) => p.id === endPhaseId) ?? null;
  const caughtChoiceHunt = allPokemon.find((p) => p.id === caughtChoiceId) ?? null;
  const failedChoiceHunt = allPokemon.find((p) => p.id === failedChoiceId) ?? null;
  // Resolving against the live list also closes the dialog when the entry is
  // deleted underneath it, so the id can never dangle.
  const catchMetaTarget = allPokemon.find((p) => p.id === catchMetaId) ?? null;
  const assignmentCompleteTarget = allPokemon.find((p) => p.id === assignmentCompleteId) ?? null;

  // --- Phase Handlers ---

  /**
   * Reports whether a catch on this hunt is ambiguous: the shiny that just
   * appeared is either the target or the one that ends the phase. Phase entries
   * and finished hunts are never ambiguous.
   */
  const catchIsAmbiguous = (p: Pokemon) => !p.completed_at && !p.phase_of;

  /**
   * Entry point of the Caught button: ask for every running hunt and complete
   * archived entries directly.
   */
  const handleCaught = (p: Pokemon) => {
    if (catchIsAmbiguous(p)) {
      setCaughtChoiceId(p.id);
      return;
    }
    void handleComplete(p.id);
  };

  /** Routes the answer of the caught dialog to the matching flow. */
  const handleCaughtChoice = (id: string, choice: CaughtChoice) => {
    if (choice === "phase") {
      setEndPhaseId(id);
      // Explicit reset, not just EndPhaseModal's onClose: if the previous
      // end-phase dialog's hunt got deleted out from under it (e.g. a WS
      // update from another tab), the modal unmounts via endPhaseParent
      // turning null and onClose never runs, leaving the flag stuck.
      setEndPhaseFailed(false);
      return;
    }
    void handleComplete(id);
  };

  /**
   * Entry point of the Failed button: ask for every running hunt because a
   * failed encounter might only end the current phase, not the whole hunt.
   */
  const handleFailed = (p: Pokemon) => {
    if (catchIsAmbiguous(p)) {
      setFailedChoiceId(p.id);
      return;
    }
    confirmFailHunt(p.id);
  };

  /** Routes the answer of the failed dialog to the matching flow. */
  const handleFailedChoice = (id: string, choice: FailedChoice) => {
    if (choice === "phase") {
      setEndPhaseId(id);
      setEndPhaseFailed(true);
      return;
    }
    if (choice === "targetPhase") {
      const hunt = allPokemon.find((p) => p.id === id);
      // The species is already known here, so this branch skips EndPhaseModal
      // and posts straight away. Nothing is left to catch the rethrow the
      // shared handler does for that dialog's benefit, and the error toast has
      // been pushed by then anyway.
      if (hunt) void handleEndPhaseFailed(hunt, targetPhaseCatch(hunt)).catch(() => {});
      return;
    }
    confirmFailHunt(id);
  };

  /**
   * Shows the given entry in the main panel and switches the sidebar to the tab
   * it lives in, so jumping from a phase entry to its hunt (or back) always
   * lands on something visible.
   */
  const handleOpenEntry = (target: Pokemon) => {
    setSidebarTab(target.completed_at ? "caught" : "active");
    setViewedGroupId(null);
    setViewedPokemonId(target.id);
    setRightPanelTab("counter");
  };

  /**
   * Ends the running phase of a hunt with the foreign shiny picked in the
   * modal. A failure is rethrown so the modal keeps the dialog, and the pick,
   * open; the modal closes itself once this resolves.
   */
  const handleEndPhase = async (parent: Pokemon, data: PhaseCatchPayload) => {
    const number = computePhaseStats(parent, allPokemon).phaseNumber;
    try {
      const res = await fetch(apiUrl(`/api/pokemon/${parent.id}/phase`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("end phase failed");
      // The 201 body is the full archive entry, so its id is available without
      // waiting for the state_update broadcast to arrive.
      const child = (await res.json()) as Pokemon;
      setCatchMetaId(child.id);
    } catch (err) {
      pushToast({ type: "error", title: t("phase.errEndFailed"), key: "phase-end" });
      throw err;
    }
    pushToast({ type: "success", title: t("phase.ended", { number }), key: "phase-end" });
  };

  /**
   * Ends the running phase of a hunt with a foreign shiny that got away
   * rather than one that was caught. Mirrors handleEndPhase except the POST
   * body carries `failed: true`, nothing was caught so the catch-metadata
   * step never opens, and the newly archived phase child is synced into the
   * Pokédex as seen instead.
   */
  const handleEndPhaseFailed = async (parent: Pokemon, data: PhaseCatchPayload) => {
    const number = computePhaseStats(parent, allPokemon).phaseNumber;
    try {
      const res = await fetch(apiUrl(`/api/pokemon/${parent.id}/phase`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, failed: true }),
      });
      if (!res.ok) throw new Error("end phase failed");
      const child = (await res.json()) as Pokemon;
      void markSpeciesSeen(child.canonical_name);
    } catch (err) {
      pushToast({ type: "error", title: t("phase.endFailedError"), key: "phase-end" });
      throw err;
    }
    pushToast({ type: "success", title: t("phase.endedFailed", { number }), key: "phase-end" });
  };

  /** Stores the optional catch details recorded in the metadata dialog. */
  const handleSaveCatchMeta = async (id: string, meta: CatchMetaUpdate) => {
    const res = await fetch(apiUrl(`/api/pokemon/${id}/catch`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(meta),
    });
    if (!res.ok) throw new Error("save catch metadata failed");
    pushToast({ type: "success", title: t("catchMeta.saved"), key: "catch-meta" });
  };

  // The Dex hands an entry over through router state. Clearing it goes through
  // the router rather than history.replaceState, which would wipe the data
  // router's own idx and key and break back/forward.
  useEffect(() => {
    const openId = (location.state as { openEntryId?: string } | null)?.openEntryId;
    if (!openId) return;
    const target = allPokemon.find((p) => p.id === openId);
    // A hand-entered catch has no dashboard record, so a stale router state
    // must not be able to open one.
    if (target && target.entry_source !== "manual") handleOpenEntry(target);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, allPokemon, navigate]);

  /** Deletes the most recent phase and returns its encounters and time to the hunt. */
  const undoPhase = async (child: Pokemon) => {
    try {
      const res = await fetch(apiUrl(`/api/pokemon/${child.id}/phase`), { method: "DELETE" });
      if (!res.ok) throw new Error("undo phase failed");
      // The entry no longer exists afterwards, so follow the user to the hunt
      // that absorbed it instead of leaving an empty panel behind.
      const parent = allPokemon.find((p) => p.id === child.phase_of);
      if (parent) handleOpenEntry(parent);
      pushToast({ type: "success", title: t("phase.undone"), key: "phase-undo" });
    } catch {
      pushToast({ type: "error", title: t("phase.errUndoFailed"), key: "phase-undo" });
    }
  };

  /** Confirms first: undoing a phase deletes its archive entry. */
  const handleUndoPhase = (child: Pokemon) => {
    setConfirmConfig({
      isOpen: true,
      title: t("phase.undo"),
      message: t("phase.undoConfirm"),
      isDestructive: true,
      onConfirm: () => void undoPhase(child),
    });
  };

  // Persist sort + sidebar preferences
  useEffect(() => {
    localStorage.setItem("encounty-sort-mode", sortMode);
    localStorage.setItem("encounty-sort-dir", sortDir);
  }, [sortMode, sortDir]);

  useEffect(() => {
    localStorage.setItem("encounty-sidebar-collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  const bulkDelete = () => requestBulkDelete(selectedIds, t, setConfirmConfig, setSelectedIds);

  const bulkComplete = () => completePokemonBulk(selectedIds, setSelectedIds);

  // --- Sidebar keyboard navigation ---
  useSidebarKeyboard(asideRef, {
    displayList,
    focusedIdx,
    selectedIds,
    searchQuery,
    setFocusedIdx,
    setSelectedIds,
    setSearchQuery,
    bulkDelete,
  });

  // Scroll focused item into view
  useEffect(() => scrollFocusedIntoView(focusedIdx, asideRef), [focusedIdx]);

  if (!appState) return <DashboardLoader label={t("nav.connecting")} />;

  // Highlight the viewed Pokémon in the sidebar (local view, not the hotkey target).
  const effectiveViewedId = viewedPokemonId;
  const activeLanguages = appState.settings.languages ?? ["de", "en"];

  const cardSelectionCtx: CardSelectionContext = {
    displayList,
    selectedIds,
    lastSelectedIdx,
    setSelectedIds,
    handleActivate,
    viewedPokemonId: effectiveViewedId,
  };
  const handleCardClick = (e: React.MouseEvent, pokemonId: string, idx: number) =>
    applyCardSelection(e, pokemonId, idx, cardSelectionCtx);

  const handleClearAndAdd = () => {
    setSearchQuery("");
    setShowAddModal(true);
  };
  const handleOpenAdd = () => setShowAddModal(true);

  // --- Render Closures ---
  // These read a dozen pieces of component state each and stay closures on
  // purpose: giving them a props interface would be a redesign, not a move.

  /** Renders the right main panel when no Pokemon is selected. */
  const renderNoPokemonPanel = () => {
    // The inline overview shortcut opens the ungrouped bucket, so only offer it
    // when ungrouped Pokémon actually exist. Scoped to the selected tab.
    const hasUngrouped = tabPool.some((p) => !p.group_id);
    return (
      <div className="flex flex-col items-center justify-center h-full text-center relative z-10 w-full max-w-4xl mx-auto">
        <Sparkles className="w-8 h-8 text-text-faint mb-6" />
        <h2 className="text-2xl font-semibold text-text-primary mb-2">{t("dash.noActive")}</h2>
        <p className="text-text-muted text-sm max-w-xs">{t("dash.noActiveHint")}</p>
        {hasUngrouped && (
          <p className="flex items-center flex-wrap justify-center gap-x-1.5 gap-y-1 text-text-faint text-xs mt-6">
            {t("dash.overviewHintBefore")}
            <button
              type="button"
              onClick={() => {
                setViewedPokemonId(null);
                setViewedGroupId(UNGROUPED_VIEW_ID);
              }}
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
    // completion state, only its members do).
    const scopePool = tabPool;
    const rawMembers = isUngrouped
      ? scopePool.filter((p) => !p.group_id)
      : scopePool.filter((p) => p.group_id === group.id);
    // Mirror the sidebar's sort so the overview order matches the list.
    const members = sortPokemonList(rawMembers, sortMode, sortDir);
    const huntMembers = members.filter((p) => !p.completed_at);
    const isHuntRunning = (p: Pokemon) =>
      !!p.timer_started_at || !!detectorStatus[p.id] || isLoopRunning(p.id);
    const startDisabled = !huntMembers.some(
      (p) => !isHuntRunning(p) && canPokemonStart(p, capture.isCapturing),
    );
    const stopDisabled = !huntMembers.some(isHuntRunning);
    const captureMembers = isUngrouped
      ? []
      : members.filter(
          (p) => !p.completed_at && !!p.detector_config && (p.hunt_mode || "both") !== "timer",
        );
    const captureIds = captureMembers.map((p) => p.id);
    const captureConnected = captureIds.filter(capture.isCapturing).length;
    const captureDisabled = captureMembers.some(
      (p) => !!p.timer_started_at || !!detectorStatus[p.id] || isLoopRunning(p.id),
    );
    const rememberedSource = isUngrouped ? null : getGroupSource(group.id);

    const connectGroupSource = async (source: {
      type: "browser_display" | "browser_camera";
      sourceId?: string;
      sourceLabel: string;
      stream?: MediaStream;
    }) => {
      const ok = await capture.startCaptures(
        captureIds,
        source.type,
        source.sourceId,
        source.sourceLabel,
        source.stream,
      );
      if (!ok) {
        pushToast({
          type: "error",
          title: t(capture.captureError || "capture.errStartFailed"),
          key: "group-capture",
        });
        return false;
      }
      if (!isUngrouped) saveGroupSource(group.id, source);
      saveGroupSourceType(captureMembers, source.type);
      const skipped = members.length - captureMembers.length;
      pushToast({
        type: "success",
        title: t(skipped > 0 ? "group.sourceConnectedSkipped" : "group.sourceConnected", {
          count: captureIds.length,
          skipped,
        }),
        key: "group-capture",
      });
      return true;
    };

    const pickGroupSource = (sourceType: "browser_display" | "browser_camera") => {
      if (sourceType === "browser_display" && globalThis.electronAPI?.isWayland) {
        void connectGroupSource({ type: sourceType, sourceLabel: "" });
        return;
      }
      setGroupSourcePicker({ groupId: group.id, sourceType });
    };
    // ponytail: bulk increment/decrement fan out to per-member messages; there
    // is no dedicated group-increment endpoint. A real group's reset reuses the
    // reset_group message; the ungrouped bucket has no group id, so it fans the
    // reset out per member behind the same single confirmation.
    const onBulkReset = () =>
      setConfirmConfig({
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
          onOpenDetector={(id) => {
            setViewedGroupId(null);
            setViewedPokemonId(id);
            setRightPanelTab("detector");
          }}
          onBulkIncrement={() => members.forEach((p) => handleIncrement(p.id))}
          onBulkDecrement={() => members.forEach((p) => send("decrement", { pokemon_id: p.id }))}
          onBulkReset={onBulkReset}
          captureConnected={captureConnected}
          captureEligible={captureIds.length}
          hasRememberedSource={!!rememberedSource}
          captureDisabled={captureDisabled}
          onRestoreSource={() => {
            if (!rememberedSource) return;
            if (rememberedSource.type === "browser_display" && globalThis.electronAPI?.isWayland) {
              void connectGroupSource({ ...rememberedSource, sourceId: undefined });
              return;
            }
            void resolveGroupSource(rememberedSource)
              .then(async (resolved) => {
                if (resolved && (await connectGroupSource(resolved))) return;
                setGroupSourcePicker({ groupId: group.id, sourceType: rememberedSource.type });
              })
              .catch(() =>
                setGroupSourcePicker({ groupId: group.id, sourceType: rememberedSource.type }),
              );
          }}
          onPickSource={pickGroupSource}
          onDisconnectSource={() => {
            for (const pokemonId of captureIds) capture.stopCapture(pokemonId);
            pushToast({
              type: "success",
              title: t("group.sourceDisconnected"),
              key: "group-capture",
            });
          }}
          startDisabled={startDisabled}
          stopDisabled={stopDisabled}
          onStartAll={() => handleGroupHuntAction(huntMembers, "start")}
          onStopAll={() => handleGroupHuntAction(huntMembers, "stop")}
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
      onOverlayUpdate={(overlay) => {
        setCurrentOverlay(overlay);
        setOverlayDirty(true);
      }}
    />
  );

  const renderCounterTab = (pokemon: Pokemon) => (
    <DashboardCounterTab
      pokemon={pokemon}
      allPokemon={allPokemon}
      imgError={imgError}
      oddsDisplay={oddsDisplay}
      send={send}
      onImgError={(id, src) => setImgError((prev) => ({ ...prev, [id]: src }))}
      onDecrement={handleDecrement}
      onIncrement={handleIncrement}
      onReset={handleReset}
      onSetEncounter={setSetEncounterPokemon}
      onEndPhase={(p) => setEndPhaseId(p.id)}
      onUndoPhase={handleUndoPhase}
      onOpenEntry={handleOpenEntry}
      timerStartBlocked={isTimerStartBlocked(pokemon, capture.isCapturing)}
    />
  );

  /** Renders the tab-specific content inside the scrollable work area. */
  const renderTabContent = (pokemon: Pokemon) =>
    resolveTabContent(
      rightPanelTab,
      pokemon,
      renderCounterTab,
      renderOverlayTab,
      handleDetectorConfigChange,
      detectorStatus,
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
    const isCaught = !!p.completed_at;
    const isSelected = selectedIds.has(p.id);
    const src = sidebarSpriteUrl(p, imgError);
    const itemBorderClass = sidebarItemBorderClass(isSelected, isViewed);
    const itemClassName = buildSidebarItemClass(itemBorderClass, focusedIdx === idx);
    const [baseName, formName] = getBaseAndFormName(p);
    const tags = p.tags ?? [];
    const originLabel = phaseOriginLabel(p, phaseIndex.nameById.get(p.phase_of ?? ""), t);
    // The running phase is max(finished) + 1; without a finished phase the hunt
    // is still in phase 1 and stays unmarked.
    const finishedPhases = phaseIndex.latestPhase.get(p.id);
    const runningPhase = isCaught || finishedPhases === undefined ? null : finishedPhases + 1;
    // Full metadata as tooltip since the merged line truncates.
    const metaTitle = [
      formName,
      p.game ? formatGame(p.game) : "",
      String(p.encounters),
      originLabel ?? "",
    ]
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
            if (dragOverId !== p.id || dropAfter !== after) {
              setDragOverId(p.id);
              setDropAfter(after);
            }
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
              alt={pokemonDisplayName(p)}
              onError={() => setImgError((prev) => ({ ...prev, [p.id]: src }))}
              className="pokemon-sprite w-full h-full object-contain"
            />
            {/* Decorative: the caught/failed state is already carried by the
              selected Pokédex tab this row can only appear under. */}
            {isCaught && !p.failed && (
              <div
                aria-hidden="true"
                className="absolute -bottom-0.5 -right-0.5 bg-accent-green rounded-none p-0.5"
              >
                <Trophy className="w-2 h-2 text-text-primary" />
              </div>
            )}
            {isCaught && p.failed && (
              <div
                aria-hidden="true"
                className="absolute -bottom-0.5 -right-0.5 bg-accent-red rounded-none p-0.5"
              >
                <XCircle className="w-2 h-2 text-text-primary" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            {/* Row 1: Name + Actions */}
            <div className="flex items-center gap-1">
              <span
                className="text-[13px] 2xl:text-sm font-semibold text-text-primary truncate flex-1 capitalize"
                title={pokemonDisplayName(p)}
              >
                {baseName}
              </span>
              {runningPhase !== null && (
                <span
                  className="shrink-0 border border-accent-purple/40 text-accent-purple text-[10px] px-1 rounded-none tabular-nums"
                  title={t("phase.badge", { number: runningPhase })}
                >
                  {t("phase.short", { number: runningPhase })}
                </span>
              )}
              <div className="flex gap-0.5 items-center shrink-0">
                {hasDetectorReady(p) &&
                  (capture.isCapturing(p.id) ? (
                    <span className="p-0.5" title={t("sidebar.sourceConnected")}>
                      <Video
                        className="w-3 h-3 2xl:w-3.5 2xl:h-3.5 text-accent-green"
                        aria-label={t("sidebar.sourceConnected")}
                      />
                    </span>
                  ) : (
                    <span className="p-0.5" title={t("sidebar.sourceDisconnected")}>
                      <VideoOff
                        className="w-3 h-3 2xl:w-3.5 2xl:h-3.5 text-accent-red/70"
                        aria-label={t("sidebar.sourceDisconnected")}
                      />
                    </span>
                  ))}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    send("set_active", { pokemon_id: p.id });
                  }}
                  className={`min-w-6 min-h-6 flex items-center justify-center rounded-none transition-colors hover:text-accent-blue ${
                    isHotkeyTarget ? "text-accent-blue" : "text-text-faint/40"
                  }`}
                  title={isHotkeyTarget ? t("dash.hotkeyTargetActive") : t("dash.hotkeyTarget")}
                  aria-label={
                    isHotkeyTarget ? t("dash.hotkeyTargetActive") : t("dash.hotkeyTarget")
                  }
                  aria-pressed={isHotkeyTarget}
                >
                  <Keyboard className="w-3 h-3 2xl:w-3.5 2xl:h-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingPokemon(p);
                  }}
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
                {originLabel && (
                  <>
                    <span className="text-text-faint"> · </span>
                    <span className="text-accent-purple">{originLabel}</span>
                  </>
                )}
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
  const indexOfPokemon = (pokemonId: string) => displayList.findIndex((x) => x.id === pokemonId);

  /** Renders the active-tab list grouped by group_id (sorted by sort_order, with "ungrouped" last). */
  const renderGroupedList = (): React.ReactNode => {
    const sortedGroups = [...groups].sort((a, b) => a.sort_order - b.sort_order);
    const byGroup = new Map<string, Pokemon[]>();
    for (const p of displayList)
      byGroup.set(p.group_id || "", [...(byGroup.get(p.group_id || "") ?? []), p]);

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
          onShowGroupView={() => {
            setViewedPokemonId(null);
            setViewedGroupId((cur) => (cur === g.id ? null : g.id));
          }}
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
          onAction={(action) =>
            handleGroupHuntAction(
              activeHunts.filter((p) => !p.group_id),
              action,
            )
          }
          isGroupViewed={viewedGroupId === UNGROUPED_VIEW_ID}
          onShowGroupView={() => {
            setViewedPokemonId(null);
            setViewedGroupId((cur) => (cur === UNGROUPED_VIEW_ID ? null : UNGROUPED_VIEW_ID));
          }}
        >
          {ungrouped.map((p) => renderPokemonItem(p, indexOfPokemon(p.id)))}
        </SidebarGroupSection>,
      );
    }
    return sections;
  };

  // --- Group Actions ---

  /** Persist group collapse state via REST; the WS broadcast refreshes the store. */
  const handleGroupToggleCollapse = (g: Group) => {
    void updateGroup(g.id, { collapsed: !g.collapsed }).catch(() => {});
  };

  /** Starts or stops every active member via the same path as sidebar actions.
   *  Reports what happened: a bulk action that silently skips every member is
   *  indistinguishable from one that did nothing at all. */
  const handleGroupHuntAction = (members: Pokemon[], action: GroupAction) => {
    if (action === "start") {
      let started = 0;
      let blockedByStream = false;
      for (const p of members) {
        if (p.timer_started_at || detectorStatus[p.id] || isLoopRunning(p.id)) continue;
        const mode = p.hunt_mode || "both";
        const timerBlocked = isTimerStartBlocked(p, capture.isCapturing);
        if (mode !== "detector" && !timerBlocked) {
          send("timer_start", { pokemon_id: p.id });
          started++;
        } else if (timerBlocked) {
          blockedByStream = true;
        }
        if (canStartDetector(p, detectorStatus, capture)) {
          tryStartDetection(p, capture, setDetectorStatus, () =>
            pushToast({
              type: "error",
              title: t("detector.errStartFailed"),
              key: keyDetectorStart,
            }),
          );
        }
      }
      if (started > 0) {
        pushToast({
          type: "success",
          title: t("group.hunt.started", { count: started }),
          key: keyGroupHunt,
        });
      } else if (blockedByStream) {
        pushToast({ type: "error", title: t("group.hunt.noStream"), key: keyGroupHunt });
      }
      return;
    }
    if (action === "stop") {
      let stopped = 0;
      for (const p of members) {
        if (p.timer_started_at) {
          send("timer_stop", { pokemon_id: p.id });
          stopped++;
        }
        stopDetectionForPokemon(p.id);
        clearDetectorStatus(p.id);
      }
      if (stopped > 0) {
        pushToast({
          type: "success",
          title: t("group.hunt.stopped", { count: stopped }),
          key: keyGroupHunt,
        });
      }
    }
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
          clearGroupSource(g.id);
          void fetch(apiUrl(`/api/groups/${g.id}`), { method: "DELETE" }).catch(() => {});
        },
      });
      return;
    }
    handleGroupHuntAction(
      activeHunts.filter((p) => p.group_id === g.id),
      action,
    );
  };

  return (
    <div className="flex h-full">
      {/* LEFT: Pokemon sidebar */}
      <aside
        ref={asideRef}
        className={`shrink-0 bg-bg-secondary flex flex-col transition-[width] duration-200 overflow-hidden ${sidebarCollapsed ? "w-0" : "w-72 2xl:w-80"}`}
      >
        {/* Search bar + Sort + Collapse */}
        <div className="p-3 border-b border-border-subtle">
          <div className="flex items-center gap-1.5 2xl:gap-2">
            <div
              data-focus-wrapper
              className="flex-1 min-w-0 flex items-center gap-1.5 bg-bg-primary border border-border-subtle rounded-none px-2 py-1.5 2xl:px-3 2xl:gap-2 focus-within:border-accent-blue/50 focus-within:ring-2 focus-within:ring-accent-blue/30 transition-colors"
            >
              <Search className="w-3.5 h-3.5 text-text-muted shrink-0" />
              <input
                ref={searchRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                // The placeholder is the only visible hint and it disappears on
                // the first keystroke, so the accessible name cannot rest on it
                // (WCAG 3.3.2).
                aria-label={t("dash.search")}
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
                onClick={() => setShowSortMenu((v) => !v)}
                className="p-1.5 rounded-none bg-bg-primary border border-border-subtle hover:border-accent-blue/40 text-text-muted hover:text-text-primary transition-colors"
                title={t("sidebar.sortBy")}
                aria-label={t("sidebar.sortBy")}
                style={anchorTriggerStyle(sortMenuAnchor)}
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
              </button>
              {showSortMenu && (
                <>
                  <button
                    className="fixed inset-0 z-40 cursor-default"
                    onClick={() => setShowSortMenu(false)}
                    aria-label={t("aria.close")}
                  />
                  <div
                    style={anchoredMenuStyle(sortMenuAnchor, "below-end")}
                    className="fixed z-50 overflow-y-auto bg-bg-secondary border border-border-subtle rounded-none shadow-lg py-1 min-w-36"
                  >
                    {(
                      [
                        { mode: "recent" as const, label: t("sidebar.sortRecent") },
                        { mode: "name" as const, label: t("sidebar.sortName") },
                        { mode: "encounters" as const, label: t("sidebar.sortEncounters") },
                        { mode: "game" as const, label: t("sidebar.sortGame") },
                        { mode: "manual" as const, label: t("sidebar.sortManual") },
                      ] as const
                    ).map(({ mode, label }) => (
                      <button
                        key={mode}
                        onClick={() =>
                          handleSortClick(mode, sortMode, setSortMode, setSortDir, setShowSortMenu)
                        }
                        className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-text-secondary hover:bg-bg-primary transition-colors"
                      >
                        {label}
                        {sortMode === mode && (
                          <ChevronDown
                            className={`ml-auto w-3.5 h-3.5 text-accent-blue transition-transform ${sortDir === "asc" ? "rotate-180" : ""}`}
                          />
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
                onClick={() => setShowTagFilterBar((v) => !v)}
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

        {/* Tabs: Active | Pokédex. Two aria-pressed toggles rather than a full
            tablist: the list below is a plain region, not a tabpanel, and a
            role="tab" without the matching panel wiring would announce a
            structure that is not there. */}
        <div className="flex border-b border-border-subtle">
          <button
            type="button"
            onClick={() => setSidebarTab("active")}
            aria-pressed={sidebarTab === "active"}
            aria-label={sidebarTabLabel(t("dash.tabActive"), activeHunts.length, t)}
            className={sidebarTabClass(sidebarTab === "active", "text-accent-blue")}
          >
            <span className="flex items-center justify-center gap-1.5">
              <Sparkles className="w-3 h-3" aria-hidden="true" />
              {t("dash.tabActive")}
              {activeHunts.length > 0 && (
                <span
                  aria-hidden="true"
                  className="border border-accent-blue/40 text-accent-blue text-[10px] px-1.5 py-0.5 rounded-none tabular-nums"
                >
                  {activeHunts.length}
                </span>
              )}
            </span>
            {sidebarTab === "active" && (
              <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-accent-blue rounded-none" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setSidebarTab("caught")}
            aria-pressed={sidebarTab === "caught"}
            aria-label={sidebarTabLabel(t("dex.title"), caughtHunts.length, t)}
            className={sidebarTabClass(sidebarTab === "caught", "text-accent-green")}
          >
            <span className="flex items-center justify-center gap-1.5">
              <Trophy className="w-3 h-3" aria-hidden="true" />
              {t("dex.title")}
              {caughtHunts.length > 0 && (
                <span
                  aria-hidden="true"
                  className="border border-accent-green/40 text-accent-green text-[10px] px-1.5 py-0.5 rounded-none tabular-nums"
                >
                  {caughtHunts.length}
                </span>
              )}
            </span>
            {sidebarTab === "caught" && (
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
        {sidebarTab === "active" &&
          availableTags.length > 0 &&
          (activeTagFilters.length > 0 || showTagFilterBar) && (
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
              <EmptyListPlaceholder
                query={q}
                sidebarTab={sidebarTab}
                onClearAndAdd={handleClearAndAdd}
                onAdd={handleOpenAdd}
              />
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

      <main
        id={isActiveRoute ? "main-content" : undefined}
        className="flex-1 flex flex-col relative h-full min-h-0 bg-transparent overflow-hidden"
      >
        <h1 className="sr-only">{t("nav.dashboard")}</h1>

        {viewedPokemon ? (
          <div className="flex flex-col h-full w-full">
            {/* Top Bar (übergeordnet, scrollt nicht mit) */}
            <header className="flex-none px-4 py-2.5 border-b border-border-subtle bg-bg-card z-50 relative grid grid-cols-[auto_1fr_auto] items-center gap-3">
              {/* Left: Tabs. Scrolls horizontally rather than clipping: on a
                  short, narrow window the strip plus the pokemon header plus the
                  action buttons no longer fit on one line. */}
              <div className="flex justify-start min-w-0">
                <div className="flex bg-bg-card rounded-none border border-border-subtle p-0.5 shadow-sm min-w-0 overflow-x-auto">
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
                  {/* A hand-entered catch has no detection history to chart. */}
                  {viewedPokemon.entry_source !== "manual" && (
                    <button
                      onClick={() => setRightPanelTab("statistics")}
                      className={tabButtonClass(rightPanelTab === "statistics")}
                      title={t("dash.tabStatistics")}
                      aria-label={t("dash.tabStatistics")}
                    >
                      <BarChart3 className="w-3.5 h-3.5" />
                      <span className={tabLabelClass()}>{t("dash.tabStatistics")}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Center: Pokemon sprite + name + game badge — always centered via grid */}
              <div className="flex items-center gap-2 justify-center min-w-0">
                {isCustomSprite(viewedPokemon.sprite_url) ? (
                  <FreezableSprite
                    src={resolveSpriteUrl(viewedPokemon.id, viewedPokemon.sprite_url, imgError)}
                    alt={pokemonDisplayName(viewedPokemon)}
                    className="h-10 w-auto shrink-0 object-contain"
                    onError={() =>
                      setImgError((prev) => ({
                        ...prev,
                        [viewedPokemon.id]: resolveSpriteSrc(viewedPokemon.sprite_url),
                      }))
                    }
                  />
                ) : (
                  <TrimmedBoxSprite
                    canonicalName={viewedPokemon.canonical_name}
                    spriteType={viewedPokemon.sprite_type}
                    alt={pokemonDisplayName(viewedPokemon)}
                    className="h-10 w-auto shrink-0"
                    fallbackSrc={resolveSpriteSrc(viewedPokemon.sprite_url)}
                  />
                )}
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-sm font-bold text-text-primary leading-tight truncate">
                    {pokemonDisplayName(viewedPokemon)}
                  </span>
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
                    onClick={() => handleCaught(viewedPokemon)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-none bg-accent-blue hover:bg-accent-blue/90 border border-transparent text-xs font-bold transition-colors"
                    aria-label={t("dash.caught")}
                  >
                    <PartyPopper className="w-3.5 h-3.5" />
                    <span className="hidden 2xl:inline">{t("dash.caught")}</span>
                  </button>
                )}

                {/* 1b. Failed, negative state change before CTA */}
                {!viewedPokemon.completed_at && (
                  <button
                    onClick={() => handleFailed(viewedPokemon)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-none bg-accent-red hover:bg-accent-red/90 border border-transparent text-xs font-bold transition-colors"
                    aria-label={t("dash.failed")}
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span className="hidden 2xl:inline">{t("dash.failed")}</span>
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
          enablePokedexes
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
          enablePokedexes
        />
      )}
      {caughtChoiceHunt && (
        <CaughtChoiceModal
          targetName={caughtChoiceHunt.name}
          phaseNumber={computePhaseStats(caughtChoiceHunt, allPokemon).phaseNumber}
          onChoose={(choice) => handleCaughtChoice(caughtChoiceHunt.id, choice)}
          onClose={() => setCaughtChoiceId(null)}
        />
      )}
      {failedChoiceHunt && (
        <FailedChoiceModal
          targetName={failedChoiceHunt.name}
          phaseNumber={computePhaseStats(failedChoiceHunt, allPokemon).phaseNumber}
          onChoose={(choice) => handleFailedChoice(failedChoiceHunt.id, choice)}
          onClose={() => setFailedChoiceId(null)}
        />
      )}
      {endPhaseParent && (
        <EndPhaseModal
          parent={endPhaseParent}
          phaseNumber={computePhaseStats(endPhaseParent, allPokemon).phaseNumber}
          encounters={endPhaseParent.encounters}
          timerMs={computeTimerMs(endPhaseParent)}
          variant={endPhaseFailed ? "failed" : "caught"}
          onSubmit={(data) =>
            endPhaseFailed
              ? handleEndPhaseFailed(endPhaseParent, data)
              : handleEndPhase(endPhaseParent, data)
          }
          onClose={() => {
            setEndPhaseId(null);
            setEndPhaseFailed(false);
          }}
        />
      )}
      {catchMetaTarget && (
        <CatchMetaModal
          pokemon={catchMetaTarget}
          onSubmit={handleSaveCatchMeta}
          onClose={() => setCatchMetaId(null)}
        />
      )}
      {assignmentCompleteTarget && (
        <PokedexAssignmentModal
          pokemon={assignmentCompleteTarget}
          onClose={() => setAssignmentCompleteId(null)}
          onSave={async (ids) => {
            await fetch(apiUrl(`/api/pokemon/${assignmentCompleteTarget.id}`), {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...assignmentCompleteTarget, pokedex_ids: ids }),
            });
            setAssignmentCompleteId(null);
            const res = await fetch(
              apiUrl(`/api/pokemon/${assignmentCompleteTarget.id}/complete`),
              { method: "POST" },
            );
            if (res.ok) setCatchMetaId(assignmentCompleteTarget.id);
          }}
        />
      )}
      {showGroupModal && (
        <GroupManagementModal groups={groups} onClose={() => setShowGroupModal(false)} />
      )}
      {groupSourcePicker &&
        (() => {
          const pickerGroupId = groupSourcePicker.groupId;
          const pickerMembers = activeHunts.filter(
            (p) =>
              p.group_id === pickerGroupId &&
              !!p.detector_config &&
              (p.hunt_mode || "both") !== "timer",
          );
          return (
            <SourcePickerModal
              sourceType={groupSourcePicker.sourceType}
              autoRestore={false}
              onClose={() => setGroupSourcePicker(null)}
              onSelect={(source: SelectedSource) => {
                setGroupSourcePicker(null);
                const blocked = pickerMembers.some(
                  (p) => !!p.timer_started_at || !!detectorStatus[p.id] || isLoopRunning(p.id),
                );
                if (blocked || pickerMembers.length === 0) {
                  source.stream?.getTracks().forEach((track) => track.stop());
                  if (blocked)
                    pushToast({
                      type: "error",
                      title: t("group.sourceStopFirst"),
                      key: "group-capture",
                    });
                  return;
                }
                const type = source.type === "camera" ? "browser_camera" : "browser_display";
                void capture
                  .startCaptures(
                    pickerMembers.map((p) => p.id),
                    type,
                    source.sourceId,
                    source.label,
                    source.stream,
                  )
                  .then((ok) => {
                    if (!ok) {
                      pushToast({
                        type: "error",
                        title: t(capture.captureError || "capture.errStartFailed"),
                        key: "group-capture",
                      });
                      return;
                    }
                    saveGroupSource(pickerGroupId, {
                      type,
                      sourceId: source.sourceId,
                      sourceLabel: source.label,
                    });
                    saveGroupSourceType(pickerMembers, type);
                    const skipped =
                      activeHunts.filter((p) => p.group_id === pickerGroupId).length -
                      pickerMembers.length;
                    pushToast({
                      type: "success",
                      title: t(
                        skipped > 0 ? "group.sourceConnectedSkipped" : "group.sourceConnected",
                        { count: pickerMembers.length, skipped },
                      ),
                      key: "group-capture",
                    });
                  });
              }}
            />
          );
        })()}
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
        <div // NOSONAR: backdrop click dismisses unsaved-changes dialog
          ref={unsavedDialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="dashboard-unsaved-title"
          tabIndex={-1}
          className="fixed inset-0 z-90 bg-black/50 backdrop-blur-sm flex items-center-safe justify-center-safe animate-fadeIn"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPendingTab(null);
          }}
        >
          <div className="t-panel p-8 flex flex-col items-center gap-5 max-w-md mx-4 shadow-2xl anim-t-crt-in">
            <div className="w-14 h-14 rounded-full border border-accent-yellow/40 flex items-center justify-center">
              <AlertTriangle className="w-7 h-7 text-accent-yellow" />
            </div>
            <div className="text-center space-y-1.5">
              <p id="dashboard-unsaved-title" className="text-lg font-semibold text-text-primary">
                {t("overlay.unsavedTitle")}
              </p>
              <p className="text-sm text-text-muted">{t("overlay.unsavedDesc")}</p>
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
});
