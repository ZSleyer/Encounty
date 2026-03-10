import { useState, useEffect, useRef, useCallback } from "react";
import {
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
  Monitor,
  Copy,
  ExternalLink,
  RotateCcw,
  Play,
  Plus,
  Minus,
  RefreshCw,
  Grid3X3,
  Magnet,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  OverlaySettings,
  OverlayElementBase,
  TextStyle,
  GradientStop,
} from "../types";
import { Overlay } from "../pages/Overlay";
import type { Pokemon } from "../types";
import { useHistory } from "../hooks/useHistory";
import { useSnapping, Guide } from "../hooks/useSnapping";

interface Props {
  settings: OverlaySettings;
  onUpdate: (settings: OverlaySettings) => void;
  activePokemon?: Pokemon;
  overlayTargetId?: string;
}

type ElementKey = "sprite" | "name" | "counter";
type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const ELEMENT_LABELS: Record<ElementKey, string> = {
  sprite: "Sprite",
  name: "Name",
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
  text_shadow: false,
  text_shadow_color: "#000000",
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
      font_family: "sans",
      font_size: 20,
      font_weight: 400,
      color: "#94a3b8",
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

function NumInput({
  value,
  min,
  max,
  step = 1,
  onChange,
  className,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  className?: string;
}) {
  const clamp = (v: number) => {
    let n = v;
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    return n;
  };
  return (
    <div
      className={`flex items-center border border-border-subtle rounded overflow-hidden bg-bg-primary ${className ?? ""}`}
    >
      <button
        type="button"
        onClick={() => onChange(clamp(value - step))}
        className="px-1.5 2xl:px-2 self-stretch flex items-center text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors text-sm 2xl:text-base leading-none shrink-0"
      >
        −
      </button>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 min-w-0 bg-transparent text-[10px] 2xl:text-xs text-text-primary text-center outline-none py-0.5 2xl:py-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        onClick={() => onChange(clamp(value + step))}
        className="px-1.5 2xl:px-2 self-stretch flex items-center text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors text-sm 2xl:text-base leading-none shrink-0"
      >
        +
      </button>
    </div>
  );
}

function NumSlider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <label className="text-[10px] 2xl:text-xs text-text-muted">{label}</label>
        <NumInput
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={onChange}
          className="w-20 2xl:w-24"
        />
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1 accent-accent-blue cursor-pointer"
      />
    </div>
  );
}

function FontPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const POPULAR_FONTS = [
    "sans",
    "serif",
    "monospace",
    "pokemon",
    "Roboto",
    "Open Sans",
    "Lato",
    "Montserrat",
    "Oswald",
    "Raleway",
    "Poppins",
    "Nunito",
    "Ubuntu",
    "Merriweather",
    "Playfair Display",
    "Bebas Neue",
    "Cinzel",
    "Exo 2",
    "Orbitron",
    "Press Start 2P",
  ];
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-bg-secondary border border-border-subtle rounded px-2 py-1 2xl:px-2.5 2xl:py-1.5 text-xs 2xl:text-sm text-text-primary outline-none"
    >
      {POPULAR_FONTS.map((f) => (
        <option key={f} value={f}>
          {f}
        </option>
      ))}
    </select>
  );
}

function GradientEditor({
  stops,
  angle,
  onChange,
  onAngleChange,
}: {
  stops: GradientStop[];
  angle: number;
  onChange: (stops: GradientStop[]) => void;
  onAngleChange: (a: number) => void;
}) {
  return (
    <div className="space-y-2">
      <NumSlider
        label="Winkel (°)"
        value={angle}
        min={0}
        max={360}
        onChange={onAngleChange}
      />
      {stops.map((stop, i) => (
        <div key={i} className="flex gap-2 items-center">
          <input
            type="color"
            value={stop.color}
            onChange={(e) => {
              const newStops = [...stops];
              newStops[i] = { ...stop, color: e.target.value };
              onChange(newStops);
            }}
            className="w-8 h-6 2xl:w-10 2xl:h-7 rounded cursor-pointer border-0"
          />
          <input
            type="range"
            value={stop.position}
            onChange={(e) => {
              const newStops = [...stops];
              newStops[i] = { ...stop, position: Number(e.target.value) };
              onChange(newStops);
            }}
            min={0}
            max={100}
            className="flex-1 h-1 accent-accent-blue"
          />
          <span className="text-xs 2xl:text-sm text-text-muted w-8 2xl:w-10">{stop.position}%</span>
        </div>
      ))}
    </div>
  );
}

function TextStyleEditor({
  style,
  onChange,
  label,
}: {
  style: TextStyle;
  onChange: (s: TextStyle) => void;
  label: string;
}) {
  const u = (field: keyof TextStyle, value: unknown) =>
    onChange({ ...style, [field]: value });
  return (
    <div className="space-y-2 border border-border-subtle/50 rounded p-2">
      <p className="text-xs 2xl:text-sm text-text-secondary font-semibold">{label}</p>

      <div>
        <label className="text-[10px] 2xl:text-xs text-text-muted">Schriftart</label>
        <FontPicker
          value={style.font_family}
          onChange={(v) => u("font_family", v)}
        />
      </div>
      <NumSlider
        label="Größe (px)"
        value={style.font_size}
        min={6}
        max={200}
        onChange={(v) => u("font_size", v)}
      />
      <div>
        <label className="text-[10px] 2xl:text-xs text-text-muted">Gewicht</label>
        <select
          value={style.font_weight}
          onChange={(e) => u("font_weight", Number(e.target.value))}
          className="w-full bg-bg-secondary border border-border-subtle rounded px-2 py-1 2xl:px-2.5 2xl:py-1.5 text-xs 2xl:text-sm text-text-primary outline-none"
        >
          {[100, 300, 400, 500, 700, 900].map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-1">
        <span className="text-[10px] 2xl:text-xs text-text-muted w-14 2xl:w-16">Ausrichtung</span>
        <div className="flex border border-border-subtle rounded overflow-hidden">
          {(["left", "center", "right"] as const).map((align) => (
            <button
              key={align}
              onClick={() => u("text_align", align)}
              className={`px-2 py-1 2xl:px-2.5 2xl:py-1.5 text-[10px] 2xl:text-xs ${
                (style.text_align || "left") === align
                  ? "bg-accent-blue/20 text-accent-blue"
                  : "text-text-muted hover:bg-bg-hover"
              }`}
              title={align === "left" ? "Links" : align === "center" ? "Mitte" : "Rechts"}
            >
              {align === "left" ? "L" : align === "center" ? "C" : "R"}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-[10px] 2xl:text-xs text-text-muted">Farb-Typ</label>
        <select
          value={style.color_type}
          onChange={(e) =>
            u("color_type", e.target.value as "solid" | "gradient")
          }
          className="w-full bg-bg-secondary border border-border-subtle rounded px-2 py-1 2xl:px-2.5 2xl:py-1.5 text-xs 2xl:text-sm text-text-primary outline-none"
        >
          <option value="solid">Einfarbig</option>
          <option value="gradient">Verlauf</option>
        </select>
      </div>
      {style.color_type === "solid" ? (
        <div className="flex gap-2 items-center">
          <label className="text-[10px] 2xl:text-xs text-text-muted">Farbe</label>
          <input
            type="color"
            value={style.color}
            onChange={(e) => u("color", e.target.value)}
            className="w-8 h-6 2xl:w-10 2xl:h-7 rounded cursor-pointer border-0"
          />
          <span className="text-[10px] 2xl:text-xs text-text-secondary">{style.color}</span>
        </div>
      ) : (
        <GradientEditor
          stops={style.gradient_stops || []}
          angle={style.gradient_angle || 180}
          onChange={(s) => u("gradient_stops", s)}
          onAngleChange={(a) => u("gradient_angle", a)}
        />
      )}

      <div className="space-y-1">
        <div className="flex gap-2 items-center">
          <label className="text-[10px] 2xl:text-xs text-text-muted w-14 2xl:w-16 shrink-0">
            Umriss
          </label>
          <select
            value={style.outline_type}
            onChange={(e) =>
              u("outline_type", e.target.value as "none" | "solid")
            }
            className="flex-1 bg-bg-secondary border border-border-subtle rounded px-2 py-1 2xl:px-2.5 2xl:py-1.5 text-xs 2xl:text-sm text-text-primary outline-none"
          >
            <option value="none">Kein</option>
            <option value="solid">Einfarbig</option>
          </select>
        </div>
        {style.outline_type === "solid" && (
          <div className="pl-4 space-y-1">
            <div className="flex gap-2 items-center">
              <label className="text-[10px] 2xl:text-xs text-text-muted w-10 2xl:w-12 shrink-0">
                Farbe
              </label>
              <input
                type="color"
                value={style.outline_color}
                onChange={(e) => u("outline_color", e.target.value)}
                className="w-8 h-6 2xl:w-10 2xl:h-7 rounded cursor-pointer border-0"
              />
            </div>
            <NumSlider
              label="Breite (px)"
              value={style.outline_width}
              min={1}
              max={20}
              onChange={(v) => u("outline_width", v)}
            />
          </div>
        )}
      </div>

      <div className="space-y-1">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={style.text_shadow}
            onChange={(e) => u("text_shadow", e.target.checked)}
            className="accent-accent-blue"
          />
          <span className="text-[10px] 2xl:text-xs text-text-secondary">Schatten</span>
        </label>
        {style.text_shadow && (
          <div className="pl-4 space-y-1">
            <div className="flex gap-2 items-center">
              <label className="text-[10px] 2xl:text-xs text-text-muted w-10 2xl:w-12 shrink-0">
                Farbe
              </label>
              <input
                type="color"
                value={style.text_shadow_color}
                onChange={(e) => u("text_shadow_color", e.target.value)}
                className="w-8 h-6 2xl:w-10 2xl:h-7 rounded cursor-pointer border-0"
              />
            </div>
            <NumSlider
              label="Blur (px)"
              value={style.text_shadow_blur}
              min={0}
              max={40}
              onChange={(v) => u("text_shadow_blur", v)}
            />
            <NumSlider
              label="X (px)"
              value={style.text_shadow_x}
              min={-30}
              max={30}
              onChange={(v) => u("text_shadow_x", v)}
            />
            <NumSlider
              label="Y (px)"
              value={style.text_shadow_y}
              min={-30}
              max={30}
              onChange={(v) => u("text_shadow_y", v)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function useElementDrag(
  elementKey: ElementKey,
  settings: OverlaySettings,
  onUpdate: (s: OverlaySettings) => void,
  canvasScale: number,
  onDragStateChange?: (dragging: boolean) => void,
  onGuidesChange?: (guides: Guide[]) => void,
  snapEnabled?: boolean,
  gridSize?: number,
) {
  const dragging = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const resizing = useRef<{
    dir: ResizeDir;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
  } | null>(null);

  const snapping = useSnapping(settings, snapEnabled ?? false, gridSize ?? 8);

  const getEl = useCallback(
    () => settings[elementKey] as OverlayElementBase,
    [settings, elementKey],
  );
  const setEl = useCallback(
    (patch: Partial<OverlayElementBase>) => {
      onUpdate({
        ...settings,
        [elementKey]: { ...settings[elementKey], ...patch },
      });
    },
    [settings, elementKey, onUpdate],
  );

  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const el = getEl();
      dragging.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: el.x,
        origY: el.y,
      };
      onDragStateChange?.(true);

      const onMove = (me: MouseEvent) => {
        if (!dragging.current) return;
        const dx = (me.clientX - dragging.current.startX) / canvasScale;
        const dy = (me.clientY - dragging.current.startY) / canvasScale;
        const rawX = Math.round(dragging.current.origX + dx);
        const rawY = Math.round(dragging.current.origY + dy);
        const el2 = getEl();
        const snapped = snapping.snap(
          rawX,
          rawY,
          el2.width,
          el2.height,
          me.shiftKey,
        );
        const guides = snapping.getGuides(
          elementKey,
          snapped.x,
          snapped.y,
          el2.width,
          el2.height,
        );
        onGuidesChange?.(guides);
        setEl({ x: snapped.x, y: snapped.y });
      };
      const onUp = () => {
        dragging.current = null;
        onDragStateChange?.(false);
        onGuidesChange?.([]);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [
      getEl,
      setEl,
      canvasScale,
      snapping,
      elementKey,
      onDragStateChange,
      onGuidesChange,
    ],
  );

  const onResizeStart = useCallback(
    (dir: ResizeDir) => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const el = getEl();
      resizing.current = {
        dir,
        startX: e.clientX,
        startY: e.clientY,
        origX: el.x,
        origY: el.y,
        origW: el.width,
        origH: el.height,
      };
      onDragStateChange?.(true);

      const onMove = (me: MouseEvent) => {
        if (!resizing.current) return;
        const {
          dir: d,
          startX,
          startY,
          origX,
          origY,
          origW,
          origH,
        } = resizing.current;
        const dx = (me.clientX - startX) / canvasScale;
        const dy = (me.clientY - startY) / canvasScale;
        let x = origX,
          y = origY,
          w = origW,
          h = origH;

        if (d.includes("e")) w = Math.max(20, origW + dx);
        if (d.includes("s")) h = Math.max(20, origH + dy);
        if (d.includes("w")) {
          w = Math.max(20, origW - dx);
          x = origX + origW - w;
        }
        if (d.includes("n")) {
          h = Math.max(20, origH - dy);
          y = origY + origH - h;
        }

        // Aspect-ratio lock with Shift
        if (me.shiftKey && origW > 0 && origH > 0) {
          const aspect = origW / origH;
          if (d.includes("e") || d.includes("w")) {
            h = w / aspect;
          } else {
            w = h * aspect;
          }
        }

        setEl({
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(w),
          height: Math.round(h),
        });
      };
      const onUp = () => {
        resizing.current = null;
        onDragStateChange?.(false);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [getEl, setEl, canvasScale, onDragStateChange],
  );

  return { onDragStart, onResizeStart };
}

function ResizeHandle({
  dir,
  onResizeStart,
}: {
  dir: ResizeDir;
  onResizeStart: (dir: ResizeDir) => (e: React.MouseEvent) => void;
}) {
  const posStyles: Record<ResizeDir, React.CSSProperties> = {
    n: {
      top: -4,
      left: "50%",
      transform: "translateX(-50%)",
      cursor: "n-resize",
    },
    s: {
      bottom: -4,
      left: "50%",
      transform: "translateX(-50%)",
      cursor: "s-resize",
    },
    e: {
      right: -4,
      top: "50%",
      transform: "translateY(-50%)",
      cursor: "e-resize",
    },
    w: {
      left: -4,
      top: "50%",
      transform: "translateY(-50%)",
      cursor: "w-resize",
    },
    ne: { top: -4, right: -4, cursor: "ne-resize" },
    nw: { top: -4, left: -4, cursor: "nw-resize" },
    se: { bottom: -4, right: -4, cursor: "se-resize" },
    sw: { bottom: -4, left: -4, cursor: "sw-resize" },
  };
  return (
    <div
      onMouseDown={onResizeStart(dir)}
      style={{
        position: "absolute",
        width: 8,
        height: 8,
        background: "#3b82f6",
        border: "1px solid white",
        borderRadius: 2,
        zIndex: 100,
        ...posStyles[dir],
      }}
    />
  );
}

function OBSSourceHint({ pokemonId }: { pokemonId?: string }) {
  const [copied, setCopied] = useState(false);
  const baseUrl = window.location.origin;
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

export function OverlayEditor({ settings, onUpdate, activePokemon, overlayTargetId }: Props) {
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
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const fireTest = (element: ElementKey, reverse = false) =>
    setTestTrigger({ element, n: Date.now(), reverse });

  // Local fake counter — isolated from live OBS overlay
  const [fakeCount, setFakeCount] = useState<number | null>(null);
  useEffect(() => {
    setFakeCount(null);
  }, [activePokemon?.id]);
  const currentCount =
    fakeCount !== null ? fakeCount : (activePokemon?.encounters ?? 0);

  const testIncrement = () => {
    setFakeCount(currentCount + 1);
    fireTest("counter");
    fireTest("sprite");
    fireTest("name");
  };
  const testDecrement = () => {
    if (currentCount > 0) {
      setFakeCount(currentCount - 1);
      fireTest("counter", true);
      fireTest("sprite", true);
      fireTest("name", true);
    }
  };
  const testReset = () => {
    setFakeCount(0);
    fireTest("counter");
  };

  // History for undo/redo
  const history = useHistory<OverlaySettings>(settings, 400);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  // Compute scale to fit canvas in the preview area
  useEffect(() => {
    const updateScale = () => {
      if (!canvasContainerRef.current) return;
      const { clientWidth, clientHeight } = canvasContainerRef.current;
      const scaleX = clientWidth / localSettings.canvas_width;
      const scaleY = clientHeight / localSettings.canvas_height;
      setCanvasScale(Math.min(scaleX, scaleY, 1));
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, [localSettings.canvas_width, localSettings.canvas_height]);

  // Ctrl+Scroll to zoom
  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((z) => Math.min(2, Math.max(0.25, z - e.deltaY * 0.001)));
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, []);

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

  const spriteHandlers = useElementDrag(
    "sprite",
    localSettings,
    update,
    canvasScale,
    setIsDragging,
    setGuides,
    snapEnabled,
    gridSize,
  );
  const nameHandlers = useElementDrag(
    "name",
    localSettings,
    update,
    canvasScale,
    setIsDragging,
    setGuides,
    snapEnabled,
    gridSize,
  );
  const counterHandlers = useElementDrag(
    "counter",
    localSettings,
    update,
    canvasScale,
    setIsDragging,
    setGuides,
    snapEnabled,
    gridSize,
  );

  const handlers: Record<ElementKey, ReturnType<typeof useElementDrag>> = {
    sprite: spriteHandlers,
    name: nameHandlers,
    counter: counterHandlers,
  };

  const LAYERS: ElementKey[] = ["sprite", "name", "counter"];

  const moveLayer = (key: ElementKey, dir: "up" | "down") => {
    const el = localSettings[key] as OverlayElementBase;
    const delta = dir === "up" ? 1 : -1;
    update({
      ...localSettings,
      [key]: { ...el, z_index: Math.max(0, el.z_index + delta) },
    });
  };

  const fakePreviewPokemon: Pokemon | undefined = activePokemon
    ? { ...activePokemon, encounters: currentCount }
    : undefined;

  const effectiveScale = canvasScale * zoom;

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Undo/Redo
      if (e.ctrlKey && e.key === "z") {
        e.preventDefault();
        if (history.canUndo) {
          history.undo();
          const prev = history.current;
          setLocalSettings(prev);
          onUpdate(prev);
        }
        return;
      }
      if (e.ctrlKey && e.key === "y") {
        e.preventDefault();
        if (history.canRedo) {
          history.redo();
          const next = history.current;
          setLocalSettings(next);
          onUpdate(next);
        }
        return;
      }

      if (!selectedEl) return;
      const el = localSettings[selectedEl] as OverlayElementBase;
      const step = e.shiftKey ? 10 : 1;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        updateSelectedEl({ x: el.x - step });
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        updateSelectedEl({ x: el.x + step });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        updateSelectedEl({ y: el.y - step });
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        updateSelectedEl({ y: el.y + step });
      } else if (e.key === "Escape") {
        setSelectedEl("sprite");
      } else if (e.key === "Tab") {
        e.preventDefault();
        const idx = LAYERS.indexOf(selectedEl);
        setSelectedEl(LAYERS[(idx + 1) % LAYERS.length]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedEl, localSettings, history, updateSelectedEl, onUpdate, LAYERS]);

  // Track mouse position over canvas
  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) / effectiveScale);
    const y = Math.round((e.clientY - rect.top) / effectiveScale);
    setMousePos({ x, y });
    if (isDragging) {
      setTooltipPos({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    }
  };

  return (
    <div className="flex gap-3 h-full pt-4 pb-8 px-4 min-h-0">
      {/* LEFT SIDEBAR: Layers & Canvas */}
      <div className="w-56 2xl:w-64 shrink-0 flex flex-col gap-3 min-h-0">
        {/* Layers Panel */}
        <div className="bg-bg-secondary rounded-xl border border-border-subtle p-3 space-y-2 flex-1 min-h-0 overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs 2xl:text-sm font-semibold text-text-secondary uppercase tracking-wider">
              Ebenen
            </p>
            <button
              onClick={() => update(DEFAULT_OVERLAY_SETTINGS)}
              title="Layout zurücksetzen"
              className="flex items-center gap-1 px-1.5 py-1 2xl:px-2 2xl:py-1.5 rounded text-[10px] 2xl:text-xs text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <RotateCcw className="w-3 h-3 2xl:w-3.5 2xl:h-3.5" />
              Reset
            </button>
          </div>
          {LAYERS.map((key) => {
            const el = localSettings[key] as OverlayElementBase;
            return (
              <div
                key={key}
                onClick={() => setSelectedEl(key)}
                className={`flex items-center justify-between px-2 py-1.5 rounded cursor-pointer transition-colors ${
                  selectedEl === key
                    ? "bg-accent-blue/20 border border-accent-blue/40"
                    : "hover:bg-bg-hover border border-transparent"
                }`}
              >
                <span className="text-xs 2xl:text-sm text-text-primary">
                  {ELEMENT_LABELS[key]}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      moveLayer(key, "up");
                    }}
                    className="text-text-muted hover:text-text-primary transition-colors"
                  >
                    <ChevronUp className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      moveLayer(key, "down");
                    }}
                    className="text-text-muted hover:text-text-primary transition-colors"
                  >
                    <ChevronDown className="w-3 h-3" />
                  </button>
                  <button
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
              </div>
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
          <div>
            <label className="text-[10px] 2xl:text-xs text-text-muted">
              Hintergrund-Animation
            </label>
            <select
              value={localSettings.background_animation ?? "none"}
              onChange={(e) => updateField("background_animation", e.target.value)}
              className="w-full bg-bg-secondary border border-border-subtle rounded px-2 py-1 2xl:px-2.5 2xl:py-1.5 text-xs 2xl:text-sm text-text-primary outline-none mt-1"
            >
              <option value="none">Keine</option>
              <option value="waves">Wellen (Homebrew)</option>
            </select>
          </div>

          {/* Hintergrund Farbe & Transparenz */}
          <div
            className={
              localSettings.hidden ? "opacity-30 pointer-events-none" : ""
            }
          >
            <div>
              <label className="text-[10px] 2xl:text-xs text-text-muted">Hintergrund</label>
              <input
                type="color"
                value={localSettings.background_color}
                onChange={(e) =>
                  updateField("background_color", e.target.value)
                }
                className="w-full h-6 rounded cursor-pointer border-0"
              />
            </div>
            <div className="mt-2">
              <label className="text-[10px] 2xl:text-xs text-text-muted">
                Deckkraft {Math.round(localSettings.background_opacity * 100)}%
              </label>
              <input
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
              <label className="text-[10px] 2xl:text-xs text-text-muted">
                Blur {localSettings.blur}px
              </label>
              <input
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
            <label className="text-[10px] 2xl:text-xs text-text-muted">
              Radius {localSettings.border_radius}px
            </label>
            <input
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
                <label className="text-[10px] 2xl:text-xs text-text-muted">
                  Kontur Farbe
                </label>
                <input
                  type="color"
                  value={(() => {
                    const c = localSettings.border_color;
                    if (c && c.startsWith("#")) return c;
                    return "#ffffff";
                  })()}
                  onChange={(e) => updateField("border_color", e.target.value)}
                  className="w-full h-6 rounded cursor-pointer border-0"
                />
              </div>
              <div>
                <label className="text-[10px] 2xl:text-xs text-text-muted">
                  Kontur Stärke {localSettings.border_width ?? 2}px
                </label>
                <input
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
        <div className="flex items-center gap-2 px-3 py-2 bg-bg-secondary rounded-xl border border-border-subtle shrink-0">
          {/* Animation test controls */}
          <span className="text-[10px] 2xl:text-xs text-text-muted mr-1">
            Animations-Test:
          </span>
          <button
            onClick={testIncrement}
            disabled={!activePokemon}
            title="+1 (nur Vorschau)"
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-bg-hover hover:bg-bg-hover/80 text-accent-green hover:text-text-primary text-xs font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Plus className="w-3 h-3" /> 1
          </button>
          <button
            onClick={testDecrement}
            disabled={!activePokemon}
            title="-1 (nur Vorschau)"
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-bg-hover hover:bg-bg-hover/80 text-accent-yellow hover:text-text-primary text-xs font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Minus className="w-3 h-3" /> 1
          </button>
          <button
            onClick={testReset}
            disabled={!activePokemon}
            title="Reset (nur Vorschau)"
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-bg-hover hover:bg-bg-hover/80 text-text-secondary hover:text-text-primary text-xs font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <RefreshCw className="w-3 h-3" /> 0
          </button>

          <div className="w-px h-4 bg-border-subtle mx-1" />

          {/* Grid toggle */}
          <button
            onClick={() => setShowGrid((v) => !v)}
            title="Grid"
            className={`p-1.5 rounded transition-colors ${showGrid ? "text-accent-blue bg-accent-blue/10" : "text-text-muted hover:text-text-primary hover:bg-bg-hover"}`}
          >
            <Grid3X3 className="w-3.5 h-3.5 2xl:w-4 2xl:h-4" />
          </button>

          {/* Snap toggle */}
          <button
            onClick={() => setSnapEnabled((v) => !v)}
            title="Snap"
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
            title="Rückgängig (Ctrl+Z)"
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
            title="Wiederholen (Ctrl+Y)"
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Redo2 className="w-3.5 h-3.5 2xl:w-4 2xl:h-4" />
          </button>

          <div className="w-px h-4 bg-border-subtle mx-1" />

          {/* Zoom */}
          <button
            onClick={() => setZoom((z) => Math.min(2, z + 0.1))}
            title="Reinzoomen"
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            <ZoomIn className="w-3.5 h-3.5 2xl:w-4 2xl:h-4" />
          </button>
          <span className="text-[10px] 2xl:text-xs text-text-muted w-8 2xl:w-10 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((z) => Math.max(0.25, z - 0.1))}
            title="Rauszoomen"
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            <ZoomOut className="w-3.5 h-3.5 2xl:w-4 2xl:h-4" />
          </button>

          {/* Mouse position */}
          <span className="ml-auto text-[10px] 2xl:text-xs text-text-faint font-mono">
            X: {mousePos.x} Y: {mousePos.y}
          </span>
          {activePokemon && (
            <span className="text-[10px] 2xl:text-xs text-text-faint">
              {currentCount} (Vorschau)
            </span>
          )}
          {!activePokemon && (
            <span className="text-[10px] 2xl:text-xs text-text-faint">
              Kein aktives Pokémon
            </span>
          )}
        </div>

        {/* Canvas */}
        <div
          ref={canvasContainerRef}
          className="flex-1 canvas-checkered rounded-xl border border-border-subtle flex items-center justify-center overflow-hidden min-h-0 relative"
          onMouseMove={handleCanvasMouseMove}
        >
          <div
            style={{
              transform: `scale(${effectiveScale})`,
              transformOrigin: "center center",
              position: "relative",
              width: localSettings.canvas_width,
              height: localSettings.canvas_height,
            }}
          >
            {/* Actual overlay preview */}
            <Overlay
              previewSettings={localSettings}
              previewPokemon={fakePreviewPokemon}
              testTrigger={testTrigger}
            />

            {/* Grid overlay */}
            {showGrid && (
              <svg
                className="absolute inset-0 pointer-events-none"
                style={{
                  width: localSettings.canvas_width,
                  height: localSettings.canvas_height,
                  opacity: 0.15,
                }}
              >
                {Array.from(
                  {
                    length: Math.floor(localSettings.canvas_width / gridSize),
                  },
                  (_, i) => (
                    <line
                      key={`v${i}`}
                      x1={(i + 1) * gridSize}
                      y1={0}
                      x2={(i + 1) * gridSize}
                      y2={localSettings.canvas_height}
                      stroke="#4a9eff"
                      strokeWidth={0.5}
                    />
                  ),
                )}
                {Array.from(
                  {
                    length: Math.floor(localSettings.canvas_height / gridSize),
                  },
                  (_, i) => (
                    <line
                      key={`h${i}`}
                      x1={0}
                      y1={(i + 1) * gridSize}
                      x2={localSettings.canvas_width}
                      y2={(i + 1) * gridSize}
                      stroke="#4a9eff"
                      strokeWidth={0.5}
                    />
                  ),
                )}
              </svg>
            )}

            {/* Smart guidelines */}
            {guides.map((g, i) =>
              g.type === "v" ? (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 pointer-events-none border-l border-dashed border-cyan-400"
                  style={{ left: g.position, opacity: 0.8 }}
                />
              ) : (
                <div
                  key={i}
                  className="absolute left-0 right-0 pointer-events-none border-t border-dashed border-cyan-400"
                  style={{ top: g.position, opacity: 0.8 }}
                />
              ),
            )}

            {/* Drag/resize overlays for each element */}
            {LAYERS.map((key) => {
              const el = localSettings[key] as OverlayElementBase;
              if (!el.visible) return null;
              const { onDragStart, onResizeStart } = handlers[key];
              const isSelected = selectedEl === key;
              return (
                <div
                  key={key}
                  onMouseDown={(e) => {
                    setSelectedEl(key);
                    onDragStart(e);
                  }}
                  style={{
                    position: "absolute",
                    left: el.x,
                    top: el.y,
                    width: el.width,
                    height: el.height,
                    zIndex: 50 + el.z_index,
                    cursor: "move",
                    border: isSelected
                      ? "2px solid #3b82f6"
                      : "2px solid transparent",
                    boxSizing: "border-box",
                  }}
                >
                  {isSelected && (
                    <>
                      {(
                        [
                          "n",
                          "s",
                          "e",
                          "w",
                          "ne",
                          "nw",
                          "se",
                          "sw",
                        ] as ResizeDir[]
                      ).map((dir) => (
                        <ResizeHandle
                          key={dir}
                          dir={dir}
                          onResizeStart={onResizeStart}
                        />
                      ))}
                    </>
                  )}
                </div>
              );
            })}

            {/* Drag tooltip showing dimensions */}
            {isDragging && selectedEl && (
              <div
                className="absolute pointer-events-none bg-black/80 text-white text-[10px] px-2 py-0.5 rounded font-mono"
                style={{
                  left: tooltipPos.x / effectiveScale,
                  top: Math.max(0, tooltipPos.y / effectiveScale - 22),
                  zIndex: 200,
                }}
              >
                {(localSettings[selectedEl] as OverlayElementBase).width} ×{" "}
                {(localSettings[selectedEl] as OverlayElementBase).height}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* RIGHT SIDEBAR: Properties & OBS */}
      <div className="w-72 2xl:w-80 shrink-0 flex flex-col gap-3 min-h-0">
        {/* Properties Panel */}
        <div className="bg-bg-secondary rounded-xl border border-border-subtle p-3 flex-1 min-h-0 overflow-y-auto">
          <p className="text-xs 2xl:text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">
            {ELEMENT_LABELS[selectedEl]}
          </p>

          {/* Position & Size — compact Photoshop style */}
          <div className="space-y-1.5 mb-3">
            <div className="flex gap-2">
              <label className="flex items-center gap-1 flex-1">
                <span className="text-[10px] 2xl:text-xs text-text-muted w-3">X</span>
                <NumInput
                  value={(localSettings[selectedEl] as OverlayElementBase).x}
                  min={0}
                  max={localSettings.canvas_width}
                  onChange={(v) => updateSelectedEl({ x: v })}
                  className="flex-1"
                />
              </label>
              <label className="flex items-center gap-1 flex-1">
                <span className="text-[10px] 2xl:text-xs text-text-muted w-3">Y</span>
                <NumInput
                  value={(localSettings[selectedEl] as OverlayElementBase).y}
                  min={0}
                  max={localSettings.canvas_height}
                  onChange={(v) => updateSelectedEl({ y: v })}
                  className="flex-1"
                />
              </label>
            </div>
            <div className="flex gap-2">
              <label className="flex items-center gap-1 flex-1">
                <span className="text-[10px] 2xl:text-xs text-text-muted w-3">W</span>
                <NumInput
                  value={
                    (localSettings[selectedEl] as OverlayElementBase).width
                  }
                  min={10}
                  max={localSettings.canvas_width}
                  onChange={(v) => updateSelectedEl({ width: v })}
                  className="flex-1"
                />
              </label>
              <label className="flex items-center gap-1 flex-1">
                <span className="text-[10px] 2xl:text-xs text-text-muted w-3">H</span>
                <NumInput
                  value={
                    (localSettings[selectedEl] as OverlayElementBase).height
                  }
                  min={10}
                  max={localSettings.canvas_height}
                  onChange={(v) => updateSelectedEl({ height: v })}
                  className="flex-1"
                />
              </label>
            </div>
            <p className="text-[9px] 2xl:text-[10px] text-text-faint mt-1">
              Pfeiltasten: 1px | Shift: 10px | Tab: wechseln
            </p>
          </div>

          {/* Element-specific properties */}
          {selectedEl === "sprite" && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={localSettings.sprite.show_glow}
                  onChange={(e) =>
                    update({
                      ...localSettings,
                      sprite: {
                        ...localSettings.sprite,
                        show_glow: e.target.checked,
                      },
                    })
                  }
                  className="accent-accent-blue"
                />
                <span className="text-xs 2xl:text-sm text-text-secondary">Glow</span>
              </label>
              {localSettings.sprite.show_glow && (
                <div className="space-y-2">
                  <div className="flex gap-2 items-center">
                    <label className="text-[10px] 2xl:text-xs text-text-muted w-12 2xl:w-14">
                      Farbe
                    </label>
                    <input
                      type="color"
                      value={localSettings.sprite.glow_color || "#ffffff"}
                      onChange={(e) =>
                        update({
                          ...localSettings,
                          sprite: {
                            ...localSettings.sprite,
                            glow_color: e.target.value,
                          },
                        })
                      }
                      className="w-8 h-6 rounded cursor-pointer border-0"
                    />
                  </div>
                  <NumSlider
                    label="Deckkraft"
                    min={0}
                    max={1}
                    step={0.05}
                    value={localSettings.sprite.glow_opacity ?? 0.2}
                    onChange={(v) =>
                      update({
                        ...localSettings,
                        sprite: { ...localSettings.sprite, glow_opacity: v },
                      })
                    }
                  />
                  <NumSlider
                    label="Blur"
                    min={0}
                    max={80}
                    step={1}
                    value={localSettings.sprite.glow_blur ?? 20}
                    onChange={(v) =>
                      update({
                        ...localSettings,
                        sprite: { ...localSettings.sprite, glow_blur: v },
                      })
                    }
                  />
                </div>
              )}
              <div>
                <label className="text-[10px] 2xl:text-xs text-text-muted">
                  Idle Animation
                </label>
                <select
                  value={localSettings.sprite.idle_animation}
                  onChange={(e) =>
                    update({
                      ...localSettings,
                      sprite: {
                        ...localSettings.sprite,
                        idle_animation: e.target.value,
                      },
                    })
                  }
                  className="w-full bg-bg-primary border border-border-subtle rounded px-2 py-1 2xl:px-2.5 2xl:py-1.5 text-xs 2xl:text-sm text-text-primary outline-none"
                >
                  <option value="none">Keine</option>
                  <option value="float">Schweben</option>
                  <option value="bob">Bob</option>
                  <option value="pulse">Puls</option>
                  <option value="rock">Wackeln</option>
                </select>
              </div>
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <label className="text-[10px] 2xl:text-xs text-text-muted">
                    Trigger Animation
                  </label>
                  <button
                    onClick={() => fireTest("sprite")}
                    className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-accent-blue/20 hover:bg-accent-blue/40 text-accent-blue transition-colors"
                  >
                    <Play className="w-2.5 h-2.5 2xl:w-3 2xl:h-3" /> Test
                  </button>
                </div>
                <select
                  value={localSettings.sprite.trigger_enter}
                  onChange={(e) =>
                    update({
                      ...localSettings,
                      sprite: {
                        ...localSettings.sprite,
                        trigger_enter: e.target.value,
                      },
                    })
                  }
                  className="w-full bg-bg-primary border border-border-subtle rounded px-2 py-1 2xl:px-2.5 2xl:py-1.5 text-xs 2xl:text-sm text-text-primary outline-none"
                >
                  <option value="none">Keine</option>
                  <option value="pop">Pop</option>
                  <option value="bounce">Bounce (Hüpfen)</option>
                  <option value="shake">Shake</option>
                  <option value="spin">Spin</option>
                  <option value="flip">Flip</option>
                  <option value="rubber">Rubber Band</option>
                  <option value="flash">Flash</option>
                </select>
              </div>
            </div>
          )}

          {selectedEl === "name" && (
            <div className="space-y-2">
              <TextStyleEditor
                style={localSettings.name.style || DEFAULT_TEXT_STYLE}
                label="Text-Stil"
                onChange={(s) =>
                  update({
                    ...localSettings,
                    name: { ...localSettings.name, style: s },
                  })
                }
              />
              <div>
                <label className="text-[10px] 2xl:text-xs text-text-muted">
                  Idle Animation
                </label>
                <select
                  value={localSettings.name.idle_animation}
                  onChange={(e) =>
                    update({
                      ...localSettings,
                      name: {
                        ...localSettings.name,
                        idle_animation: e.target.value,
                      },
                    })
                  }
                  className="w-full bg-bg-primary border border-border-subtle rounded px-2 py-1 2xl:px-2.5 2xl:py-1.5 text-xs 2xl:text-sm text-text-primary outline-none"
                >
                  <option value="none">Keine</option>
                  <option value="breathe">Atmen</option>
                  <option value="glow">Glühen</option>
                </select>
              </div>
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <label className="text-[10px] 2xl:text-xs text-text-muted">
                    Trigger Animation
                  </label>
                  <button
                    onClick={() => fireTest("name")}
                    className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-accent-blue/20 hover:bg-accent-blue/40 text-accent-blue transition-colors"
                  >
                    <Play className="w-2.5 h-2.5 2xl:w-3 2xl:h-3" /> Test
                  </button>
                </div>
                <select
                  value={localSettings.name.trigger_enter}
                  onChange={(e) =>
                    update({
                      ...localSettings,
                      name: {
                        ...localSettings.name,
                        trigger_enter: e.target.value,
                      },
                    })
                  }
                  className="w-full bg-bg-primary border border-border-subtle rounded px-2 py-1 2xl:px-2.5 2xl:py-1.5 text-xs 2xl:text-sm text-text-primary outline-none"
                >
                  <option value="none">Keine</option>
                  <option value="fade-in">Einblenden</option>
                  <option value="slide-in">Einsliden</option>
                  <option value="pop">Pop</option>
                  <option value="bounce">Bounce</option>
                  <option value="shake">Shake</option>
                  <option value="flip">Flip</option>
                  <option value="rubber">Rubber Band</option>
                </select>
              </div>
            </div>
          )}

          {selectedEl === "counter" && (
            <div className="space-y-2">
              <TextStyleEditor
                style={localSettings.counter.style || DEFAULT_TEXT_STYLE}
                label="Zähler-Stil"
                onChange={(s) =>
                  update({
                    ...localSettings,
                    counter: { ...localSettings.counter, style: s },
                  })
                }
              />
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={localSettings.counter.show_label}
                  onChange={(e) =>
                    update({
                      ...localSettings,
                      counter: {
                        ...localSettings.counter,
                        show_label: e.target.checked,
                      },
                    })
                  }
                  className="accent-accent-blue"
                />
                <span className="text-xs 2xl:text-sm text-text-secondary">Label anzeigen</span>
              </label>
              {localSettings.counter.show_label && (
                <>
                  <input
                    type="text"
                    value={localSettings.counter.label_text}
                    onChange={(e) =>
                      update({
                        ...localSettings,
                        counter: {
                          ...localSettings.counter,
                          label_text: e.target.value,
                        },
                      })
                    }
                    className="w-full bg-bg-primary border border-border-subtle rounded px-2 py-1 2xl:px-2.5 2xl:py-1.5 text-xs 2xl:text-sm text-text-primary outline-none"
                    placeholder="Label-Text"
                  />
                  <TextStyleEditor
                    style={
                      localSettings.counter.label_style || DEFAULT_TEXT_STYLE
                    }
                    label="Label-Stil"
                    onChange={(s) =>
                      update({
                        ...localSettings,
                        counter: { ...localSettings.counter, label_style: s },
                      })
                    }
                  />
                </>
              )}
              <div>
                <label className="text-[10px] 2xl:text-xs text-text-muted">
                  Idle Animation
                </label>
                <select
                  value={localSettings.counter.idle_animation}
                  onChange={(e) =>
                    update({
                      ...localSettings,
                      counter: {
                        ...localSettings.counter,
                        idle_animation: e.target.value,
                      },
                    })
                  }
                  className="w-full bg-bg-primary border border-border-subtle rounded px-2 py-1 2xl:px-2.5 2xl:py-1.5 text-xs 2xl:text-sm text-text-primary outline-none"
                >
                  <option value="none">Keine</option>
                  <option value="breathe">Atmen</option>
                  <option value="glow">Glühen</option>
                </select>
              </div>
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <label className="text-[10px] 2xl:text-xs text-text-muted">
                    Trigger Animation
                  </label>
                  <button
                    onClick={() => fireTest("counter")}
                    className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-accent-blue/20 hover:bg-accent-blue/40 text-accent-blue transition-colors"
                  >
                    <Play className="w-2.5 h-2.5 2xl:w-3 2xl:h-3" /> Test
                  </button>
                </div>
                <select
                  value={localSettings.counter.trigger_enter}
                  onChange={(e) =>
                    update({
                      ...localSettings,
                      counter: {
                        ...localSettings.counter,
                        trigger_enter: e.target.value,
                      },
                    })
                  }
                  className="w-full bg-bg-primary border border-border-subtle rounded px-2 py-1 2xl:px-2.5 2xl:py-1.5 text-xs 2xl:text-sm text-text-primary outline-none"
                >
                  <option value="none">Keine</option>
                  <option value="pop">Pop</option>
                  <option value="flash">Flash</option>
                  <option value="bounce">Bounce (Hüpfen)</option>
                  <option value="shake">Shake</option>
                  <option value="slot">Slot (Ziffern slide)</option>
                  <option value="flip-digit">Flip (Ziffern, Wecker)</option>
                  <option value="slide-up">Slide Up (gesamt)</option>
                  <option value="flip">Flip (gesamt, Wecker)</option>
                  <option value="rubber">Rubber Band</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* OBS Source Panel */}
        <div className="bg-bg-secondary rounded-xl border border-border-subtle p-3 shrink-0">
          <OBSSourceHint pokemonId={activePokemon?.id} />
        </div>
      </div>
    </div>
  );
}
