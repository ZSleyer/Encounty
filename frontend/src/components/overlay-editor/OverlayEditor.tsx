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
  Plus,
  Minus,
  RefreshCw,
  Grid3X3,
  Magnet,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  MousePointer2,
  Hand,
  Maximize,
  Upload,
  Trash2,
  HelpCircle,
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
import { NumSlider } from "./controls/NumSlider";
import { ColorSwatch } from "./controls/ColorSwatch";
import { ColorPickerModal } from "./controls/ColorPickerModal";
import { GradientEditorModal } from "./controls/GradientEditorModal";
import { ShadowEditorModal, type ShadowConfirmParams } from "./controls/ShadowEditorModal";
import { OutlineEditorModal } from "./controls/OutlineEditorModal";
import { TextColorEditorModal } from "./controls/TextColorEditorModal";
import { OverlayCanvas } from "./OverlayCanvas";
import { OverlayPropertyPanel } from "./OverlayPropertyPanel";
import { apiUrl } from "../../utils/api";

interface Props {
  settings: OverlaySettings;
  onUpdate: (settings: OverlaySettings) => void;
  activePokemon?: Pokemon;
  overlayTargetId?: string;
  readOnly?: boolean;
  compact?: boolean;
}

type ElementKey = "sprite" | "name" | "title" | "counter";

const ELEMENT_LABELS: Record<ElementKey, string> = {
  sprite: "Sprite",
  name: "Name",
  title: "Titel",
  counter: "Zähler",
};

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
  },
  title: {
    visible: true,
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
  },
};

function OBSSourceHint({ pokemonId }: Readonly<{ pokemonId?: string }>) {
  const [copied, setCopied] = useState(false);
  const baseUrl = globalThis.location.origin;
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
              {copied ? "Kopiert!" : "Kopieren"}
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
        <p className="text-[10px] 2xl:text-xs text-text-faint">Wähle ein Pokémon als Ziel, um dessen Overlay-URL zu sehen.</p>
      )}
    </div>
  );
}

export function OverlayEditor({ settings, onUpdate, activePokemon, overlayTargetId, readOnly, compact }: Readonly<Props>) {
  const { t } = useI18n();
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
  const [activeTool, setActiveTool] = useState<"pointer" | "hand">("pointer");
  const [spaceHeld, setSpaceHeld] = useState(false);
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);
  const zoomRef = useRef(1);
  const panDragStart = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const [isPanDragging, setIsPanDragging] = useState(false);

  // Tutorial
  const [showTutorial, setShowTutorial] = useState(false);

  // Canvas background for testing (transparent = checkered, white, black)
  const [canvasBg, setCanvasBg] = useState<"transparent" | "white" | "black">("transparent");

  const bgPreviewUrl = localSettings.background_image
    ? apiUrl(`/api/backgrounds/${localSettings.background_image}`)
    : "";

  const effectiveTool = (activeTool === "hand" || spaceHeld) ? "hand" : "pointer";

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
      const el = localSettings[selectedEl] as OverlayElementBase;
      update({ ...localSettings, [selectedEl]: { ...el, ...patch } });
    },
    [localSettings, selectedEl, update],
  );

  const effectiveScale = canvasScale * zoom;

  const LAYERS: ElementKey[] = ["sprite", "name", "title", "counter"];

  const moveLayer = (key: ElementKey, dir: "up" | "down") => {
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
    if (!selectedEl) return false;
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
      // Space for hand tool (not in input/select/textarea)
      if (e.code === "Space" && !["INPUT", "SELECT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)) {
        e.preventDefault();
        setSpaceHeld(true);
        return;
      }
      if (handleUndoRedo(e)) return;
      handleElementKeys(e);
    };
    const upHandler = (e: KeyboardEvent) => {
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
    // Pan dragging via scroll
    if (isPanDragging && panDragStart.current) {
      container.scrollLeft = panDragStart.current.sl - (e.clientX - panDragStart.current.x);
      container.scrollTop = panDragStart.current.st - (e.clientY - panDragStart.current.y);
    }
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (effectiveTool === "hand") {
      e.preventDefault();
      const container = canvasContainerRef.current;
      if (!container) return;
      setIsPanDragging(true);
      panDragStart.current = { x: e.clientX, y: e.clientY, sl: container.scrollLeft, st: container.scrollTop };
    }
  };

  const handleCanvasMouseUp = () => {
    if (isPanDragging) {
      setIsPanDragging(false);
      panDragStart.current = null;
    }
  };

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

  return (
    <div className={`flex gap-3 pt-4 px-4 min-h-0 h-full ${compact ? "pb-2" : "pb-8"}`}>
      {/* LEFT SIDEBAR: Layers & Canvas */}
      <div className={`w-56 2xl:w-64 shrink-0 flex flex-col gap-3 min-h-0 ${readOnly ? "pointer-events-none opacity-60" : ""}`}>
        {/* Layers Panel */}
        <div data-tutorial="layers" className="bg-bg-secondary rounded-xl border border-border-subtle p-3 space-y-2 flex-1 min-h-0 overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs 2xl:text-sm font-semibold text-text-secondary uppercase tracking-wider">
              Ebenen
            </p>
            <button
              onClick={() => update(DEFAULT_OVERLAY_SETTINGS)}
              title={t("tooltip.editor.resetLayout")}
              className="flex items-center gap-1 px-1.5 py-1 2xl:px-2 2xl:py-1.5 rounded text-[10px] 2xl:text-xs text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <RotateCcw className="w-3 h-3 2xl:w-3.5 2xl:h-3.5" />
              Reset
            </button>
          </div>
          {LAYERS.filter(key => key !== "title" || activePokemon?.title).map((key) => {
            const el = localSettings[key] as OverlayElementBase;
            return (
              <button
                type="button"
                key={key}
                onClick={() => setSelectedEl(key)}
                className={`flex items-center justify-between px-2 py-1.5 rounded cursor-pointer transition-colors w-full text-left ${
                  selectedEl === key
                    ? "bg-accent-blue/20 border border-accent-blue/40"
                    : "hover:bg-bg-hover border border-transparent"
                }`}
                style={{ background: "none" }}
              >
                <span className="text-xs 2xl:text-sm text-text-primary">
                  {ELEMENT_LABELS[key]}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    title={t("tooltip.editor.moveUp")}
                    onClick={(e) => {
                      e.stopPropagation();
                      moveLayer(key, "up");
                    }}
                    className="text-text-muted hover:text-text-primary transition-colors"
                  >
                    <ChevronUp className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    title={t("tooltip.editor.moveDown")}
                    onClick={(e) => {
                      e.stopPropagation();
                      moveLayer(key, "down");
                    }}
                    className="text-text-muted hover:text-text-primary transition-colors"
                  >
                    <ChevronDown className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    title={el.visible ? t("tooltip.editor.hide") : t("tooltip.editor.show")}
                    onClick={(e) => {
                      e.stopPropagation();
                      update({
                        ...localSettings,
                        [key]: { ...el, visible: !el.visible },
                      });
                    }}
                    className="text-text-muted hover:text-text-primary transition-colors"
                  >
                    {el.visible ? (
                      <Eye className="w-3 h-3" />
                    ) : (
                      <EyeOff className="w-3 h-3" />
                    )}
                  </button>
                </div>
              </button>
            );
          })}
        </div>

        {/* Canvas Settings Panel */}
        <div className="bg-bg-secondary rounded-xl border border-border-subtle p-3 space-y-2 shrink-0">
          <p className="text-[10px] 2xl:text-xs text-text-muted font-semibold uppercase tracking-wider mb-2">
            Canvas
          </p>

          {/* Size */}
          <NumSlider
            label="Breite"
            value={localSettings.canvas_width}
            min={100}
            max={1920}
            step={10}
            onChange={(v) => updateField("canvas_width", v)}
          />
          <NumSlider
            label="Höhe"
            value={localSettings.canvas_height}
            min={50}
            max={1080}
            step={10}
            onChange={(v) => updateField("canvas_height", v)}
          />

          {/* Hintergrund Animation */}
          <label className="block">
            <span className="text-[10px] 2xl:text-xs text-text-muted">
              Hintergrund-Animation
            </span>
            <select
              value={localSettings.background_animation ?? "none"}
              onChange={(e) => updateField("background_animation", e.target.value)}
              className="w-full bg-bg-secondary border border-border-subtle rounded px-2 py-1 2xl:px-2.5 2xl:py-1.5 text-xs 2xl:text-sm text-text-primary outline-none mt-1"
            >
              <option value="none">Keine</option>
              <option value="waves">Wellen (Homebrew)</option>
              <option value="gradient-shift">Farbverlauf</option>
              <option value="pulse-bg">Pulsieren</option>
              <option value="shimmer-bg">Schimmern</option>
              <option value="particles">Partikel</option>
            </select>
          </label>

          {/* Animation speed */}
          {(localSettings.background_animation ?? "none") !== "none" && (
            <NumSlider
              label={`Geschwindigkeit ${(localSettings.background_animation_speed ?? 1).toFixed(1)}×`}
              value={localSettings.background_animation_speed ?? 1}
              min={0.1}
              max={3}
              step={0.1}
              onChange={(v) => updateField("background_animation_speed", v)}
            />
          )}

          {/* Hintergrundbild */}
          <div>
            <span className="text-[10px] 2xl:text-xs text-text-muted">
              Hintergrundbild
            </span>
            <div className="flex items-center gap-1.5 mt-1">
              <button
                title={t("tooltip.editor.uploadBackground")}
                onClick={handleBgUpload}
                disabled={bgUploading}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] 2xl:text-xs bg-bg-primary hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
              >
                <Upload className="w-3 h-3" />
                {bgUploading ? "..." : "Hochladen"}
              </button>
              {localSettings.background_image && (
                <button
                  title={t("tooltip.editor.removeBackground")}
                  onClick={handleBgRemove}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] 2xl:text-xs bg-bg-primary hover:bg-red-500/20 text-text-secondary hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  Entfernen
                </button>
              )}
            </div>
            {localSettings.background_image && (
              <>
                <div
                  className="mt-1.5 w-full h-12 rounded border border-border-subtle bg-bg-primary overflow-hidden"
                  style={{
                    backgroundImage: `url(${bgPreviewUrl})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }}
                />
                <select
                  value={localSettings.background_image_fit ?? "cover"}
                  onChange={(e) => updateField("background_image_fit", e.target.value as "cover" | "contain" | "stretch" | "tile")}
                  className="w-full bg-bg-secondary border border-border-subtle rounded px-2 py-1 2xl:px-2.5 2xl:py-1.5 text-xs 2xl:text-sm text-text-primary outline-none mt-1"
                >
                  <option value="cover">Cover</option>
                  <option value="contain">Contain</option>
                  <option value="stretch">Stretch</option>
                  <option value="tile">Kacheln</option>
                </select>
              </>
            )}
          </div>

          {/* Hintergrund Farbe & Transparenz */}
          <div
            className={
              localSettings.hidden ? "opacity-30 pointer-events-none" : ""
            }
          >
            <div>
              <span className="text-[10px] 2xl:text-xs text-text-muted mb-1 block">Hintergrund</span>
              <ColorSwatch
                color={localSettings.background_color}
                label={localSettings.background_color}
                onClick={() =>
                  openColorPicker(localSettings.background_color, (c) =>
                    updateField("background_color", c),
                  )
                }
              />
            </div>
            <div className="mt-2">
              <label htmlFor="background-opacity" className="text-[10px] 2xl:text-xs text-text-muted">
                Deckkraft {Math.round(localSettings.background_opacity * 100)}%
              </label>
              <input
                id="background-opacity"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={localSettings.background_opacity}
                onChange={(e) =>
                  updateField("background_opacity", Number(e.target.value))
                }
                className="w-full h-1 accent-accent-blue"
              />
            </div>
            <div className="mt-2">
              <label htmlFor="blur" className="text-[10px] 2xl:text-xs text-text-muted">
                Blur {localSettings.blur}px
              </label>
              <input
                id="blur"
                type="range"
                min={0}
                max={30}
                value={localSettings.blur}
                onChange={(e) => updateField("blur", Number(e.target.value))}
                className="w-full h-1 accent-accent-blue"
              />
            </div>
          </div>

          {/* Radius */}
          <div>
            <label htmlFor="border-radius" className="text-[10px] 2xl:text-xs text-text-muted">
              Radius {localSettings.border_radius}px
            </label>
            <input
              id="border-radius"
              type="range"
              min={0}
              max={60}
              value={localSettings.border_radius}
              onChange={(e) =>
                updateField("border_radius", Number(e.target.value))
              }
              className="w-full h-1 accent-accent-blue"
            />
          </div>

          {/* Kontur */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={localSettings.show_border}
              onChange={(e) => updateField("show_border", e.target.checked)}
              className="accent-accent-blue"
            />
            <span className="text-[10px] 2xl:text-xs text-text-secondary">Kontur</span>
          </label>
          {localSettings.show_border && (
            <div
              className={`space-y-2 pl-1 ${localSettings.hidden ? "opacity-30 pointer-events-none" : ""}`}
            >
              <div>
                <span className="text-[10px] 2xl:text-xs text-text-muted mb-1 block">
                  Kontur Farbe
                </span>
                <ColorSwatch
                  color={(() => {
                    const c = localSettings.border_color;
                    if (c?.startsWith("#")) return c;
                    return "#ffffff";
                  })()}
                  label={localSettings.border_color}
                  onClick={() =>
                    openColorPicker(
                      (() => {
                        const c = localSettings.border_color;
                        if (c?.startsWith("#")) return c;
                        return "#ffffff";
                      })(),
                      (c) => updateField("border_color", c),
                    )
                  }
                />
              </div>
              <div>
                <label htmlFor="border-width" className="text-[10px] 2xl:text-xs text-text-muted">
                  Kontur Stärke {localSettings.border_width ?? 2}px
                </label>
                <input
                  id="border-width"
                  type="range"
                  min={1}
                  max={8}
                  step={1}
                  value={localSettings.border_width ?? 2}
                  onChange={(e) =>
                    updateField("border_width", Number(e.target.value))
                  }
                  className="w-full h-1 accent-accent-blue"
                />
              </div>
            </div>
          )}

          {/* Versteckt */}
          <label className="flex items-center gap-2 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={localSettings.hidden ?? false}
              onChange={(e) => updateField("hidden", e.target.checked)}
              className="accent-accent-blue"
            />
            <span className="text-[10px] 2xl:text-xs text-text-secondary">Versteckt</span>
          </label>
        </div>
      </div>

      {/* CENTER: Toolbar + Canvas */}
      <div className="flex-1 flex flex-col gap-2 min-w-0">
        {/* Toolbar */}
        <div data-tutorial="toolbar" className="flex items-center gap-2 px-3 py-2 bg-bg-secondary rounded-xl border border-border-subtle shrink-0">
          {/* Animation test controls */}
          <span className="text-[10px] 2xl:text-xs text-text-muted mr-1">
            Animations-Test:
          </span>
          <button
            onClick={testIncrement}
            disabled={!activePokemon}
            title={t("tooltip.editor.previewIncrement")}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-bg-hover hover:bg-bg-hover/80 text-accent-green hover:text-text-primary text-xs font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Plus className="w-3 h-3" /> 1
          </button>
          <button
            onClick={testDecrement}
            disabled={!activePokemon}
            title={t("tooltip.editor.previewDecrement")}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-bg-hover hover:bg-bg-hover/80 text-accent-yellow hover:text-text-primary text-xs font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Minus className="w-3 h-3" /> 1
          </button>
          <button
            onClick={testReset}
            disabled={!activePokemon}
            title={t("tooltip.editor.previewReset")}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-bg-hover hover:bg-bg-hover/80 text-text-secondary hover:text-text-primary text-xs font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <RefreshCw className="w-3 h-3" /> 0
          </button>

          <div className="w-px h-4 bg-border-subtle mx-1" />

          {/* Grid toggle */}
          <button
            onClick={() => setShowGrid((v) => !v)}
            title={t("tooltip.editor.grid")}
            className={`p-1.5 rounded transition-colors ${showGrid ? "text-accent-blue bg-accent-blue/10" : "text-text-muted hover:text-text-primary hover:bg-bg-hover"}`}
          >
            <Grid3X3 className="w-3.5 h-3.5 2xl:w-4 2xl:h-4" />
          </button>

          {/* Snap toggle */}
          <button
            onClick={() => setSnapEnabled((v) => !v)}
            title={t("tooltip.editor.snap")}
            className={`p-1.5 rounded transition-colors ${snapEnabled ? "text-accent-blue bg-accent-blue/10" : "text-text-muted hover:text-text-primary hover:bg-bg-hover"}`}
          >
            <Magnet className="w-3.5 h-3.5 2xl:w-4 2xl:h-4" />
          </button>

          {/* Grid size */}
          {showGrid && (
            <select
              value={gridSize}
              onChange={(e) => setGridSize(Number(e.target.value))}
              className="text-xs bg-bg-card border border-border-subtle rounded px-1.5 py-0.5 text-text-primary outline-none"
            >
              <option value={8}>8px</option>
              <option value={16}>16px</option>
              <option value={32}>32px</option>
            </select>
          )}

          <div className="w-px h-4 bg-border-subtle mx-1" />

          {/* Undo/Redo */}
          <button
            onClick={() => {
              if (history.canUndo) {
                history.undo();
                setLocalSettings(history.current);
                onUpdate(history.current);
              }
            }}
            disabled={!history.canUndo}
            title={t("tooltip.editor.undo")}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Undo2 className="w-3.5 h-3.5 2xl:w-4 2xl:h-4" />
          </button>
          <button
            onClick={() => {
              if (history.canRedo) {
                history.redo();
                setLocalSettings(history.current);
                onUpdate(history.current);
              }
            }}
            disabled={!history.canRedo}
            title={t("tooltip.editor.redo")}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Redo2 className="w-3.5 h-3.5 2xl:w-4 2xl:h-4" />
          </button>

          <div className="w-px h-4 bg-border-subtle mx-1" />

          {/* Pointer / Hand / Fit tools */}
          <button
            onClick={() => setActiveTool("pointer")}
            title={t("tooltip.editor.pointer")}
            className={`p-1.5 rounded transition-colors ${activeTool === "pointer" ? "text-accent-blue bg-accent-blue/20" : "text-text-muted hover:text-text-primary hover:bg-bg-hover"}`}
          >
            <MousePointer2 className="w-3.5 h-3.5 2xl:w-4 2xl:h-4" />
          </button>
          <button
            onClick={() => setActiveTool("hand")}
            title={t("tooltip.editor.hand")}
            className={`p-1.5 rounded transition-colors ${activeTool === "hand" ? "text-accent-blue bg-accent-blue/20" : "text-text-muted hover:text-text-primary hover:bg-bg-hover"}`}
          >
            <Hand className="w-3.5 h-3.5 2xl:w-4 2xl:h-4" />
          </button>
          <button
            onClick={fitToView}
            title={t("tooltip.editor.fitView")}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            <Maximize className="w-3.5 h-3.5 2xl:w-4 2xl:h-4" />
          </button>

          <div className="w-px h-4 bg-border-subtle mx-1" />

          {/* Zoom */}
          <button
            onClick={() => setZoom((z) => Math.max(0.1, z - 0.1))}
            title={t("tooltip.editor.zoomOut")}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            <ZoomOut className="w-3.5 h-3.5 2xl:w-4 2xl:h-4" />
          </button>
          <span className="text-[10px] 2xl:text-xs text-text-muted w-8 2xl:w-10 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((z) => Math.min(4, z + 0.1))}
            title={t("tooltip.editor.zoomIn")}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            <ZoomIn className="w-3.5 h-3.5 2xl:w-4 2xl:h-4" />
          </button>

          <div className="w-px h-4 bg-border-subtle mx-1" />

          {/* Canvas background toggle */}
          <div className="flex border border-border-subtle rounded overflow-hidden">
            {(["transparent", "white", "black"] as const).map((bg) => {
              const whiteOrBlack = bg === "white" ? t("tooltip.editor.bgWhite") : t("tooltip.editor.bgBlack");
              const bgTitle = bg === "transparent" ? t("tooltip.editor.bgTransparent") : whiteOrBlack;

              return (
              <button
                key={bg}
                onClick={() => setCanvasBg(bg)}
                title={bgTitle}
                className={`px-1.5 py-1 text-[10px] 2xl:text-xs ${canvasBg === bg ? "bg-accent-blue/20 text-accent-blue" : "text-text-muted hover:bg-bg-hover"}`}
              >
                <div
                  className="w-3 h-3 rounded-sm border border-border-subtle"
                  style={{
                    background: bg === "transparent"
                      ? "repeating-conic-gradient(#666 0% 25%, #999 0% 50%) 50% / 6px 6px"
                      : bg,
                  }}
                />
              </button>
              );
            })}
          </div>

          {/* Mouse position — same height as toolbar buttons */}
          <span className="ml-auto flex items-center text-[10px] 2xl:text-xs text-text-faint font-mono leading-none py-1">
            X: {mousePos.x} Y: {mousePos.y}
          </span>
          {activePokemon && (
            <span className="flex items-center text-[10px] 2xl:text-xs text-text-faint leading-none py-1">
              {currentCount} (Vorschau)
            </span>
          )}
          {!activePokemon && (
            <span className="flex items-center text-[10px] 2xl:text-xs text-text-faint leading-none py-1">
              Kein aktives Pokémon
            </span>
          )}
          <button
            onClick={() => setShowTutorial(true)}
            title={t("tooltip.editor.showTutorial")}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            <HelpCircle className="w-3.5 h-3.5 2xl:w-4 2xl:h-4" />
          </button>
        </div>

        {/* Canvas */}
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
          onMouseMove={handleCanvasMouseMove}
          onMouseDown={handleCanvasMouseDown}
          onMouseUp={handleCanvasMouseUp}
          onSelectElement={setSelectedEl}
          onDragStateChange={setIsDragging}
          onGuidesChange={setGuides}
          onUpdate={update}
        />
      </div>

      {/* RIGHT SIDEBAR: Properties & OBS */}
      <div className={`w-72 2xl:w-80 shrink-0 flex flex-col gap-3 min-h-0 ${readOnly ? "pointer-events-none opacity-60" : ""}`}>
        {/* Properties Panel */}
        <OverlayPropertyPanel
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
        />

        {/* OBS Source Panel */}
        <div className="bg-bg-secondary rounded-xl border border-border-subtle p-3 shrink-0">
          <OBSSourceHint pokemonId={activePokemon?.id} />
        </div>
      </div>

      {/* Tutorial overlay */}
      {showTutorial && (
        <EditorTutorial
          onComplete={() => {
            setShowTutorial(false);
            localStorage.setItem("encounty_editor_tutorial_seen", "true");
          }}
        />
      )}

      {/* --- Shared modal instances --- */}
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
