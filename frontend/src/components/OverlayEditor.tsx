import { useState, useEffect, useRef, useCallback } from "react";
import { Eye, EyeOff, ChevronUp, ChevronDown, Monitor, Copy, ExternalLink, RotateCcw, Play, Plus, Minus, RefreshCw } from "lucide-react";
import { OverlaySettings, OverlayElementBase, TextStyle, GradientStop } from "../types";
import { Overlay } from "../pages/Overlay";
import type { Pokemon } from "../types";

interface Props {
  settings: OverlaySettings;
  onUpdate: (settings: OverlaySettings) => void;
  activePokemon?: Pokemon;
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
  color_type: "solid",
  color: "#ffffff",
  gradient_stops: [{ color: "#ffffff", position: 0 }, { color: "#aaaaaa", position: 100 }],
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
  background_color: "#000000",
  background_opacity: 0.6,
  blur: 8,
  show_border: true,
  border_color: "rgba(255,255,255,0.1)",
  border_radius: 40,
  sprite: {
    visible: true, x: 10, y: 10, width: 180, height: 180, z_index: 1,
    show_glow: true, glow_color: "#ffffff", glow_opacity: 0.2, glow_blur: 20,
    idle_animation: "float", trigger_enter: "pop", trigger_exit: "none",
  },
  name: {
    visible: true, x: 200, y: 20, width: 300, height: 40, z_index: 2,
    style: { ...DEFAULT_TEXT_STYLE, font_family: "sans", font_size: 20, font_weight: 400, color: "#94a3b8" },
    idle_animation: "none", trigger_enter: "fade-in",
  },
  counter: {
    visible: true, x: 200, y: 80, width: 300, height: 100, z_index: 3,
    style: { ...DEFAULT_TEXT_STYLE, font_family: "pokemon", font_size: 80, font_weight: 700, color: "#ffffff", outline_type: "solid", outline_width: 6, outline_color: "#000000" },
    show_label: false, label_text: "Begegnungen",
    label_style: { ...DEFAULT_TEXT_STYLE, font_family: "sans", font_size: 14, font_weight: 400, color: "#94a3b8" },
    idle_animation: "none", trigger_enter: "pop",
  },
};

function NumInput({ value, min, max, step = 1, onChange, className }: {
  value: number; min?: number; max?: number; step?: number;
  onChange: (v: number) => void; className?: string;
}) {
  const clamp = (v: number) => {
    let n = v;
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    return n;
  };
  return (
    <div className={`flex items-center border border-border-subtle rounded overflow-hidden bg-bg-primary ${className ?? ""}`}>
      <button type="button" onClick={() => onChange(clamp(value - step))}
        className="px-1.5 self-stretch flex items-center text-gray-500 hover:text-white hover:bg-bg-hover transition-colors text-sm leading-none flex-shrink-0">
        −
      </button>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 min-w-0 bg-transparent text-[10px] text-white text-center outline-none py-0.5 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button type="button" onClick={() => onChange(clamp(value + step))}
        className="px-1.5 self-stretch flex items-center text-gray-500 hover:text-white hover:bg-bg-hover transition-colors text-sm leading-none flex-shrink-0">
        +
      </button>
    </div>
  );
}

function NumSlider({
  label, value, min, max, step = 1, onChange,
}: {
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <label className="text-[10px] text-gray-500">{label}</label>
        <NumInput value={value} min={min} max={max} step={step} onChange={onChange} className="w-20" />
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

function FontPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const POPULAR_FONTS = [
    "sans", "serif", "monospace", "pokemon",
    "Roboto", "Open Sans", "Lato", "Montserrat", "Oswald", "Raleway",
    "Poppins", "Nunito", "Ubuntu", "Merriweather", "Playfair Display",
    "Bebas Neue", "Cinzel", "Exo 2", "Orbitron", "Press Start 2P",
  ];
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-bg-secondary border border-border-subtle rounded px-2 py-1 text-xs text-white outline-none"
    >
      {POPULAR_FONTS.map((f) => (
        <option key={f} value={f}>{f}</option>
      ))}
    </select>
  );
}

function GradientEditor({ stops, angle, onChange, onAngleChange }: {
  stops: GradientStop[];
  angle: number;
  onChange: (stops: GradientStop[]) => void;
  onAngleChange: (a: number) => void;
}) {
  return (
    <div className="space-y-2">
      <NumSlider label="Winkel (°)" value={angle} min={0} max={360} onChange={onAngleChange} />
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
            className="w-8 h-6 rounded cursor-pointer border-0"
          />
          <input
            type="range"
            value={stop.position}
            onChange={(e) => {
              const newStops = [...stops];
              newStops[i] = { ...stop, position: Number(e.target.value) };
              onChange(newStops);
            }}
            min={0} max={100}
            className="flex-1 h-1 accent-accent-blue"
          />
          <span className="text-xs text-gray-500 w-8">{stop.position}%</span>
        </div>
      ))}
    </div>
  );
}

function TextStyleEditor({ style, onChange, label }: {
  style: TextStyle;
  onChange: (s: TextStyle) => void;
  label: string;
}) {
  const u = (field: keyof TextStyle, value: unknown) => onChange({ ...style, [field]: value });
  return (
    <div className="space-y-2 border border-border-subtle/50 rounded p-2">
      <p className="text-xs text-gray-400 font-semibold">{label}</p>

      {/* Font */}
      <div>
        <label className="text-[10px] text-gray-500">Schriftart</label>
        <FontPicker value={style.font_family} onChange={(v) => u("font_family", v)} />
      </div>
      <NumSlider label="Größe (px)" value={style.font_size} min={6} max={200} onChange={(v) => u("font_size", v)} />
      <div>
        <label className="text-[10px] text-gray-500">Gewicht</label>
        <select value={style.font_weight} onChange={(e) => u("font_weight", Number(e.target.value))}
          className="w-full bg-bg-secondary border border-border-subtle rounded px-2 py-1 text-xs text-white outline-none">
          {[100, 300, 400, 500, 700, 900].map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
      </div>

      {/* Color */}
      <div>
        <label className="text-[10px] text-gray-500">Farb-Typ</label>
        <select value={style.color_type} onChange={(e) => u("color_type", e.target.value as "solid" | "gradient")}
          className="w-full bg-bg-secondary border border-border-subtle rounded px-2 py-1 text-xs text-white outline-none">
          <option value="solid">Einfarbig</option>
          <option value="gradient">Verlauf</option>
        </select>
      </div>
      {style.color_type === "solid" ? (
        <div className="flex gap-2 items-center">
          <label className="text-[10px] text-gray-500">Farbe</label>
          <input type="color" value={style.color} onChange={(e) => u("color", e.target.value)}
            className="w-8 h-6 rounded cursor-pointer border-0" />
          <span className="text-[10px] text-gray-400">{style.color}</span>
        </div>
      ) : (
        <GradientEditor
          stops={style.gradient_stops || []}
          angle={style.gradient_angle || 180}
          onChange={(s) => u("gradient_stops", s)}
          onAngleChange={(a) => u("gradient_angle", a)}
        />
      )}

      {/* Outline */}
      <div className="space-y-1">
        <div className="flex gap-2 items-center">
          <label className="text-[10px] text-gray-500 w-14 flex-shrink-0">Umriss</label>
          <select value={style.outline_type} onChange={(e) => u("outline_type", e.target.value as "none" | "solid")}
            className="flex-1 bg-bg-secondary border border-border-subtle rounded px-2 py-1 text-xs text-white outline-none">
            <option value="none">Kein</option>
            <option value="solid">Einfarbig</option>
          </select>
        </div>
        {style.outline_type === "solid" && (
          <div className="pl-4 space-y-1">
            <div className="flex gap-2 items-center">
              <label className="text-[10px] text-gray-500 w-10 flex-shrink-0">Farbe</label>
              <input type="color" value={style.outline_color} onChange={(e) => u("outline_color", e.target.value)}
                className="w-8 h-6 rounded cursor-pointer border-0" />
            </div>
            <NumSlider label="Breite (px)" value={style.outline_width} min={1} max={20} onChange={(v) => u("outline_width", v)} />
          </div>
        )}
      </div>

      {/* Text Shadow */}
      <div className="space-y-1">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={style.text_shadow}
            onChange={(e) => u("text_shadow", e.target.checked)}
            className="accent-accent-blue" />
          <span className="text-[10px] text-gray-400">Schatten</span>
        </label>
        {style.text_shadow && (
          <div className="pl-4 space-y-1">
            <div className="flex gap-2 items-center">
              <label className="text-[10px] text-gray-500 w-10 flex-shrink-0">Farbe</label>
              <input type="color" value={style.text_shadow_color} onChange={(e) => u("text_shadow_color", e.target.value)}
                className="w-8 h-6 rounded cursor-pointer border-0" />
            </div>
            <NumSlider label="Blur (px)" value={style.text_shadow_blur} min={0} max={40} onChange={(v) => u("text_shadow_blur", v)} />
            <NumSlider label="X (px)" value={style.text_shadow_x} min={-30} max={30} onChange={(v) => u("text_shadow_x", v)} />
            <NumSlider label="Y (px)" value={style.text_shadow_y} min={-30} max={30} onChange={(v) => u("text_shadow_y", v)} />
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
) {
  const dragging = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizing = useRef<{ dir: ResizeDir; startX: number; startY: number; origX: number; origY: number; origW: number; origH: number } | null>(null);

  const getEl = useCallback(() => settings[elementKey] as OverlayElementBase, [settings, elementKey]);
  const setEl = useCallback((patch: Partial<OverlayElementBase>) => {
    onUpdate({ ...settings, [elementKey]: { ...settings[elementKey], ...patch } });
  }, [settings, elementKey, onUpdate]);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = getEl();
    dragging.current = { startX: e.clientX, startY: e.clientY, origX: el.x, origY: el.y };

    const onMove = (me: MouseEvent) => {
      if (!dragging.current) return;
      const dx = (me.clientX - dragging.current.startX) / canvasScale;
      const dy = (me.clientY - dragging.current.startY) / canvasScale;
      setEl({ x: Math.round(dragging.current.origX + dx), y: Math.round(dragging.current.origY + dy) });
    };
    const onUp = () => {
      dragging.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [getEl, setEl, canvasScale]);

  const onResizeStart = useCallback((dir: ResizeDir) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = getEl();
    resizing.current = { dir, startX: e.clientX, startY: e.clientY, origX: el.x, origY: el.y, origW: el.width, origH: el.height };

    const onMove = (me: MouseEvent) => {
      if (!resizing.current) return;
      const { dir: d, startX, startY, origX, origY, origW, origH } = resizing.current;
      const dx = (me.clientX - startX) / canvasScale;
      const dy = (me.clientY - startY) / canvasScale;
      let x = origX, y = origY, w = origW, h = origH;
      if (d.includes("e")) w = Math.max(20, origW + dx);
      if (d.includes("s")) h = Math.max(20, origH + dy);
      if (d.includes("w")) { w = Math.max(20, origW - dx); x = origX + origW - w; }
      if (d.includes("n")) { h = Math.max(20, origH - dy); y = origY + origH - h; }
      setEl({ x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) });
    };
    const onUp = () => {
      resizing.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [getEl, setEl, canvasScale]);

  return { onDragStart, onResizeStart };
}

function ResizeHandle({ dir, onResizeStart }: { dir: ResizeDir; onResizeStart: (dir: ResizeDir) => (e: React.MouseEvent) => void }) {
  const posStyles: Record<ResizeDir, React.CSSProperties> = {
    n:  { top: -4, left: "50%", transform: "translateX(-50%)", cursor: "n-resize" },
    s:  { bottom: -4, left: "50%", transform: "translateX(-50%)", cursor: "s-resize" },
    e:  { right: -4, top: "50%", transform: "translateY(-50%)", cursor: "e-resize" },
    w:  { left: -4, top: "50%", transform: "translateY(-50%)", cursor: "w-resize" },
    ne: { top: -4, right: -4, cursor: "ne-resize" },
    nw: { top: -4, left: -4, cursor: "nw-resize" },
    se: { bottom: -4, right: -4, cursor: "se-resize" },
    sw: { bottom: -4, left: -4, cursor: "sw-resize" },
  };
  return (
    <div
      onMouseDown={onResizeStart(dir)}
      style={{ position: "absolute", width: 8, height: 8, background: "#3b82f6", border: "1px solid white", borderRadius: 2, zIndex: 100, ...posStyles[dir] }}
    />
  );
}

function OBSSourceHint() {
  const [copied, setCopied] = useState(false);
  const overlayUrl = `${window.location.origin}/overlay`;

  const copy = () => {
    navigator.clipboard.writeText(overlayUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="mt-4 pt-3 border-t border-border-subtle">
      <div className="flex items-center gap-1 text-xs text-gray-500 mb-1.5">
        <Monitor className="w-3 h-3" />
        OBS Browser Source:
      </div>
      <div className="bg-bg-primary rounded px-2 py-1.5 mb-1.5">
        <code className="text-[10px] text-accent-blue break-all">{overlayUrl}</code>
      </div>
      <div className="flex gap-1">
        <button
          onClick={copy}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-bg-primary hover:bg-bg-hover text-gray-400 hover:text-white transition-colors"
          title="URL kopieren"
        >
          <Copy className="w-3 h-3" />
          {copied ? "Kopiert!" : "Kopieren"}
        </button>
        <a
          href={overlayUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-bg-primary hover:bg-bg-hover text-gray-400 hover:text-white transition-colors"
          title="In neuem Tab öffnen"
        >
          <ExternalLink className="w-3 h-3" />
          Öffnen
        </a>
      </div>
    </div>
  );
}

export function OverlayEditor({ settings, onUpdate, activePokemon }: Props) {
  const [localSettings, setLocalSettings] = useState<OverlaySettings>(settings);
  const [selectedEl, setSelectedEl] = useState<ElementKey>("sprite");
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [canvasScale, setCanvasScale] = useState(1);
  const [testTrigger, setTestTrigger] = useState<{ element: ElementKey; n: number; reverse?: boolean }>({ element: "counter", n: 0 });
  const fireTest = (element: ElementKey, reverse = false) => setTestTrigger({ element, n: Date.now(), reverse });

  // Local fake counter — isolated from live OBS overlay
  const [fakeCount, setFakeCount] = useState<number | null>(null);
  useEffect(() => { setFakeCount(null); }, [activePokemon?.id]);
  const currentCount = fakeCount !== null ? fakeCount : (activePokemon?.encounters ?? 0);

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

  useEffect(() => { setLocalSettings(settings); }, [settings]);

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

  const update = useCallback((s: OverlaySettings) => {
    setLocalSettings(s);
    onUpdate(s);
  }, [onUpdate]);

  const updateField = <K extends keyof OverlaySettings>(field: K, value: OverlaySettings[K]) => {
    update({ ...localSettings, [field]: value });
  };

  const spriteHandlers = useElementDrag("sprite", localSettings, update, canvasScale);
  const nameHandlers = useElementDrag("name", localSettings, update, canvasScale);
  const counterHandlers = useElementDrag("counter", localSettings, update, canvasScale);

  const handlers: Record<ElementKey, ReturnType<typeof useElementDrag>> = {
    sprite: spriteHandlers,
    name: nameHandlers,
    counter: counterHandlers,
  };

  const LAYERS: ElementKey[] = ["sprite", "name", "counter"];

  const moveLayer = (key: ElementKey, dir: "up" | "down") => {
    const el = localSettings[key] as OverlayElementBase;
    const delta = dir === "up" ? 1 : -1;
    update({ ...localSettings, [key]: { ...el, z_index: Math.max(0, el.z_index + delta) } });
  };

  const fakePreviewPokemon: Pokemon | undefined = activePokemon
    ? { ...activePokemon, encounters: currentCount }
    : undefined;

  return (
    <div className="flex gap-4 h-[600px]">
      {/* LEFT: Element tree */}
      <div className="w-44 flex-shrink-0 bg-bg-secondary rounded-xl border border-border-subtle p-3 space-y-2 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Ebenen</p>
          <button
            onClick={() => update(DEFAULT_OVERLAY_SETTINGS)}
            title="Layout zurücksetzen"
            className="flex items-center gap-1 px-1.5 py-1 rounded text-[10px] text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
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
                selectedEl === key ? "bg-accent-blue/20 border border-accent-blue/40" : "hover:bg-bg-hover border border-transparent"
              }`}
            >
              <span className="text-xs text-white">{ELEMENT_LABELS[key]}</span>
              <div className="flex items-center gap-1">
                <button onClick={(e) => { e.stopPropagation(); moveLayer(key, "up"); }} className="text-gray-500 hover:text-white transition-colors">
                  <ChevronUp className="w-3 h-3" />
                </button>
                <button onClick={(e) => { e.stopPropagation(); moveLayer(key, "down"); }} className="text-gray-500 hover:text-white transition-colors">
                  <ChevronDown className="w-3 h-3" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    update({ ...localSettings, [key]: { ...el, visible: !el.visible } });
                  }}
                  className="text-gray-500 hover:text-white transition-colors"
                >
                  {el.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                </button>
              </div>
            </div>
          );
        })}

        <div className="border-t border-border-subtle pt-3 space-y-2">
          <p className="text-[10px] text-gray-500">Canvas</p>
          <NumSlider label="Breite" value={localSettings.canvas_width} min={100} max={1920} step={10}
            onChange={(v) => updateField("canvas_width", v)} />
          <NumSlider label="Höhe" value={localSettings.canvas_height} min={50} max={1080} step={10}
            onChange={(v) => updateField("canvas_height", v)} />
          <div>
            <label className="text-[10px] text-gray-500">Hintergrund</label>
            <input type="color" value={localSettings.background_color}
              onChange={(e) => updateField("background_color", e.target.value)}
              className="w-full h-6 rounded cursor-pointer border-0" />
          </div>
          <div>
            <label className="text-[10px] text-gray-500">Deckkraft {Math.round(localSettings.background_opacity * 100)}%</label>
            <input type="range" min={0} max={1} step={0.05} value={localSettings.background_opacity}
              onChange={(e) => updateField("background_opacity", Number(e.target.value))}
              className="w-full h-1 accent-accent-blue" />
          </div>
          <div>
            <label className="text-[10px] text-gray-500">Blur {localSettings.blur}px</label>
            <input type="range" min={0} max={30} value={localSettings.blur}
              onChange={(e) => updateField("blur", Number(e.target.value))}
              className="w-full h-1 accent-accent-blue" />
          </div>
          <div>
            <label className="text-[10px] text-gray-500">Radius {localSettings.border_radius}px</label>
            <input type="range" min={0} max={60} value={localSettings.border_radius}
              onChange={(e) => updateField("border_radius", Number(e.target.value))}
              className="w-full h-1 accent-accent-blue" />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={localSettings.show_border}
              onChange={(e) => updateField("show_border", e.target.checked)}
              className="accent-accent-blue" />
            <span className="text-[10px] text-gray-400">Rahmen</span>
          </label>
        </div>
      </div>

      {/* CENTER: Canvas + Tester */}
      <div className="flex-1 flex flex-col gap-2 min-w-0">

      {/* Hotkey Tester toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-bg-secondary rounded-xl border border-border-subtle flex-shrink-0">
        <span className="text-[10px] text-gray-500 mr-1">Animations-Test:</span>
        <button
          onClick={testIncrement}
          disabled={!activePokemon}
          title="+1 (nur Vorschau, kein echtes Zählen)"
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-accent-green/20 hover:bg-accent-green/40 text-accent-green text-xs font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Plus className="w-3 h-3" /> +1
        </button>
        <button
          onClick={testDecrement}
          disabled={!activePokemon}
          title="-1 (nur Vorschau, kein echtes Zählen)"
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/40 text-red-400 text-xs font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Minus className="w-3 h-3" /> -1
        </button>
        <button
          onClick={testReset}
          disabled={!activePokemon}
          title="Reset (nur Vorschau)"
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-bg-hover hover:bg-bg-hover/80 text-gray-400 hover:text-white text-xs font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <RefreshCw className="w-3 h-3" /> Reset
        </button>
        {activePokemon && (
          <span className="text-[10px] text-gray-600 ml-auto">{currentCount} (Vorschau)</span>
        )}
        {!activePokemon && (
          <span className="text-[10px] text-gray-600 ml-1">Kein aktives Pokémon</span>
        )}
      </div>

      <div ref={canvasContainerRef} className="flex-1 bg-[repeating-conic-gradient(#1a1a2a_0%_25%,#141420_0%_50%)] bg-[length:20px_20px] rounded-xl border border-border-subtle flex items-center justify-center overflow-hidden min-h-0">
        <div
          style={{
            transform: `scale(${canvasScale})`,
            transformOrigin: "center center",
            position: "relative",
            width: localSettings.canvas_width,
            height: localSettings.canvas_height,
          }}
        >
          {/* Actual overlay preview */}
          <Overlay previewSettings={localSettings} previewPokemon={fakePreviewPokemon} testTrigger={testTrigger} />

          {/* Drag/resize overlays for each element */}
          {LAYERS.map((key) => {
            const el = localSettings[key] as OverlayElementBase;
            if (!el.visible) return null;
            const { onDragStart, onResizeStart } = handlers[key];
            const isSelected = selectedEl === key;
            return (
              <div
                key={key}
                onMouseDown={(e) => { setSelectedEl(key); onDragStart(e); }}
                style={{
                  position: "absolute",
                  left: el.x,
                  top: el.y,
                  width: el.width,
                  height: el.height,
                  zIndex: 50 + el.z_index,
                  cursor: "move",
                  border: isSelected ? "2px solid #3b82f6" : "2px solid transparent",
                  boxSizing: "border-box",
                }}
              >
                {isSelected && (
                  <>
                    {(["n", "s", "e", "w", "ne", "nw", "se", "sw"] as ResizeDir[]).map((dir) => (
                      <ResizeHandle key={dir} dir={dir} onResizeStart={onResizeStart} />
                    ))}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      </div>{/* end CENTER flex-col */}

      {/* RIGHT: Properties */}
      <div className="w-56 flex-shrink-0 bg-bg-secondary rounded-xl border border-border-subtle p-3 overflow-y-auto">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          {ELEMENT_LABELS[selectedEl]}
        </p>

        {/* Position & Size */}
        <div className="space-y-2 mb-3">
          {(["x", "y", "width", "height"] as (keyof OverlayElementBase)[]).map((field) => {
            const el = localSettings[selectedEl] as OverlayElementBase;
            const isPos = field === "x" || field === "y";
            const sliderMax = field === "x" || field === "width"
              ? localSettings.canvas_width
              : localSettings.canvas_height;
            return (
              <NumSlider
                key={field}
                label={field.toUpperCase()}
                value={el[field] as number}
                min={isPos ? 0 : 10}
                max={sliderMax}
                onChange={(v) => update({ ...localSettings, [selectedEl]: { ...el, [field]: v } })}
              />
            );
          })}
        </div>

        {/* Element-specific properties */}
        {selectedEl === "sprite" && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={localSettings.sprite.show_glow}
                onChange={(e) => update({ ...localSettings, sprite: { ...localSettings.sprite, show_glow: e.target.checked } })}
                className="accent-accent-blue" />
              <span className="text-xs text-gray-400">Glow</span>
            </label>
            {localSettings.sprite.show_glow && (
              <div className="space-y-2">
                <div className="flex gap-2 items-center">
                  <label className="text-[10px] text-gray-500 w-12">Farbe</label>
                  <input type="color" value={localSettings.sprite.glow_color || "#ffffff"}
                    onChange={(e) => update({ ...localSettings, sprite: { ...localSettings.sprite, glow_color: e.target.value } })}
                    className="w-8 h-6 rounded cursor-pointer border-0" />
                </div>
                <NumSlider label="Deckkraft" min={0} max={1} step={0.05}
                  value={localSettings.sprite.glow_opacity ?? 0.2}
                  onChange={(v) => update({ ...localSettings, sprite: { ...localSettings.sprite, glow_opacity: v } })} />
                <NumSlider label="Blur" min={0} max={80} step={1}
                  value={localSettings.sprite.glow_blur ?? 20}
                  onChange={(v) => update({ ...localSettings, sprite: { ...localSettings.sprite, glow_blur: v } })} />
              </div>
            )}
            <div>
              <label className="text-[10px] text-gray-500">Idle Animation</label>
              <select value={localSettings.sprite.idle_animation}
                onChange={(e) => update({ ...localSettings, sprite: { ...localSettings.sprite, idle_animation: e.target.value } })}
                className="w-full bg-bg-primary border border-border-subtle rounded px-2 py-1 text-xs text-white outline-none">
                <option value="none">Keine</option>
                <option value="float">Schweben</option>
                <option value="bob">Bob</option>
                <option value="pulse">Puls</option>
                <option value="rock">Wackeln</option>
              </select>
            </div>
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <label className="text-[10px] text-gray-500">Trigger Animation</label>
                <button onClick={() => fireTest("sprite")}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-accent-blue/20 hover:bg-accent-blue/40 text-accent-blue transition-colors">
                  <Play className="w-2.5 h-2.5" /> Test
                </button>
              </div>
              <select value={localSettings.sprite.trigger_enter}
                onChange={(e) => update({ ...localSettings, sprite: { ...localSettings.sprite, trigger_enter: e.target.value } })}
                className="w-full bg-bg-primary border border-border-subtle rounded px-2 py-1 text-xs text-white outline-none">
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
              onChange={(s) => update({ ...localSettings, name: { ...localSettings.name, style: s } })}
            />
            <div>
              <label className="text-[10px] text-gray-500">Idle Animation</label>
              <select value={localSettings.name.idle_animation}
                onChange={(e) => update({ ...localSettings, name: { ...localSettings.name, idle_animation: e.target.value } })}
                className="w-full bg-bg-primary border border-border-subtle rounded px-2 py-1 text-xs text-white outline-none">
                <option value="none">Keine</option>
                <option value="breathe">Atmen</option>
                <option value="glow">Glühen</option>
              </select>
            </div>
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <label className="text-[10px] text-gray-500">Trigger Animation</label>
                <button onClick={() => fireTest("name")}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-accent-blue/20 hover:bg-accent-blue/40 text-accent-blue transition-colors">
                  <Play className="w-2.5 h-2.5" /> Test
                </button>
              </div>
              <select value={localSettings.name.trigger_enter}
                onChange={(e) => update({ ...localSettings, name: { ...localSettings.name, trigger_enter: e.target.value } })}
                className="w-full bg-bg-primary border border-border-subtle rounded px-2 py-1 text-xs text-white outline-none">
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
              onChange={(s) => update({ ...localSettings, counter: { ...localSettings.counter, style: s } })}
            />
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={localSettings.counter.show_label}
                onChange={(e) => update({ ...localSettings, counter: { ...localSettings.counter, show_label: e.target.checked } })}
                className="accent-accent-blue" />
              <span className="text-xs text-gray-400">Label anzeigen</span>
            </label>
            {localSettings.counter.show_label && (
              <>
                <input type="text" value={localSettings.counter.label_text}
                  onChange={(e) => update({ ...localSettings, counter: { ...localSettings.counter, label_text: e.target.value } })}
                  className="w-full bg-bg-primary border border-border-subtle rounded px-2 py-1 text-xs text-white outline-none"
                  placeholder="Label-Text" />
                <TextStyleEditor
                  style={localSettings.counter.label_style || DEFAULT_TEXT_STYLE}
                  label="Label-Stil"
                  onChange={(s) => update({ ...localSettings, counter: { ...localSettings.counter, label_style: s } })}
                />
              </>
            )}
            <div>
              <label className="text-[10px] text-gray-500">Idle Animation</label>
              <select value={localSettings.counter.idle_animation}
                onChange={(e) => update({ ...localSettings, counter: { ...localSettings.counter, idle_animation: e.target.value } })}
                className="w-full bg-bg-primary border border-border-subtle rounded px-2 py-1 text-xs text-white outline-none">
                <option value="none">Keine</option>
                <option value="breathe">Atmen</option>
                <option value="glow">Glühen</option>
              </select>
            </div>
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <label className="text-[10px] text-gray-500">Trigger Animation</label>
                <button onClick={() => fireTest("counter")}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-accent-blue/20 hover:bg-accent-blue/40 text-accent-blue transition-colors">
                  <Play className="w-2.5 h-2.5" /> Test
                </button>
              </div>
              <select value={localSettings.counter.trigger_enter}
                onChange={(e) => update({ ...localSettings, counter: { ...localSettings.counter, trigger_enter: e.target.value } })}
                className="w-full bg-bg-primary border border-border-subtle rounded px-2 py-1 text-xs text-white outline-none">
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

        {/* OBS URL hint */}
        <OBSSourceHint />
      </div>
    </div>
  );
}
