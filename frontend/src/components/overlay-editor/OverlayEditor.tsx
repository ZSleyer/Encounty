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
} from "lucide-react";
import { EditorTutorial } from "./EditorTutorial";
import {
  OverlaySettings,
  OverlayElementBase,
  TextStyle,
  GradientStop,
} from "../../types";
import type { Pokemon } from "../../types";
import { useHistory } from "../../hooks/useHistory";
import { Guide } from "../../hooks/useSnapping";
import { useI18n } from "../../contexts/I18nContext";
import { ColorPickerModal } from "./controls/ColorPickerModal";
import { GradientEditorModal } from "./controls/GradientEditorModal";
import { ShadowEditorModal, type ShadowConfirmParams } from "./controls/ShadowEditorModal";
import { OutlineEditorModal } from "./controls/OutlineEditorModal";
import { TextColorEditorModal } from "./controls/TextColorEditorModal";
import { OverlayCanvas } from "./OverlayCanvas";
import { OverlayPropertyPanel } from "./OverlayPropertyPanel";
import { VerticalToolbar } from "./VerticalToolbar";
import { FloatingPropertiesPanel } from "./FloatingPropertiesPanel";
import { useDraggableWindow } from "../../hooks/useDraggableWindow";
import { apiUrl } from "../../utils/api";

interface Props {
  settings: OverlaySettings;
  onUpdate: (settings: OverlaySettings) => void;
  activePokemon?: Pokemon;
  overlayTargetId?: string;
  readOnly?: boolean;
  compact?: boolean;
}

type ElementKey = "sprite" | "name" | "title" | "counter" | "canvas";


const DEFAULT_TEXT_STYLE: TextStyle = {
  font_family: "sans",
  font_size: 16,
  font_weight: 400,
  text_align: "left",
  color_type: "solid",
  color: "#ffffff",
  gradient_stops: [
    { color: "#ffffff", position: 0 },
    { color: "#aaaaaa", position: 100 },
  ],
  gradient_angle: 180,
  outline_type: "none",
  outline_width: 2,
  outline_color: "#000000",
  outline_gradient_stops: [
    { color: "#ffffff", position: 0 },
    { color: "#000000", position: 100 },
  ],
  outline_gradient_angle: 180,
  text_shadow: false,
  text_shadow_color: "#000000",
  text_shadow_color_type: "solid",
  text_shadow_gradient_stops: [
    { color: "#ffffff", position: 0 },
    { color: "#000000", position: 100 },
  ],
  text_shadow_gradient_angle: 180,
  text_shadow_blur: 4,
  text_shadow_x: 1,
  text_shadow_y: 1,
};

const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = {
  canvas_width: 800,
  canvas_height: 200,
  hidden: false,
  background_color: "#000000",
  background_opacity: 0.6,
  background_animation: "none",
  blur: 8,
  show_border: true,
  border_color: "rgba(255,255,255,0.1)",
  border_width: 2,
  border_radius: 40,
  sprite: {
    visible: true,
    x: 10,
    y: 10,
    width: 180,
    height: 180,
    z_index: 1,
    show_glow: true,
    glow_color: "#ffffff",
    glow_opacity: 0.2,
    glow_blur: 20,
    idle_animation: "float",
    trigger_enter: "pop",
    trigger_exit: "none",
    trigger_decrement: "none",
  },
  name: {
    visible: true,
    x: 200,
    y: 20,
    width: 300,
    height: 40,
    z_index: 2,
    style: {
      ...DEFAULT_TEXT_STYLE,
      font_family: "pokemon",
      font_size: 28,
      font_weight: 700,
      color: "#ffffff",
      outline_type: "solid",
      outline_width: 4,
      outline_color: "#000000",
    },
    idle_animation: "none",
    trigger_enter: "fade-in",
    trigger_decrement: "none",
  },
  title: {
    visible: false,
    x: 200,
    y: 60,
    width: 300,
    height: 30,
    z_index: 4,
    style: {
      ...DEFAULT_TEXT_STYLE,
      font_family: "pokemon",
      font_size: 20,
      font_weight: 700,
      color: "#ffffff",
      outline_type: "solid",
      outline_width: 3,
      outline_color: "#000000",
    },
    idle_animation: "none",
    trigger_enter: "fade-in",
    trigger_decrement: "none",
  },
  counter: {
    visible: true,
    x: 200,
    y: 80,
    width: 300,
    height: 100,
    z_index: 3,
    style: {
      ...DEFAULT_TEXT_STYLE,
      font_family: "pokemon",
      font_size: 80,
      font_weight: 700,
      color: "#ffffff",
      outline_type: "solid",
      outline_width: 6,
      outline_color: "#000000",
    },
    show_label: false,
    label_text: "Begegnungen",
    label_style: {
      ...DEFAULT_TEXT_STYLE,
      font_family: "sans",
      font_size: 14,
      font_weight: 400,
      color: "#94a3b8",
    },
    idle_animation: "none",
    trigger_enter: "pop",
    trigger_decrement: "none",
  },
};

export function OBSSourceHint({ pokemonId }: Readonly<{ pokemonId?: string }>) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const baseUrl = apiUrl("") || globalThis.location.origin;
  const pokemonUrl = pokemonId ? `${baseUrl}/overlay/${pokemonId}` : null;

  const copy = (url: string) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div>
      <div className="flex items-center gap-1 text-xs 2xl:text-sm text-text-muted mb-1.5">
        <Monitor className="w-3 h-3 2xl:w-4 2xl:h-4" />
        OBS Browser Source:
      </div>
      {pokemonUrl ? (
        <>
          <div className="bg-bg-primary rounded px-2 py-1.5 2xl:px-2.5 2xl:py-2 mb-1.5">
            <code className="text-[10px] 2xl:text-xs text-accent-blue break-all">
              {pokemonUrl}
            </code>
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => copy(pokemonUrl)}
              className="flex items-center gap-1 px-2 py-1 2xl:px-2.5 2xl:py-1.5 rounded text-[10px] 2xl:text-xs bg-bg-primary hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
            >
              <Copy className="w-3 h-3 2xl:w-3.5 2xl:h-3.5" />
              {copied ? t("overlay.copied") : t("overlay.copy")}
            </button>
            <a
              href={pokemonUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-2 py-1 2xl:px-2.5 2xl:py-1.5 rounded text-[10px] 2xl:text-xs bg-bg-primary hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
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

export function OverlayEditor({ settings, onUpdate, activePokemon, overlayTargetId, readOnly, compact }: Readonly<Props>) {
  const { t } = useI18n();
  const ELEMENT_LABELS: Record<ElementKey, string> = {
    sprite: "Sprite",
    name: "Name",
    title: t("overlay.elementTitle"),
    counter: t("overlay.elementCounter"),
    canvas: "Canvas",
  };
  const [localSettings, setLocalSettings] = useState<OverlaySettings>(settings);
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

  // Canvas background for testing (transparent = checkered, white, black)
  const [canvasBg, setCanvasBg] = useState<"transparent" | "white" | "black">("transparent");

  // Floating canvas settings panel
  const [propertiesPanelOpen, setPropertiesPanelOpen] = useState(false);
  const { position: panelPosition, handleMouseDown: handlePanelDragStart } = useDraggableWindow({
    storageKey: "encounty_properties_panel_pos",
    defaultPosition: { x: window.innerWidth - 320, y: 80 },
  });

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

  const testIncrement = () => {
    setFakeCount(currentCount + 1);
    fireTest("counter");
    fireTest("sprite");
    fireTest("name");
    fireTest("title");
  };
  const testDecrement = () => {
    if (currentCount > 0) {
      setFakeCount(currentCount - 1);
      fireTest("counter", true);
      fireTest("sprite", true);
      fireTest("name", true);
      fireTest("title", true);
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
  const [shadowEditorTarget, setShadowEditorTarget] = useState<{
    enabled: boolean; color: string; colorType: "solid" | "gradient";
    gradientStops: GradientStop[]; gradientAngle: number;
    blur: number; x: number; y: number;
    onConfirm: (params: ShadowConfirmParams) => void;
  } | null>(null);
  const [outlineEditorTarget, setOutlineEditorTarget] = useState<{
    type: "none" | "solid"; color: string; width: number;
    onConfirm: (type: "none" | "solid", color: string, width: number) => void;
  } | null>(null);
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

  /** Open the shared GradientEditorModal. */
  /** Open the shared OutlineEditorModal. */
  const openOutlineEditor = useCallback(
    (
      type: "none" | "solid", color: string, width: number,
      onConfirm: (t: "none" | "solid", c: string, w: number) => void,
    ) => {
      setOutlineEditorTarget({ type, color, width, onConfirm });
    },
    [],
  );

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
    // Migrate: fill in default title element for settings saved before it existed
    const migrated = (!settings.title || (settings.title.width === 0 && settings.title.height === 0))
      ? { ...settings, title: DEFAULT_OVERLAY_SETTINGS.title }
      : settings;
    setLocalSettings(migrated);
  }, [settings]);

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
    if (hasInitialCentered.current) {
      updateScale();
    } else {
      hasInitialCentered.current = true;
      requestAnimationFrame(updateScale);
    }
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

  const updateField = <K extends keyof OverlaySettings>(
    field: K,
    value: OverlaySettings[K],
  ) => {
    update({ ...localSettings, [field]: value });
  };

  const updateSelectedEl = useCallback(
    (patch: Partial<OverlayElementBase>) => {
      if (selectedEl === "canvas") return;
      const el = localSettings[selectedEl] as OverlayElementBase;
      update({ ...localSettings, [selectedEl]: { ...el, ...patch } });
    },
    [localSettings, selectedEl, update],
  );

  const effectiveScale = canvasScale * zoom;

  const LAYERS: ElementKey[] = ["sprite", "name", "title", "counter", "canvas"];

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
      const idx = LAYERS.indexOf(selectedEl);
      setSelectedEl(LAYERS[(idx + 1) % LAYERS.length]);
      return true;
    }
    return false;
  }, [selectedEl, localSettings, updateSelectedEl, LAYERS]);

  // Keyboard navigation + spacebar for hand tool
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
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
        if (e.key === "Enter") { setPropertiesPanelOpen(true); return; }
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

  /** Opens the floating properties panel for a specific element. */
  const openPropertiesForElement = useCallback((key: ElementKey) => {
    setSelectedEl(key);
    setPropertiesPanelOpen(true);
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
      if (res.ok) {
        const data = await res.json();
        update({ ...localSettings, background_image: data.filename, background_image_fit: localSettings.background_image_fit || "cover" });
      }
    } catch (err) {
      console.error("Background upload failed:", err);
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
      await fetch(apiUrl(`/api/backgrounds/${localSettings.background_image}`), { method: "DELETE" }).catch(() => {});
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
      const newH = Math.max(100, Math.min(dividerDragRef.current.startHeight + dy, window.innerHeight - 200));
      setPropertiesHeight(newH);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setPropertiesHeight(h => { try { localStorage.setItem("encounty_editor_split", String(h)); } catch {} return h; });
      dividerDragRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [propertiesHeight]);

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
        <div
          onMouseDown={startDividerDrag}
          className="h-1.5 shrink-0 cursor-row-resize bg-border-subtle hover:bg-accent-blue/40 active:bg-accent-blue/60 transition-colors relative group"
          role="separator"
          aria-label={t("overlay.resizeDivider")}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              setPropertiesHeight(500);
              try { localStorage.removeItem("encounty_editor_split"); } catch {}
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 bg-bg-secondary border border-border-subtle rounded px-1 py-0 text-[9px] text-text-muted hover:text-text-primary transition-opacity z-10"
            title={t("tooltip.editor.resetLayout")}
            aria-label={t("tooltip.editor.resetLayout")}
          >
            <RotateCcw className="w-2.5 h-2.5" />
          </button>
        </div>

        {/* Layers section (bottom, fills remaining space) */}
        <div data-tutorial="layers" className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-1">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider">
              {t("overlay.layers")}
            </h3>
            <button
              onClick={() => update(DEFAULT_OVERLAY_SETTINGS)}
              title={t("tooltip.editor.resetLayout")}
              className="flex items-center gap-1 px-1 py-0.5 rounded text-[10px] text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          </div>
          {LAYERS
            .filter(key => key !== "canvas")
            .map((key) => {
              const el = localSettings[key] as OverlayElementBase;
              return (
                <div
                  key={key}
                  onClick={() => setSelectedEl(key)}
                  className={`flex items-center justify-between px-2 py-1.5 rounded transition-colors w-full cursor-pointer ${
                    selectedEl === key
                      ? "bg-accent-blue/20 border border-accent-blue/40"
                      : "hover:bg-bg-hover border border-transparent"
                  }`}
                >
                  <span className="text-xs text-text-primary">
                    {ELEMENT_LABELS[key]}
                  </span>
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      title={t("tooltip.editor.moveUp")}
                      aria-label={t("tooltip.editor.moveUp")}
                      onClick={(e) => {
                        e.stopPropagation();
                        moveLayer(key, "up");
                      }}
                      className="p-1 text-text-muted hover:text-text-primary transition-colors"
                    >
                      <ChevronUp className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      title={t("tooltip.editor.moveDown")}
                      aria-label={t("tooltip.editor.moveDown")}
                      onClick={(e) => {
                        e.stopPropagation();
                        moveLayer(key, "down");
                      }}
                      className="p-1 text-text-muted hover:text-text-primary transition-colors"
                    >
                      <ChevronDown className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      title={el.visible ? t("tooltip.editor.hide") : t("tooltip.editor.show")}
                      aria-label={el.visible ? t("tooltip.editor.hide") : t("tooltip.editor.show")}
                      onClick={(e) => {
                        e.stopPropagation();
                        update({
                          ...localSettings,
                          [key]: { ...el, visible: !el.visible },
                        });
                      }}
                      className="p-1 text-text-muted hover:text-text-primary transition-colors"
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
            onClick={() => setSelectedEl("canvas")}
            className={`flex items-center justify-between px-2 py-1.5 rounded transition-colors w-full cursor-pointer ${
              selectedEl === "canvas"
                ? "bg-accent-blue/20 border border-accent-blue/40"
                : "hover:bg-bg-hover border border-transparent"
            }`}
          >
            <span className="text-xs text-text-primary">Canvas</span>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                disabled
                className="p-1 text-text-faint cursor-not-allowed"
              >
                <ChevronUp className="w-3 h-3" />
              </button>
              <button
                type="button"
                disabled
                className="p-1 text-text-faint cursor-not-allowed"
              >
                <ChevronDown className="w-3 h-3" />
              </button>
              <button
                type="button"
                title={!localSettings.hidden ? t("tooltip.editor.hide") : t("tooltip.editor.show")}
                aria-label={!localSettings.hidden ? t("tooltip.editor.hide") : t("tooltip.editor.show")}
                onClick={(e) => {
                  e.stopPropagation();
                  update({ ...localSettings, hidden: !localSettings.hidden });
                }}
                className="p-1 text-text-muted hover:text-text-primary transition-colors"
              >
                {!localSettings.hidden ? (
                  <Eye className="w-3 h-3" />
                ) : (
                  <EyeOff className="w-3 h-3" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Floating properties panel */}
      {propertiesPanelOpen && (
        <FloatingPropertiesPanel
          onClose={() => setPropertiesPanelOpen(false)}
          position={panelPosition}
          onDragStart={handlePanelDragStart}
          localSettings={localSettings}
          selectedEl={selectedEl}
          updateSelectedEl={updateSelectedEl}
          readOnly={readOnly}
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
      )}

      {/* Tutorial overlay */}
      {showTutorial && (
        <EditorTutorial
          onComplete={() => {
            setShowTutorial(false);
            localStorage.setItem("encounty_editor_tutorial_seen", "true");
          }}
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
          colorType={shadowEditorTarget.colorType}
          gradientStops={shadowEditorTarget.gradientStops}
          gradientAngle={shadowEditorTarget.gradientAngle}
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
          onOpenGradientEditor={(stops, angle, onConfirm) =>
            setGradientEditorTarget({ stops, angle, onConfirm })
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
          onConfirm={(type, color, width) => {
            outlineEditorTarget.onConfirm(type, color, width);
            setOutlineEditorTarget(null);
          }}
          onClose={() => setOutlineEditorTarget(null)}
          onOpenColorPicker={(color, onPick) =>
            openColorPicker(color, onPick)
          }
        />
      )}
    </div>
  );
}
