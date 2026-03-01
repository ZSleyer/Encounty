import { useState, useEffect, useRef, useCallback } from "react";
import { Eye, EyeOff, ChevronUp, ChevronDown, Monitor } from "lucide-react";
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
      <div className="flex gap-2 items-center">
        <label className="text-xs text-gray-500">Winkel:</label>
        <input
          type="number"
          value={angle}
          onChange={(e) => onAngleChange(Number(e.target.value))}
          min={0} max={360}
          className="w-16 bg-bg-secondary border border-border-subtle rounded px-2 py-1 text-xs text-white outline-none"
        />
        <span className="text-xs text-gray-500">°</span>
      </div>
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
      <div className="grid grid-cols-2 gap-1">
        <div>
          <label className="text-[10px] text-gray-500">Schriftart</label>
          <FontPicker value={style.font_family} onChange={(v) => u("font_family", v)} />
        </div>
        <div>
          <label className="text-[10px] text-gray-500">Größe</label>
          <input type="number" value={style.font_size}
            onChange={(e) => u("font_size", Number(e.target.value))}
            className="w-full bg-bg-secondary border border-border-subtle rounded px-2 py-1 text-xs text-white outline-none"
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-500">Gewicht</label>
          <select value={style.font_weight} onChange={(e) => u("font_weight", Number(e.target.value))}
            className="w-full bg-bg-secondary border border-border-subtle rounded px-2 py-1 text-xs text-white outline-none">
            {[100, 300, 400, 500, 700, 900].map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-gray-500">Farb-Typ</label>
          <select value={style.color_type} onChange={(e) => u("color_type", e.target.value as "solid" | "gradient")}
            className="w-full bg-bg-secondary border border-border-subtle rounded px-2 py-1 text-xs text-white outline-none">
            <option value="solid">Einfarbig</option>
            <option value="gradient">Verlauf</option>
          </select>
        </div>
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
      <div className="flex gap-2 items-center">
        <label className="text-[10px] text-gray-500">Umriss</label>
        <select value={style.outline_type} onChange={(e) => u("outline_type", e.target.value as "none" | "solid")}
          className="flex-1 bg-bg-secondary border border-border-subtle rounded px-2 py-1 text-xs text-white outline-none">
          <option value="none">Kein</option>
          <option value="solid">Einfarbig</option>
        </select>
        {style.outline_type === "solid" && (
          <>
            <input type="number" value={style.outline_width} onChange={(e) => u("outline_width", Number(e.target.value))}
              className="w-12 bg-bg-secondary border border-border-subtle rounded px-2 py-1 text-xs text-white outline-none" />
            <input type="color" value={style.outline_color} onChange={(e) => u("outline_color", e.target.value)}
              className="w-7 h-6 rounded cursor-pointer border-0" />
          </>
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

export function OverlayEditor({ settings, onUpdate, activePokemon }: Props) {
  const [localSettings, setLocalSettings] = useState<OverlaySettings>(settings);
  const [selectedEl, setSelectedEl] = useState<ElementKey>("sprite");
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [canvasScale, setCanvasScale] = useState(1);

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
    ? { ...activePokemon }
    : undefined;

  return (
    <div className="flex gap-4 h-[600px]">
      {/* LEFT: Element tree */}
      <div className="w-44 flex-shrink-0 bg-bg-secondary rounded-xl border border-border-subtle p-3 space-y-2 overflow-y-auto">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Ebenen</p>
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
          <div>
            <label className="text-[10px] text-gray-500">Breite</label>
            <input type="number" value={localSettings.canvas_width}
              onChange={(e) => updateField("canvas_width", Number(e.target.value))}
              className="w-full bg-bg-primary border border-border-subtle rounded px-2 py-1 text-xs text-white outline-none" />
          </div>
          <div>
            <label className="text-[10px] text-gray-500">Höhe</label>
            <input type="number" value={localSettings.canvas_height}
              onChange={(e) => updateField("canvas_height", Number(e.target.value))}
              className="w-full bg-bg-primary border border-border-subtle rounded px-2 py-1 text-xs text-white outline-none" />
          </div>
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

      {/* CENTER: Canvas */}
      <div ref={canvasContainerRef} className="flex-1 bg-[repeating-conic-gradient(#1a1a2a_0%_25%,#141420_0%_50%)] bg-[length:20px_20px] rounded-xl border border-border-subtle flex items-center justify-center overflow-hidden">
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
          <Overlay previewSettings={localSettings} previewPokemon={fakePreviewPokemon} />

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

      {/* RIGHT: Properties */}
      <div className="w-56 flex-shrink-0 bg-bg-secondary rounded-xl border border-border-subtle p-3 overflow-y-auto">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          {ELEMENT_LABELS[selectedEl]}
        </p>

        {/* Position & Size */}
        <div className="grid grid-cols-2 gap-1 mb-3">
          {(["x", "y", "width", "height"] as (keyof OverlayElementBase)[]).map((field) => (
            <div key={field}>
              <label className="text-[10px] text-gray-500 uppercase">{field}</label>
              <input
                type="number"
                value={(localSettings[selectedEl] as OverlayElementBase)[field] as number}
                onChange={(e) => {
                  const el = localSettings[selectedEl] as OverlayElementBase;
                  update({ ...localSettings, [selectedEl]: { ...el, [field]: Number(e.target.value) } });
                }}
                className="w-full bg-bg-primary border border-border-subtle rounded px-2 py-1 text-xs text-white outline-none"
              />
            </div>
          ))}
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
              <div className="flex gap-2 items-center">
                <label className="text-[10px] text-gray-500">Farbe</label>
                <input type="color" value={localSettings.sprite.glow_color.replace(/rgba?\([^)]+\)/, "#ffffff") || "#ffffff"}
                  onChange={(e) => update({ ...localSettings, sprite: { ...localSettings.sprite, glow_color: e.target.value + "33" } })}
                  className="w-8 h-6 rounded cursor-pointer border-0" />
              </div>
            )}
            <div>
              <label className="text-[10px] text-gray-500">Idle Animation</label>
              <select value={localSettings.sprite.idle_animation}
                onChange={(e) => update({ ...localSettings, sprite: { ...localSettings.sprite, idle_animation: e.target.value } })}
                className="w-full bg-bg-primary border border-border-subtle rounded px-2 py-1 text-xs text-white outline-none">
                <option value="none">Keine</option>
                <option value="float">Schweben</option>
                <option value="pulse">Puls</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-gray-500">Trigger Animation</label>
              <select value={localSettings.sprite.trigger_enter}
                onChange={(e) => update({ ...localSettings, sprite: { ...localSettings.sprite, trigger_enter: e.target.value } })}
                className="w-full bg-bg-primary border border-border-subtle rounded px-2 py-1 text-xs text-white outline-none">
                <option value="none">Keine</option>
                <option value="pop">Pop</option>
                <option value="shake">Shake</option>
                <option value="bounce">Bounce</option>
                <option value="spin">Spin</option>
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
              <label className="text-[10px] text-gray-500">Trigger Animation</label>
              <select value={localSettings.name.trigger_enter}
                onChange={(e) => update({ ...localSettings, name: { ...localSettings.name, trigger_enter: e.target.value } })}
                className="w-full bg-bg-primary border border-border-subtle rounded px-2 py-1 text-xs text-white outline-none">
                <option value="none">Keine</option>
                <option value="fade-in">Einblenden</option>
                <option value="slide-in">Einsliden</option>
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
              <label className="text-[10px] text-gray-500">Trigger Animation</label>
              <select value={localSettings.counter.trigger_enter}
                onChange={(e) => update({ ...localSettings, counter: { ...localSettings.counter, trigger_enter: e.target.value } })}
                className="w-full bg-bg-primary border border-border-subtle rounded px-2 py-1 text-xs text-white outline-none">
                <option value="none">Keine</option>
                <option value="pop">Pop</option>
                <option value="count-flash">Flash</option>
                <option value="shake">Shake</option>
              </select>
            </div>
          </div>
        )}

        {/* OBS URL hint */}
        <div className="mt-4 pt-3 border-t border-border-subtle">
          <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
            <Monitor className="w-3 h-3" />
            OBS Browser Source:
          </div>
          <code className="text-[10px] text-accent-blue break-all">
            http://localhost:8080/overlay
          </code>
        </div>
      </div>
    </div>
  );
}
