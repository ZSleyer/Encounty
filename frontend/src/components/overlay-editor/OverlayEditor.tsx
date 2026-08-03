import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import {
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
  Monitor,
  Copy,
  ExternalLink,
  RotateCcw,
  LayoutTemplate,
} from "lucide-react";
import { EditorTutorial, type EditorTutorialModal } from "./EditorTutorial";
import {
  OverlaySettings,
  OverlayElementBase,
  GradientStop,
} from "../../types";
import type { Pokemon } from "../../types";
import { useHistory } from "../../hooks/useHistory";
import { Guide } from "../../hooks/useSnapping";
import { useI18n } from "../../contexts/I18nContext";
import { useToast } from "../../contexts/ToastContext";
import { ColorPickerModal } from "./controls/ColorPickerModal";
import { GradientEditorModal } from "./controls/GradientEditorModal";
import { ShadowEditorModal, type ShadowConfirmParams } from "./controls/ShadowEditorModal";
import { OutlineEditorModal } from "./controls/OutlineEditorModal";
import { TextColorEditorModal } from "./controls/TextColorEditorModal";
import { OverlayCanvas } from "./OverlayCanvas";
import { OverlayPropertyPanel, type OpenOutlineEditorParams } from "./OverlayPropertyPanel";
import { VerticalToolbar } from "./VerticalToolbar";
import { ConfirmModal } from "../shared/ConfirmModal";
import { TemplatePickerModal } from "./TemplatePickerModal";
import {
  buildDefaultOverlaySettings,
  type OverlayTemplate,
  type Translate,
} from "./overlayTemplates";
import { apiUrl } from "../../utils/api";
import {
  DRAGGABLE_ELEMENT_KEYS,
  ELEMENT_KEYS,
  type ElementKey,
} from "../../utils/overlayElements";

interface Props {
  settings: OverlaySettings;
  onUpdate: (settings: OverlaySettings) => void;
  activePokemon?: Pokemon;
  /** All tracked Pokemon, so the preview can derive phase, total counter and total timer. */
  previewPokemonList?: Pokemon[];
  overlayTargetId?: string;
  readOnly?: boolean;
  compact?: boolean;
}


/** Callback slot for the tutorial's dialog copies, which must not write anything. */
const NOOP = () => {};

/** Elements that were added after the first release and may be absent in stored settings. */
const MIGRATABLE_ELEMENT_KEYS = [
  "title",
  "timer",
  "odds",
  "phase",
  "total_counter",
  "total_timer",
] as const;

/**
 * fillMissingElements substitutes the default element for every overlay
 * element that predates the stored settings. A zero-sized element counts as
 * missing because that is how older backends persisted an unknown element.
 * Without it the layer list and the canvas would read `undefined.visible`.
 *
 * The substitute is always hidden, mirroring the Go copy of this rule in
 * backend/internal/state/persist.go: a layer the user never had must not
 * switch itself on just because a newer default ships it visible.
 *
 * It takes the translator because the substitute carries a caption, and a
 * caption is stored text: filling a missing layer in must write it in the
 * language the user is running.
 *
 * Exported for its own test: driving it through the component would only show
 * that a filled layer appears in the layer list, not where it was placed.
 */
export function fillMissingElements(settings: OverlaySettings, t: Translate): OverlaySettings {
  const filled = { ...settings };
  let defaults: OverlaySettings | null = null;
  for (const key of MIGRATABLE_ELEMENT_KEYS) {
    const el = filled[key];
    if (!el || (el.width === 0 && el.height === 0)) {
      defaults ??= buildDefaultOverlaySettings(t);
      // Structural assignment across a union of element shapes; the key always
      // picks the default of its own element type.
      const substitute = { ...defaults[key], visible: false } as OverlayElementBase;
      clampIntoCanvas(substitute, settings);
      (filled as Record<string, unknown>)[key] = substitute;
    }
  }
  return filled;
}

/**
 * Pulls a substituted element back inside the stored canvas. The defaults are
 * laid out for the current default canvas, which is taller than the one an
 * older overlay was saved with, so a filled-in layer would otherwise sit below
 * the panel and show up outside it the moment the user switches it on.
 *
 * Mirrors clampIntoCanvas in backend/internal/state/persist.go. The backend
 * normally clamps before the editor ever sees the state, so this is the safety
 * net for any path that does not go through it.
 */
function clampIntoCanvas(el: OverlayElementBase, canvas: OverlaySettings): void {
  if (canvas.canvas_width > 0 && el.x + el.width > canvas.canvas_width) {
    el.x = Math.max(0, canvas.canvas_width - el.width);
  }
  if (canvas.canvas_height > 0 && el.y + el.height > canvas.canvas_height) {
    el.y = Math.max(0, canvas.canvas_height - el.height);
  }
}

export function OBSSourceHint({ pokemonId }: Readonly<{ pokemonId?: string }>) {
  const { t } = useI18n();
  const { push, dismissByKey } = useToast();
  const [copied, setCopied] = useState(false);
  const baseUrl = apiUrl("") || globalThis.location.origin;
  const pokemonUrl = pokemonId ? `${baseUrl}/overlay/${pokemonId}` : null;

  const copy = (url: string) => {
    navigator.clipboard.writeText(url).then(() => {
      dismissByKey("clipboard-copy");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => push({ type: "error", title: t("overlay.errCopyFailed"), key: "clipboard-copy" }));
  };

  return (
    <div>
      <div className="flex items-center gap-1 text-xs 2xl:text-sm text-text-muted mb-1.5">
        <Monitor className="w-3 h-3 2xl:w-4 2xl:h-4" />
        OBS Browser Source:
      </div>
      {pokemonUrl ? (
        <>
          <div className="bg-bg-primary rounded-none px-2 py-1.5 2xl:px-2.5 2xl:py-2 mb-1.5">
            <code className="text-[10px] 2xl:text-xs text-accent-blue break-all">
              {pokemonUrl}
            </code>
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => copy(pokemonUrl)}
              className="flex items-center gap-1 px-2 py-1 2xl:px-2.5 2xl:py-1.5 rounded-none text-[10px] 2xl:text-xs bg-bg-primary hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
            >
              <Copy className="w-3 h-3 2xl:w-3.5 2xl:h-3.5" />
              {copied ? t("overlay.copied") : t("overlay.copy")}
            </button>
            <a
              href={pokemonUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-2 py-1 2xl:px-2.5 2xl:py-1.5 rounded-none text-[10px] 2xl:text-xs bg-bg-primary hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
            >
              <ExternalLink className="w-3 h-3 2xl:w-3.5 2xl:h-3.5" />
            </a>
          </div>
        </>
      ) : (
        <p className="text-[10px] 2xl:text-xs text-text-faint">{t("overlay.selectPokemon")}</p>
      )}
    </div>
  );
}

export function OverlayEditor({ settings, onUpdate, activePokemon, previewPokemonList, overlayTargetId: _overlayTargetId, readOnly, compact }: Readonly<Props>) {
  const { t } = useI18n();
  const { push } = useToast();
  const ELEMENT_LABELS: Record<ElementKey, string> = {
    sprite: "Sprite",
    name: "Name",
    title: t("overlay.elementTitle"),
    counter: t("overlay.elementCounter"),
    timer: t("overlay.elementTimer"),
    odds: t("overlay.elementOdds"),
    phase: t("overlay.elementPhase"),
    total_counter: t("overlay.elementTotalCounter"),
    total_timer: t("overlay.elementTotalTimer"),
    canvas: "Canvas",
  };
  const [localSettings, setLocalSettings] = useState<OverlaySettings>(() => fillMissingElements(settings, t));
  const [selectedEl, setSelectedEl] = useState<ElementKey>("sprite");
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [canvasScale, setCanvasScale] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [testTrigger, setTestTrigger] = useState<{
    element: ElementKey;
    n: number;
    reverse?: boolean;
  }>({ element: "counter", n: 0 });

  // Toolbar state
  const [showGrid, setShowGrid] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [gridSize, setGridSize] = useState(16);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [guides, setGuides] = useState<Guide[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // Zoom + Pan (Phase 4) — scroll-based
  const [activeTool, setActiveTool] = useState<"pointer" | "hand" | "zoom">("pointer");
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [altHeld, setAltHeld] = useState(false);
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);
  const zoomRef = useRef(1);
  const panDragStart = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const [isPanDragging, setIsPanDragging] = useState(false);
  const zoomDragStart = useRef<{ clientX: number; zoom: number; anchorMx: number; anchorMy: number } | null>(null);
  const [isZoomDragging, setIsZoomDragging] = useState(false);

  // Right panel split — draggable divider between properties and layers
  const [propertiesHeight, setPropertiesHeight] = useState(() => {
    try {
      const stored = localStorage.getItem("encounty_editor_split");
      return stored ? Number(stored) : 500;
    } catch { return 500; }
  });
  const dividerDragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  // Tutorial
  const [showTutorial, setShowTutorial] = useState(false);
  // Dialog the current walkthrough step points into. It is a separate state
  // from the editor's own modals on purpose: the copy opened here gets no
  // callback that could write a setting.
  const [tutorialModal, setTutorialModal] = useState<EditorTutorialModal | null>(null);

  // Template picker: the picked template waits in pendingTemplate until the
  // user confirms, because applying it discards the current layout.
  const [showTemplates, setShowTemplates] = useState(false);
  const [pendingTemplate, setPendingTemplate] = useState<OverlayTemplate | null>(null);

  // Canvas background for testing (transparent = checkered, white, black)
  const [canvasBg, setCanvasBg] = useState<"transparent" | "white" | "black">("transparent");

  const bgPreviewUrl = localSettings.background_image
    ? apiUrl(`/api/backgrounds/${localSettings.background_image}`)
    : "";

  const effectiveTool = spaceHeld ? "hand" : activeTool;

  // Background image upload state
  const [bgUploading, setBgUploading] = useState(false);

  // Padding around canvas in the virtual scroll area
  const getPadding = useCallback(() => {
    const c = canvasContainerRef.current;
    if (!c) return { x: 200, y: 200 };
    return { x: c.clientWidth * 0.4, y: c.clientHeight * 0.4 };
  }, []);

  const fireTest = (element: ElementKey, reverse = false) =>
    setTestTrigger({ element, n: Date.now(), reverse });

  // Local fake counter — isolated from live OBS overlay
  const [fakeCount, setFakeCount] = useState<number | null>(null);
  useEffect(() => {
    setFakeCount(null);
  }, [activePokemon?.id]);
  const currentCount =
    fakeCount ?? activePokemon?.encounters ?? 0;

  // total_timer is deliberately absent: like the plain timer it only has an
  // idle animation, so there is no trigger channel to fire.
  const testIncrement = () => {
    setFakeCount(currentCount + 1);
    fireTest("counter");
    fireTest("sprite");
    fireTest("name");
    fireTest("title");
    fireTest("odds");
    fireTest("phase");
    fireTest("total_counter");
  };
  const testDecrement = () => {
    if (currentCount > 0) {
      setFakeCount(currentCount - 1);
      fireTest("counter", true);
      fireTest("sprite", true);
      fireTest("name", true);
      fireTest("title", true);
      fireTest("odds", true);
      fireTest("phase", true);
      fireTest("total_counter", true);
    }
  };
  const testReset = () => {
    setFakeCount(0);
    fireTest("counter");
  };

  // History for undo/redo
  const history = useHistory<OverlaySettings>(settings, 400);

  // --- Modal state management ---
  const [colorPickerTarget, setColorPickerTarget] = useState<{
    currentColor: string; opacity?: number; showOpacity?: boolean;
    onConfirm: (color: string, opacity?: number) => void;
  } | null>(null);
  const [gradientEditorTarget, setGradientEditorTarget] = useState<{
    stops: GradientStop[]; angle: number;
    onConfirm: (stops: GradientStop[], angle: number) => void;
  } | null>(null);
  const [shadowEditorTarget, setShadowEditorTarget] = useState<
    (ShadowConfirmParams & { onConfirm: (params: ShadowConfirmParams) => void }) | null
  >(null);
  const [outlineEditorTarget, setOutlineEditorTarget] = useState<OpenOutlineEditorParams | null>(null);
  const [textColorEditorTarget, setTextColorEditorTarget] = useState<{
    colorType: "solid" | "gradient"; color: string;
    gradientStops: GradientStop[]; gradientAngle: number;
    onConfirm: (colorType: "solid" | "gradient", color: string, gradientStops: GradientStop[], gradientAngle: number) => void;
  } | null>(null);

  /** Open the shared ColorPickerModal bound to a specific property. */
  const openColorPicker = useCallback(
    (color: string, onPick: (c: string) => void, opts?: { opacity?: number; showOpacity?: boolean }) => {
      setColorPickerTarget({
        currentColor: color,
        opacity: opts?.opacity,
        showOpacity: opts?.showOpacity,
        onConfirm: (c, o) => { onPick(c); if (opts?.showOpacity && o !== undefined) { /* handled by caller */ } },
      });
    },
    [],
  );

  /** Open the shared OutlineEditorModal. */
  const openOutlineEditor = useCallback((params: OpenOutlineEditorParams) => {
    setOutlineEditorTarget(params);
  }, []);

  /** Open the shared ShadowEditorModal. */
  const openShadowEditor = useCallback(
    (params: ShadowConfirmParams & { onConfirm: (p: ShadowConfirmParams) => void }) => {
      setShadowEditorTarget(params);
    },
    [],
  );

  /** Open the shared TextColorEditorModal. */
  const openTextColorEditor = useCallback(
    (
      colorType: "solid" | "gradient", color: string,
      gradientStops: GradientStop[], gradientAngle: number,
      onConfirm: (ct: "solid" | "gradient", c: string, gs: GradientStop[], ga: number) => void,
    ) => {
      setTextColorEditorTarget({ colorType, color, gradientStops, gradientAngle, onConfirm });
    },
    [],
  );

  useEffect(() => {
    setLocalSettings(fillMissingElements(settings, t));
  }, [settings, t]);

  // Keep zoomRef in sync
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  // Compute scale to fit canvas in the preview area + center it initially
  const hasInitialCentered = useRef(false);
  useEffect(() => {
    const updateScale = () => {
      if (!canvasContainerRef.current) return;
      const { clientWidth, clientHeight } = canvasContainerRef.current;
      const scaleX = clientWidth / localSettings.canvas_width;
      const scaleY = clientHeight / localSettings.canvas_height;
      const scale = Math.min(scaleX, scaleY, 1);
      setCanvasScale(scale);
      // Center the canvas via pending scroll (applied after DOM update by useLayoutEffect)
      const pad = getPadding();
      const es = scale * zoom;
      const scaledW = localSettings.canvas_width * es;
      const scaledH = localSettings.canvas_height * es;
      pendingScroll.current = {
        left: pad.x - (clientWidth - scaledW) / 2,
        top: pad.y - (clientHeight - scaledH) / 2,
      };
    };
    updateScale();
    if (!hasInitialCentered.current) hasInitialCentered.current = true;
    globalThis.addEventListener("resize", updateScale);
    return () => globalThis.removeEventListener("resize", updateScale);
  }, [localSettings.canvas_width, localSettings.canvas_height, getPadding]);

  // Apply pending scroll position after DOM update (zoom changes virtual size)
  useLayoutEffect(() => {
    if (pendingScroll.current && canvasContainerRef.current) {
      canvasContainerRef.current.scrollLeft = pendingScroll.current.left;
      canvasContainerRef.current.scrollTop = pendingScroll.current.top;
      pendingScroll.current = null;
    }
  });

  // Scroll to zoom (anchored to cursor position)
  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const oldZoom = zoomRef.current;
      const newZoom = Math.min(4, Math.max(0.1, oldZoom - e.deltaY * 0.001));
      if (newZoom === oldZoom) return;

      // Point in virtual space under cursor (before zoom)
      const pad = getPadding();
      const vxBefore = container.scrollLeft + mx;
      const vyBefore = container.scrollTop + my;

      // Canvas coords of that point
      const oldEs = canvasScale * oldZoom;
      const cx = (vxBefore - pad.x) / oldEs;
      const cy = (vyBefore - pad.y) / oldEs;

      // After zoom: where that canvas point will be
      const newEs = canvasScale * newZoom;
      const newVx = cx * newEs + pad.x;
      const newVy = cy * newEs + pad.y;

      // Schedule scroll adjustment after render
      pendingScroll.current = { left: newVx - mx, top: newVy - my };
      setZoom(newZoom);
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [canvasScale, getPadding]);

  const update = useCallback(
    (s: OverlaySettings) => {
      setLocalSettings(s);
      onUpdate(s);
      history.push(s);
    },
    [onUpdate, history],
  );



  const updateSelectedEl = useCallback(
    (patch: Partial<OverlayElementBase>) => {
      if (selectedEl === "canvas") return;
      const el = localSettings[selectedEl] as OverlayElementBase;
      update({ ...localSettings, [selectedEl]: { ...el, ...patch } });
    },
    [localSettings, selectedEl, update],
  );

  const effectiveScale = canvasScale * zoom;

  const moveLayer = (key: ElementKey, dir: "up" | "down") => {
    if (key === "canvas") return;
    const el = localSettings[key] as OverlayElementBase;
    const delta = dir === "up" ? 1 : -1;
    update({
      ...localSettings,
      [key]: { ...el, z_index: Math.max(0, el.z_index + delta) },
    });
  };

  /** Handles undo/redo keyboard shortcuts. Returns true if the event was handled. */
  const handleUndoRedo = useCallback((e: KeyboardEvent): boolean => {
    if (e.ctrlKey && e.key === "z") {
      e.preventDefault();
      if (history.canUndo) {
        history.undo();
        const prev = history.current;
        setLocalSettings(prev);
        onUpdate(prev);
      }
      return true;
    }
    if (e.ctrlKey && e.key === "y") {
      e.preventDefault();
      if (history.canRedo) {
        history.redo();
        const next = history.current;
        setLocalSettings(next);
        onUpdate(next);
      }
      return true;
    }
    return false;
  }, [history, onUpdate]);

  /** Handles arrow-key nudging and element selection shortcuts. Returns true if the event was handled. */
  const handleElementKeys = useCallback((e: KeyboardEvent): boolean => {
    if (!selectedEl || selectedEl === "canvas") return false;
    const el = localSettings[selectedEl] as OverlayElementBase;
    const step = e.shiftKey ? 10 : 1;

    const arrowActions: Record<string, () => void> = {
      ArrowLeft: () => updateSelectedEl({ x: el.x - step }),
      ArrowRight: () => updateSelectedEl({ x: el.x + step }),
      ArrowUp: () => updateSelectedEl({ y: el.y - step }),
      ArrowDown: () => updateSelectedEl({ y: el.y + step }),
    };

    const arrowAction = arrowActions[e.key];
    if (arrowAction) {
      e.preventDefault();
      arrowAction();
      return true;
    }
    if (e.key === "Escape") {
      setSelectedEl("sprite");
      return true;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const idx = ELEMENT_KEYS.indexOf(selectedEl);
      setSelectedEl(ELEMENT_KEYS[(idx + 1) % ELEMENT_KEYS.length]);
      return true;
    }
    return false;
  }, [selectedEl, localSettings, updateSelectedEl]);

  // Keyboard navigation + spacebar for hand tool
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Every editor modal is a native <dialog> opened with showModal(). While
      // one is up the canvas shortcuts must stay out of the way: the Tab branch
      // below calls preventDefault(), which would otherwise pin the focus to
      // the dialog's first control and make the modal unusable by keyboard.
      if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return;

      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = ["INPUT", "SELECT", "TEXTAREA"].includes(tag);

      if (e.key === "Alt") {
        setAltHeld(true);
        return;
      }

      if (!isInput) {
        if (e.key === "v" || e.key === "V") { setActiveTool("pointer"); return; }
        if (e.key === "h" || e.key === "H") { setActiveTool("hand"); return; }
        if (e.key === "z" || e.key === "Z") { setActiveTool("zoom"); return; }
      }

      // Space for hand tool (not in input/select/textarea)
      if (e.code === "Space" && !isInput) {
        e.preventDefault();
        setSpaceHeld(true);
        return;
      }
      if (handleUndoRedo(e)) return;
      handleElementKeys(e);
    };
    const upHandler = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        setAltHeld(false);
      }
      if (e.code === "Space") {
        setSpaceHeld(false);
      }
    };
    globalThis.addEventListener("keydown", handler);
    globalThis.addEventListener("keyup", upHandler);
    return () => {
      globalThis.removeEventListener("keydown", handler);
      globalThis.removeEventListener("keyup", upHandler);
    };
  }, [handleUndoRedo, handleElementKeys]);

  // Show tutorial on first visit
  useEffect(() => {
    if (!localStorage.getItem("encounty_editor_tutorial_seen")) {
      setShowTutorial(true);
    }
  }, []);

  // Track mouse position over canvas (scroll-aware)
  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const container = canvasContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;
    const pad = getPadding();
    const vx = container.scrollLeft + rawX - pad.x;
    const vy = container.scrollTop + rawY - pad.y;
    const x = Math.round(vx / effectiveScale);
    const y = Math.round(vy / effectiveScale);
    setMousePos({ x, y });

    // Zoom drag — smooth zoom by horizontal mouse movement
    if (isZoomDragging && zoomDragStart.current) {
      const dx = e.clientX - zoomDragStart.current.clientX;
      const newZoom = Math.min(4, Math.max(0.1, zoomDragStart.current.zoom * Math.pow(2, dx / 200)));
      // Re-anchor scroll so the original click point stays fixed
      const anchor = zoomDragStart.current;
      const newEs = canvasScale * newZoom;
      const oldEs = canvasScale * zoomRef.current;
      const pad = getPadding();
      const vxBefore = container.scrollLeft + anchor.anchorMx;
      const vyBefore = container.scrollTop + anchor.anchorMy;
      const cx = (vxBefore - pad.x) / oldEs;
      const cy = (vyBefore - pad.y) / oldEs;
      const newVx = cx * newEs + pad.x;
      const newVy = cy * newEs + pad.y;
      pendingScroll.current = { left: newVx - anchor.anchorMx, top: newVy - anchor.anchorMy };
      setZoom(newZoom);
      return;
    }

    // Pan dragging via scroll
    if (isPanDragging && panDragStart.current) {
      container.scrollLeft = panDragStart.current.sl - (e.clientX - panDragStart.current.x);
      container.scrollTop = panDragStart.current.st - (e.clientY - panDragStart.current.y);
    }
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (effectiveTool === "zoom") {
      e.preventDefault();
      const container = canvasContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      zoomDragStart.current = {
        clientX: e.clientX,
        zoom: zoomRef.current,
        anchorMx: e.clientX - rect.left,
        anchorMy: e.clientY - rect.top,
      };
      setIsZoomDragging(true);
      return;
    }
    if (effectiveTool === "hand") {
      e.preventDefault();
      const container = canvasContainerRef.current;
      if (!container) return;
      setIsPanDragging(true);
      panDragStart.current = { x: e.clientX, y: e.clientY, sl: container.scrollLeft, st: container.scrollTop };
    }
  };

  const handleCanvasMouseUp = () => {
    if (isZoomDragging) {
      setIsZoomDragging(false);
      zoomDragStart.current = null;
    }
    if (isPanDragging) {
      setIsPanDragging(false);
      panDragStart.current = null;
    }
  };

  /** Zoom towards/away from a specific screen point (for zoom tool clicks). */
  const handleZoomAtPoint = useCallback((clientX: number, clientY: number, direction: "in" | "out") => {
    const container = canvasContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const oldZoom = zoomRef.current;
    const factor = direction === "in" ? 1.5 : 1 / 1.5;
    const newZoom = Math.min(4, Math.max(0.1, oldZoom * factor));
    if (newZoom === oldZoom) return;

    const pad = getPadding();
    const vxBefore = container.scrollLeft + mx;
    const vyBefore = container.scrollTop + my;
    const oldEs = canvasScale * oldZoom;
    const cx = (vxBefore - pad.x) / oldEs;
    const cy = (vyBefore - pad.y) / oldEs;
    const newEs = canvasScale * newZoom;
    const newVx = cx * newEs + pad.x;
    const newVy = cy * newEs + pad.y;

    pendingScroll.current = { left: newVx - mx, top: newVy - my };
    setZoom(newZoom);
  }, [canvasScale, getPadding]);

  /** Selects a specific element (e.g. on double-click) and scrolls its properties into view. */
  const openPropertiesForElement = useCallback((key: ElementKey) => {
    setSelectedEl(key);
  }, []);

  // Fit-to-view: reset zoom and center canvas via scroll
  const fitToView = () => {
    const container = canvasContainerRef.current;
    if (!container) return;
    const { clientWidth, clientHeight } = container;
    const scaleX = clientWidth / localSettings.canvas_width;
    const scaleY = clientHeight / localSettings.canvas_height;
    const fitScale = Math.min(scaleX, scaleY, 1);
    setZoom(1);
    setCanvasScale(fitScale);
    // Center via scroll after render
    const pad = getPadding();
    const scaledW = localSettings.canvas_width * fitScale;
    const scaledH = localSettings.canvas_height * fitScale;
    pendingScroll.current = {
      left: pad.x - (clientWidth - scaledW) / 2,
      top: pad.y - (clientHeight - scaledH) / 2,
    };
  };

  /** Reads a File as a base64 data URL. */
  const readFileAsBase64 = (file: File): Promise<string> => {
    const reader = new FileReader();
    return new Promise<string>((resolve) => {
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });
  };

  /** Uploads a background image file and applies it to the overlay settings. */
  const processBackgroundFile = async (file: File) => {
    setBgUploading(true);
    try {
      const base64 = await readFileAsBase64(file);
      const res = await fetch(apiUrl("/api/backgrounds/upload"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_base64: base64 }),
      });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      const data = await res.json();
      update({ ...localSettings, background_image: data.filename, background_image_fit: localSettings.background_image_fit || "cover" });
    } catch (err) {
      console.error("Background upload failed:", err);
      push({ type: "error", title: t("overlay.errUploadFailed"), key: "overlay-bg-upload" });
    }
    setBgUploading(false);
  };

  // Background image upload handler
  const handleBgUpload = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) processBackgroundFile(file);
    };
    input.click();
  };

  const handleBgRemove = async () => {
    if (localSettings.background_image) {
      await fetch(apiUrl(`/api/backgrounds/${localSettings.background_image}`), { method: "DELETE" }).catch(
        () => push({ type: "error", title: t("overlay.errUploadFailed"), key: "overlay-bg-upload" }),
      );
      update({ ...localSettings, background_image: "", background_image_fit: "cover" });
    }
  };

  /** Starts dragging the divider between properties and layers panels. */
  const startDividerDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dividerDragRef.current = { startY: e.clientY, startHeight: propertiesHeight };
    const onMove = (ev: MouseEvent) => {
      if (!dividerDragRef.current) return;
      const dy = ev.clientY - dividerDragRef.current.startY;
      const newH = Math.max(100, Math.min(dividerDragRef.current.startHeight + dy, globalThis.innerHeight - 200));
      setPropertiesHeight(newH);
    };
    const onUp = () => {
      globalThis.removeEventListener("mousemove", onMove);
      globalThis.removeEventListener("mouseup", onUp);
      setPropertiesHeight(h => { try { localStorage.setItem("encounty_editor_split", String(h)); } catch {} return h; });
      dividerDragRef.current = null;
    };
    globalThis.addEventListener("mousemove", onMove);
    globalThis.addEventListener("mouseup", onUp);
  }, [propertiesHeight]);

  /** Resizes the properties/layers divider via arrow keys, mirroring the mouse-drag clamping and persistence. */
  const handleDividerKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const step = e.key === "ArrowUp" ? -24 : 24;
    setPropertiesHeight(h => {
      const newH = Math.max(100, Math.min(h + step, globalThis.innerHeight - 200));
      try { localStorage.setItem("encounty_editor_split", String(newH)); } catch {}
      return newH;
    });
  }, []);

  return (
    <div className={`flex min-h-0 h-full ${compact ? "pb-2" : ""}`}>
      {/* Left vertical toolbar */}
      <VerticalToolbar
        activeTool={activeTool}
        onToolChange={setActiveTool}
        showGrid={showGrid}
        onToggleGrid={() => setShowGrid((v) => !v)}
        snapEnabled={snapEnabled}
        onToggleSnap={() => setSnapEnabled((v) => !v)}
        gridSize={gridSize}
        onGridSizeChange={setGridSize}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onUndo={() => {
          if (history.canUndo) {
            history.undo();
            setLocalSettings(history.current);
            onUpdate(history.current);
          }
        }}
        onRedo={() => {
          if (history.canRedo) {
            history.redo();
            setLocalSettings(history.current);
            onUpdate(history.current);
          }
        }}
        onFitToView={fitToView}
        canvasBg={canvasBg}
        onCanvasBgChange={setCanvasBg}
        zoom={zoom}
        mousePos={mousePos}
        activePokemon={!!activePokemon}
        currentCount={currentCount}
        onTestIncrement={testIncrement}
        onTestDecrement={testDecrement}
        onTestReset={testReset}
        onShowTutorial={() => setShowTutorial(true)}
      />

      {/* Center: Canvas (takes all remaining space) */}
      <div className="flex-1 min-w-0 flex flex-col p-2">
        <OverlayCanvas
          localSettings={localSettings}
          selectedEl={selectedEl}
          effectiveScale={effectiveScale}
          showGrid={showGrid}
          gridSize={gridSize}
          snapEnabled={snapEnabled}
          guides={guides}
          isDragging={isDragging}
          effectiveTool={effectiveTool}
          isPanDragging={isPanDragging}
          canvasBg={canvasBg}
          testTrigger={testTrigger}
          fakeCount={fakeCount}
          activePokemon={activePokemon}
          previewPokemonList={previewPokemonList}
          readOnly={readOnly}
          canvasContainerRef={canvasContainerRef}
          altHeld={altHeld}
          onMouseMove={handleCanvasMouseMove}
          onMouseDown={handleCanvasMouseDown}
          onMouseUp={handleCanvasMouseUp}
          onSelectElement={setSelectedEl}
          onDragStateChange={setIsDragging}
          onGuidesChange={setGuides}
          onUpdate={update}
          onZoomAtPoint={handleZoomAtPoint}
          onDoubleClickElement={openPropertiesForElement}
        />
      </div>

      {/* Right panel: Properties (top) + Layers (bottom) with draggable divider */}
      <div className={`w-72 shrink-0 flex flex-col min-h-0 bg-bg-secondary border-l border-border-subtle ${readOnly ? "pointer-events-none opacity-60" : ""}`}>
        {/* Properties section (top, resizable) */}
        <div style={{ height: propertiesHeight }} className="overflow-y-auto shrink-0" data-tutorial="properties">
          <div className="px-4 py-3">
            <OverlayPropertyPanel
              localSettings={localSettings}
              selectedEl={selectedEl}
              updateSelectedEl={updateSelectedEl}
              readOnly={readOnly}
              embedded
              activePokemon={activePokemon}
              onUpdate={update}
              openColorPicker={openColorPicker}
              openOutlineEditor={openOutlineEditor}
              openShadowEditor={openShadowEditor}
              openTextColorEditor={openTextColorEditor}
              fireTest={fireTest}
              bgPreviewUrl={bgPreviewUrl}
              bgUploading={bgUploading}
              onBgUpload={handleBgUpload}
              onBgRemove={handleBgRemove}
            />
          </div>
        </div>

        {/* Draggable divider */}
        <div className="relative group shrink-0">
          <button
            type="button"
            onMouseDown={startDividerDrag}
            onKeyDown={handleDividerKeyDown}
            className="w-full h-6 cursor-row-resize bg-transparent border-none p-0 flex items-center"
            aria-label={t("overlay.resizeDivider")}
          >
            {/* 24px tall hit target (WCAG 2.5.8) with a 6px visible bar centered inside */}
            <span className="w-full h-1.5 bg-border-subtle group-hover:bg-accent-blue/40 group-active:bg-accent-blue/60 transition-colors" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setPropertiesHeight(500);
              try { localStorage.removeItem("encounty_editor_split"); } catch {}
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 bg-bg-secondary border border-border-subtle rounded-none p-1 text-text-muted hover:text-text-primary transition-opacity z-10 after:absolute after:-inset-2 after:content-['']"
            title={t("tooltip.editor.resetLayout")}
            aria-label={t("tooltip.editor.resetLayout")}
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        </div>

        {/* Layers section (bottom, fills remaining space) */}
        <div data-tutorial="layers" className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-1">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider">
              {t("overlay.layers")}
            </h3>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setShowTemplates(true)}
                data-tutorial="templates"
                title={t("overlay.templatesTitle")}
                aria-label={t("overlay.templatesTitle")}
                className="flex items-center gap-1 px-1 py-0.5 rounded-none text-[10px] text-text-muted hover:text-accent-blue hover:bg-accent-blue/10 transition-colors relative after:absolute after:-inset-2 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-blue"
              >
                <LayoutTemplate className="w-3 h-3" />
              </button>
              <button
                onClick={() => update(buildDefaultOverlaySettings(t))}
                title={t("tooltip.editor.resetLayout")}
                className="flex items-center gap-1 px-1 py-0.5 rounded-none text-[10px] text-text-muted hover:text-accent-red hover:bg-accent-red/10 transition-colors relative after:absolute after:-inset-2 after:content-['']"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
          </div>
          {DRAGGABLE_ELEMENT_KEYS
            .map((key) => {
              const el = localSettings[key] as OverlayElementBase;
              return (
                <div
                  key={key}
                  className={`flex items-center justify-between px-2 py-1.5 rounded-none transition-colors w-full ${
                    selectedEl === key
                      ? "bg-accent-blue/20 border border-accent-blue/40"
                      : "hover:bg-bg-hover border border-transparent"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedEl(key)}
                    className="flex-1 text-left cursor-pointer bg-transparent border-none p-0"
                    aria-label={ELEMENT_LABELS[key]}
                  >
                    <span className="text-xs text-text-primary">
                      {ELEMENT_LABELS[key]}
                    </span>
                  </button>
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      title={t("tooltip.editor.moveUp")}
                      aria-label={t("tooltip.editor.moveUp")}
                      onClick={() => moveLayer(key, "up")}
                      className="p-1.5 text-text-muted hover:text-text-primary transition-colors"
                    >
                      <ChevronUp className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      title={t("tooltip.editor.moveDown")}
                      aria-label={t("tooltip.editor.moveDown")}
                      onClick={() => moveLayer(key, "down")}
                      className="p-1.5 text-text-muted hover:text-text-primary transition-colors"
                    >
                      <ChevronDown className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      title={el.visible ? t("tooltip.editor.hide") : t("tooltip.editor.show")}
                      aria-label={el.visible ? t("tooltip.editor.hide") : t("tooltip.editor.show")}
                      onClick={() => {
                        update({
                          ...localSettings,
                          [key]: { ...el, visible: !el.visible },
                        });
                      }}
                      className="p-1.5 text-text-muted hover:text-text-primary transition-colors"
                    >
                      {el.visible ? (
                        <Eye className="w-3 h-3" />
                      ) : (
                        <EyeOff className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                </div>
              );
            })}

          {/* Canvas layer — always at bottom */}
          <div
            className={`flex items-center justify-between px-2 py-1.5 rounded-none transition-colors w-full ${
              selectedEl === "canvas"
                ? "bg-accent-blue/20 border border-accent-blue/40"
                : "hover:bg-bg-hover border border-transparent"
            }`}
          >
            <button
              type="button"
              onClick={() => setSelectedEl("canvas")}
              className="flex-1 text-left cursor-pointer bg-transparent border-none p-0"
              aria-label="Canvas"
            >
              <span className="text-xs text-text-primary">Canvas</span>
            </button>
            <div className="flex items-center gap-0.5">
              <span className="p-1 text-text-faint cursor-not-allowed">
                <ChevronUp className="w-3 h-3" />
              </span>
              <span className="p-1 text-text-faint cursor-not-allowed">
                <ChevronDown className="w-3 h-3" />
              </span>
              <button
                type="button"
                title={localSettings.hidden ? t("tooltip.editor.show") : t("tooltip.editor.hide")}
                aria-label={localSettings.hidden ? t("tooltip.editor.show") : t("tooltip.editor.hide")}
                onClick={() => update({ ...localSettings, hidden: !localSettings.hidden })}
                className="p-1.5 text-text-muted hover:text-text-primary transition-colors"
              >
                {localSettings.hidden ? (
                  <EyeOff className="w-3 h-3" />
                ) : (
                  <Eye className="w-3 h-3" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Template picker + its confirmation, both applied like the reset button */}
      {showTemplates && (
        <TemplatePickerModal
          onSelect={setPendingTemplate}
          onClose={() => setShowTemplates(false)}
        />
      )}
      {pendingTemplate && (
        <ConfirmModal
          title={t("overlay.templateConfirmTitle")}
          message={t("overlay.templateConfirmMessage", { name: t(pendingTemplate.nameKey) })}
          confirmLabel={t("overlay.templateApply")}
          isDestructive
          onConfirm={() => update(pendingTemplate.settings)}
          onClose={() => setPendingTemplate(null)}
        />
      )}

      {/* Tutorial overlay */}
      {showTutorial && (
        <EditorTutorial
          onComplete={() => {
            setShowTutorial(false);
            setTutorialModal(null);
            localStorage.setItem("encounty_editor_tutorial_seen", "true");
          }}
          onSelectElement={setSelectedEl}
          onOpenModal={setTutorialModal}
        />
      )}

      {/* Dialogs a walkthrough step points into. They are deliberately wired to
          nothing: no onSelect, no onConfirm and no nested editor, so a step can
          show what a dialog looks like without ever writing a setting. The
          walkthrough re-enters the top layer above them, which makes them inert
          anyway, and leaving the step unmounts them. */}
      {tutorialModal === "templates" && (
        <TemplatePickerModal onSelect={NOOP} onClose={NOOP} />
      )}
      {tutorialModal === "text-color" && (
        <TextColorEditorModal
          colorType={localSettings.counter.style.color_type}
          color={localSettings.counter.style.color}
          gradientStops={localSettings.counter.style.gradient_stops}
          gradientAngle={localSettings.counter.style.gradient_angle}
          onConfirm={NOOP}
          onClose={NOOP}
          onOpenColorPicker={NOOP}
          onOpenGradientEditor={NOOP}
        />
      )}

      {/* --- Shared modal instances (unchanged) --- */}
      {colorPickerTarget && (
        <ColorPickerModal
          color={colorPickerTarget.currentColor}
          opacity={colorPickerTarget.opacity}
          showOpacity={colorPickerTarget.showOpacity}
          onConfirm={(color, opacity) => {
            colorPickerTarget.onConfirm(color, opacity);
            setColorPickerTarget(null);
          }}
          onClose={() => setColorPickerTarget(null)}
        />
      )}
      {gradientEditorTarget && (
        <GradientEditorModal
          stops={gradientEditorTarget.stops}
          angle={gradientEditorTarget.angle}
          onConfirm={(stops, angle) => {
            gradientEditorTarget.onConfirm(stops, angle);
            setGradientEditorTarget(null);
          }}
          onClose={() => setGradientEditorTarget(null)}
          onOpenColorPicker={(color, onPick) =>
            openColorPicker(color, onPick)
          }
        />
      )}
      {shadowEditorTarget && (
        <ShadowEditorModal
          enabled={shadowEditorTarget.enabled}
          color={shadowEditorTarget.color}
          blur={shadowEditorTarget.blur}
          x={shadowEditorTarget.x}
          y={shadowEditorTarget.y}
          onConfirm={(params) => {
            shadowEditorTarget.onConfirm(params);
            setShadowEditorTarget(null);
          }}
          onClose={() => setShadowEditorTarget(null)}
          onOpenColorPicker={(color, onPick) =>
            openColorPicker(color, onPick)
          }
        />
      )}
      {textColorEditorTarget && (
        <TextColorEditorModal
          colorType={textColorEditorTarget.colorType}
          color={textColorEditorTarget.color}
          gradientStops={textColorEditorTarget.gradientStops}
          gradientAngle={textColorEditorTarget.gradientAngle}
          onConfirm={(colorType, color, gradientStops, gradientAngle) => {
            textColorEditorTarget.onConfirm(colorType, color, gradientStops, gradientAngle);
            setTextColorEditorTarget(null);
          }}
          onClose={() => setTextColorEditorTarget(null)}
          onOpenColorPicker={(color, onPick) =>
            openColorPicker(color, onPick)
          }
          onOpenGradientEditor={(stops, angle, onConfirm) =>
            setGradientEditorTarget({ stops, angle, onConfirm })
          }
        />
      )}
      {outlineEditorTarget && (
        <OutlineEditorModal
          type={outlineEditorTarget.type}
          color={outlineEditorTarget.color}
          width={outlineEditorTarget.width}
          gradientStops={outlineEditorTarget.gradientStops}
          gradientAngle={outlineEditorTarget.gradientAngle}
          onConfirm={(type, color, width, gradientStops, gradientAngle) => {
            outlineEditorTarget.onConfirm(type, color, width, gradientStops, gradientAngle);
            setOutlineEditorTarget(null);
          }}
          onClose={() => setOutlineEditorTarget(null)}
          onOpenColorPicker={(color, onPick) =>
            openColorPicker(color, onPick)
          }
          onOpenGradientEditor={(stops, angle, onConfirm) =>
            setGradientEditorTarget({ stops, angle, onConfirm })
          }
        />
      )}
    </div>
  );
}
