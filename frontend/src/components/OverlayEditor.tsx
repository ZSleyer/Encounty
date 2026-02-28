import { useState, useEffect } from "react";
import {
  Move,
  Layout,
  Type,
  Palette,
  Monitor,
  Eye,
  EyeOff,
  RefreshCw,
  Plus,
  Minus,
  RotateCcw,
  Sparkles,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { OverlaySettings, Pokemon } from "../types";
import { Overlay } from "../pages/Overlay";

interface Props {
  settings: OverlaySettings;
  onUpdate: (settings: OverlaySettings) => void;
  activePokemon?: Pokemon;
}

export function OverlayEditor({ settings, onUpdate, activePokemon }: Props) {
  const [localSettings, setLocalSettings] = useState<OverlaySettings>(settings);
  const [previewCounter, setPreviewCounter] = useState<number>(
    activePokemon?.encounters || 0,
  );
  const [lastPokemonId, setLastPokemonId] = useState<string | undefined>(
    activePokemon?.id,
  );

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (activePokemon?.id !== lastPokemonId) {
      setPreviewCounter(activePokemon?.encounters || 0);
      setLastPokemonId(activePokemon?.id);
    }
  }, [activePokemon, lastPokemonId]);

  const updateField = (field: keyof OverlaySettings, value: any) => {
    const newSettings = { ...localSettings, [field]: value };
    setLocalSettings(newSettings);
    onUpdate(newSettings);
  };

  const handleReset = () => {
    const defaultSettings: OverlaySettings = {
      layout: "horizontal",
      sprite_position: "left",
      sprite_size: 150,
      font_family: "pokemon",
      font_size: 80,
      text_color: "#ffffff",
      outline_color: "#000000",
      outline_width: 8,
      background_color: "#1a1a2a",
      opacity: 0.8,
      blur: 10,
      show_name: true,
      show_encounter: true,
      show_border: true,
      gap: 20,
      custom_font: "",
      gradient_enabled: false,
      gradient_color: "#ffd700",
      animation_increment: "pop",
      animation_decrement: "shake",
      animation_reset: "rotate",
      show_sprite_glow: true,
      sprite_on_top: false,
      animation_target: "both",
      inner_layout: "vertical",
      outer_element: "none",
      layer_order: ["sprite", "name", "counter"],
      name_size: 24,
      name_color: "#94a3b8",
      name_outline_color: "#000000",
      name_outline_width: 0,
      name_gradient_enabled: false,
      name_gradient_color: "#ffffff",
      name_font_family: "sans",
      name_custom_font: "",
    };
    setLocalSettings(defaultSettings);
    onUpdate(defaultSettings);
  };

  const moveLayer = (index: number, direction: "up" | "down") => {
    const newOrder = [
      ...(localSettings.layer_order || ["sprite", "name", "counter"]),
    ];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex >= 0 && targetIndex < newOrder.length) {
      [newOrder[index], newOrder[targetIndex]] = [
        newOrder[targetIndex],
        newOrder[index],
      ];
      updateField("layer_order", newOrder);
    }
  };

  const fonts = [
    { value: "sans", label: "Modern Sans" },
    { value: "serif", label: "Classic Serif" },
    { value: "pokemon", label: "Pokémon Pixel" },
  ];

  const mockPokemon = activePokemon
    ? { ...activePokemon, encounters: previewCounter }
    : undefined;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
      {/* Editor Controls */}
      <div className="space-y-6">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-gray-500 uppercase tracking-widest font-bold">
            Overlay Konfiguration
          </p>
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-500 text-[10px] font-bold uppercase tracking-wider transition-colors border border-red-500/20"
          >
            <RefreshCw className="w-3 h-3" /> Standardwerte
          </button>
        </div>

        {/* Global Layout */}
        <section className="bg-bg-secondary/50 rounded-xl p-5 border border-border-subtle/50">
          <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
            <Layout className="w-4 h-4 text-accent-blue" /> Layout & Hintergrund
          </h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-[10px] text-gray-400 uppercase tracking-wider mb-1.5">
                Ausrichtung
              </label>
              <select
                value={localSettings.layout}
                onChange={(e) => updateField("layout", e.target.value)}
                className="w-full bg-bg-primary border border-border-subtle rounded-lg px-3 py-2 text-sm text-white"
              >
                <option value="horizontal">Horizontal</option>
                <option value="vertical">Vertikal</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-gray-400 uppercase tracking-wider mb-1.5">
                Abstand (Gap: {localSettings.gap}px)
              </label>
              <input
                type="range"
                min="-50"
                max="200"
                value={localSettings.gap}
                onChange={(e) => updateField("gap", parseInt(e.target.value))}
                className="w-full accent-accent-blue"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] text-gray-400 uppercase tracking-wider mb-1.5">
                HG Farbe
              </label>
              <input
                type="color"
                value={localSettings.background_color}
                onChange={(e) =>
                  updateField("background_color", e.target.value)
                }
                className="w-full h-8 rounded-lg bg-transparent cursor-pointer"
              />
            </div>
            <div>
              <label className="block text-[10px] text-gray-400 uppercase tracking-wider mb-1.5">
                Deckkraft ({Math.round(localSettings.opacity * 100)}%)
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={localSettings.opacity}
                onChange={(e) =>
                  updateField("opacity", parseFloat(e.target.value))
                }
                className="w-full accent-accent-blue"
              />
            </div>
          </div>
        </section>

        {/* Grouping / Nesting */}
        <section className="bg-bg-secondary/50 rounded-xl p-5 border border-border-subtle/50">
          <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
            <Move className="w-4 h-4 text-accent-purple" /> Gruppierung &
            Schachtelung
          </h3>
          <p className="text-[10px] text-gray-500 mb-4 leading-relaxed">
            Ermöglicht "gemischte" Layouts: Wähle ein Element, das außen steht.
            Die anderen beiden bilden eine Gruppe.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] text-gray-400 uppercase tracking-wider mb-1.5">
                Außenelement
              </label>
              <select
                value={localSettings.outer_element}
                onChange={(e) => updateField("outer_element", e.target.value)}
                className="w-full bg-bg-primary border border-border-subtle rounded-lg px-3 py-2 text-sm text-white outline-none"
              >
                <option value="none">Alle gleichberechtigt</option>
                <option value="sprite">Pokémon Sprite</option>
                <option value="name">Pokémon Name</option>
                <option value="counter">Begegnungszahl</option>
              </select>
            </div>
            {localSettings.outer_element !== "none" && (
              <div>
                <label className="block text-[10px] text-gray-400 uppercase tracking-wider mb-1.5">
                  Innere Ausrichtung
                </label>
                <select
                  value={localSettings.inner_layout}
                  onChange={(e) => updateField("inner_layout", e.target.value)}
                  className="w-full bg-bg-primary border border-border-subtle rounded-lg px-3 py-2 text-sm text-white outline-none"
                >
                  <option value="horizontal">Horizontal</option>
                  <option value="vertical">Vertikal</option>
                </select>
              </div>
            )}
          </div>
        </section>

        {/* Layer Management */}
        <section className="bg-bg-secondary/50 rounded-xl p-5 border border-border-subtle/50">
          <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
            <Move className="w-4 h-4 text-accent-purple" /> Ebenen & Reihenfolge
          </h3>
          <div className="space-y-2">
            {(localSettings.layer_order || ["sprite", "name", "counter"]).map(
              (type, idx) => (
                <div
                  key={type}
                  className="flex items-center justify-between p-3 bg-bg-primary rounded-lg border border-border-subtle"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-bold text-gray-600 w-4">
                      {idx + 1}
                    </span>
                    <span className="text-xs font-bold uppercase tracking-wider text-white">
                      {type === "sprite"
                        ? "Pokémon Sprite"
                        : type === "name"
                          ? "Pokémon Name"
                          : "Zähler / Zahl"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() =>
                        updateField(
                          type === "sprite"
                            ? "sprite_position"
                            : type === "name"
                              ? "show_name"
                              : "show_encounter",
                          type === "sprite"
                            ? localSettings.sprite_position === "hidden"
                              ? "left"
                              : "hidden"
                            : !(localSettings as any)[
                                type === "name" ? "show_name" : "show_encounter"
                              ],
                        )
                      }
                      className="p-1 px-2 rounded hover:bg-white/5 transition-colors"
                    >
                      {(
                        type === "sprite"
                          ? localSettings.sprite_position !== "hidden"
                          : (localSettings as any)[
                              type === "name" ? "show_name" : "show_encounter"
                            ]
                      ) ? (
                        <Eye className="w-3.5 h-3.5 text-accent-blue" />
                      ) : (
                        <EyeOff className="w-3.5 h-3.5 text-gray-600" />
                      )}
                    </button>
                    <button
                      onClick={() => moveLayer(idx, "up")}
                      disabled={idx === 0}
                      className="p-1.5 rounded hover:bg-white/5 disabled:opacity-30"
                    >
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => moveLayer(idx, "down")}
                      disabled={idx === 2}
                      className="p-1.5 rounded hover:bg-white/5 disabled:opacity-30"
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ),
            )}
          </div>
        </section>

        {/* Sprite Styling */}
        <section className="bg-bg-secondary/50 rounded-xl p-5 border border-border-subtle/50">
          <h4 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-accent-yellow" /> Sprite
            Einstellungen
          </h4>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block text-[10px] text-gray-400 uppercase tracking-wider mb-1.5">
                Größe ({localSettings.sprite_size}px)
              </label>
              <input
                type="range"
                min="40"
                max="600"
                value={localSettings.sprite_size}
                onChange={(e) =>
                  updateField("sprite_size", parseInt(e.target.value))
                }
                className="w-full h-10 accent-accent-blue"
              />
            </div>
            <div className="flex flex-col gap-2 pt-2">
              <Toggle
                label="Glow Effekt"
                active={localSettings.show_sprite_glow}
                onClick={() =>
                  updateField(
                    "show_sprite_glow",
                    !localSettings.show_sprite_glow,
                  )
                }
              />
              <Toggle
                label="Vordergrund"
                active={localSettings.sprite_on_top}
                onClick={() =>
                  updateField("sprite_on_top", !localSettings.sprite_on_top)
                }
              />
            </div>
          </div>
        </section>

        {/* Name Styling */}
        <StylingSection
          title="Name Einstellungen"
          prefix="name"
          settings={localSettings}
          updateField={updateField}
          fonts={fonts}
        />

        {/* Counter Styling */}
        <StylingSection
          title="Zähler Einstellungen"
          prefix="counter" // Note: we'll handle the actual field mapping inside
          settings={localSettings}
          updateField={updateField}
          fonts={fonts}
        />

        {/* Animations */}
        <section className="bg-bg-secondary/50 rounded-xl p-5 border border-border-subtle/50">
          <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
            <Move className="w-4 h-4 text-accent-blue" /> Animationen
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-[10px] text-gray-400 uppercase tracking-wider mb-1.5">
                Plus (+1)
              </label>
              <select
                value={localSettings.animation_increment}
                onChange={(e) =>
                  updateField("animation_increment", e.target.value)
                }
                className="w-full bg-bg-primary border border-border-subtle rounded-lg px-3 py-2 text-sm text-white"
              >
                <option value="pop">Pop</option>
                <option value="bounce">Bounce</option>
                <option value="flip">Flip</option>
                <option value="pulse">Pulse</option>
                <option value="flash">Flash</option>
                <option value="slide-up">Slide Up</option>
                <option value="rotate">Rotation</option>
                <option value="none">Keine</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-gray-400 uppercase tracking-wider mb-1.5">
                Minus (-1)
              </label>
              <select
                value={localSettings.animation_decrement}
                onChange={(e) =>
                  updateField("animation_decrement", e.target.value)
                }
                className="w-full bg-bg-primary border border-border-subtle rounded-lg px-3 py-2 text-sm text-white"
              >
                <option value="shake">Shake</option>
                <option value="slide-down">Slide Down</option>
                <option value="none">Keine</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-gray-400 uppercase tracking-wider mb-1.5">
                Reset
              </label>
              <select
                value={localSettings.animation_reset}
                onChange={(e) => updateField("animation_reset", e.target.value)}
                className="w-full bg-bg-primary border border-border-subtle rounded-lg px-3 py-2 text-sm text-white"
              >
                <option value="rotate">Rotation</option>
                <option value="pop">Pop</option>
                <option value="flip">Flip</option>
                <option value="none">Keine</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-gray-400 uppercase tracking-wider mb-1.5">
              Ziel
            </label>
            <select
              value={localSettings.animation_target}
              onChange={(e) => updateField("animation_target", e.target.value)}
              className="w-full bg-bg-primary border border-border-subtle rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="both">Beide</option>
              <option value="sprite">Nur Sprite</option>
              <option value="counter">Nur Zahl</option>
            </select>
          </div>
        </section>
      </div>

      {/* Preview Column */}
      <div className="flex flex-col gap-6">
        <div className="sticky top-6 space-y-6">
          <div className="relative aspect-video bg-gray-950 rounded-3xl border-2 border-dashed border-white/5 flex items-center justify-center overflow-hidden shadow-2xl">
            <div className="absolute inset-0 bg-[radial-gradient(#ffffff05_1px,transparent_1px)] [background-size:24px_24px]" />
            <div className="transform scale-[0.6] xl:scale-[0.85] origin-center sharp-preview">
              <Overlay
                previewSettings={localSettings}
                previewPokemon={mockPokemon}
              />
            </div>
          </div>

          {/* Test Actions */}
          <div className="bg-bg-secondary/40 rounded-2xl p-6 border border-border-subtle/50 backdrop-blur-sm shadow-xl">
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
              <Sparkles className="w-3 h-3 text-accent-yellow" /> Test-Suite
            </h4>
            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={() => setPreviewCounter((prev) => prev + 1)}
                className="flex flex-col items-center gap-2 p-3 rounded-xl bg-accent-blue/10 hover:bg-accent-blue/20 border border-accent-blue/20 text-accent-blue transition-all active:scale-95 group"
              >
                <Plus className="w-6 h-6 group-hover:scale-110 transition-transform" />
                <span className="text-[9px] font-bold uppercase tracking-wider">
                  Plus
                </span>
              </button>
              <button
                onClick={() =>
                  setPreviewCounter((prev) => Math.max(0, prev - 1))
                }
                className="flex flex-col items-center gap-2 p-3 rounded-xl bg-accent-yellow/10 hover:bg-accent-yellow/20 border border-accent-yellow/20 text-accent-yellow transition-all active:scale-95 group"
              >
                <Minus className="w-6 h-6 group-hover:scale-110 transition-transform" />
                <span className="text-[9px] font-bold uppercase tracking-wider">
                  Minus
                </span>
              </button>
              <button
                onClick={() => setPreviewCounter(0)}
                className="flex flex-col items-center gap-2 p-3 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-500 transition-all active:scale-95 group"
              >
                <RotateCcw className="w-6 h-6 group-hover:rotate-180 transition-transform duration-500" />
                <span className="text-[9px] font-bold uppercase tracking-wider">
                  Reset
                </span>
              </button>
            </div>
          </div>

          {/* OBS Link */}
          <div className="bg-bg-card border border-border-subtle rounded-2xl p-6 shadow-xl">
            <div className="flex items-center justify-between mb-3 text-[10px] text-gray-400 font-bold uppercase tracking-widest">
              <span>OBS Browser URL</span>
              <button
                onClick={() =>
                  navigator.clipboard.writeText(
                    `${window.location.origin}/overlay`,
                  )
                }
                className="text-accent-blue hover:underline"
              >
                Kopieren
              </button>
            </div>
            <div className="bg-black/20 p-3 rounded-xl border border-white/5 font-mono text-[11px] text-accent-blue/80 break-all">
              {window.location.origin}/overlay
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StylingSection({
  title,
  prefix,
  settings,
  updateField,
  fonts,
}: {
  title: string;
  prefix: "name" | "counter";
  settings: OverlaySettings;
  updateField: any;
  fonts: any[];
}) {
  // Mapping for counter to use existing general fields
  const getF = (f: string) =>
    prefix === "counter"
      ? (f
          .replace("counter_", "")
          .replace("name_", "") as keyof OverlaySettings)
      : (`name_${f}` as keyof OverlaySettings);

  const size = settings[prefix === "counter" ? "font_size" : "name_size"];
  const color = settings[prefix === "counter" ? "text_color" : "name_color"];
  const oColor =
    settings[prefix === "counter" ? "outline_color" : "name_outline_color"];
  const oWidth =
    settings[prefix === "counter" ? "outline_width" : "name_outline_width"];
  const gradEnabled =
    settings[
      prefix === "counter" ? "gradient_enabled" : "name_gradient_enabled"
    ];
  const gradColor =
    settings[prefix === "counter" ? "gradient_color" : "name_gradient_color"];
  const family =
    settings[prefix === "counter" ? "font_family" : "name_font_family"];
  const customFont =
    settings[prefix === "counter" ? "custom_font" : "name_custom_font"];

  return (
    <section className="bg-bg-secondary/50 rounded-xl p-5 border border-border-subtle/50">
      <h4 className="text-sm font-bold text-white mb-4 flex items-center gap-2 uppercase tracking-tight">
        <Palette
          className={`w-4 h-4 ${prefix === "name" ? "text-accent-green" : "text-accent-blue"}`}
        />{" "}
        {title}
      </h4>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] text-gray-400 uppercase tracking-wider mb-1.5">
              Größe ({size}px)
            </label>
            <input
              type="range"
              min="10"
              max="300"
              value={size}
              onChange={(e) =>
                updateField(
                  prefix === "counter" ? "font_size" : "name_size",
                  parseInt(e.target.value),
                )
              }
              className="w-full accent-accent-blue"
            />
          </div>
          <div>
            <label className="block text-[10px] text-gray-400 uppercase tracking-wider mb-1.5">
              Schriftart
            </label>
            <select
              value={family}
              onChange={(e) =>
                updateField(
                  prefix === "counter" ? "font_family" : "name_font_family",
                  e.target.value,
                )
              }
              className="w-full bg-bg-primary border border-border-subtle rounded-lg px-2 py-1.5 text-xs text-white"
            >
              {fonts.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-[10px] text-gray-400 uppercase tracking-wider mb-1.5">
            System-Font
          </label>
          <input
            type="text"
            value={customFont}
            onChange={(e) =>
              updateField(
                prefix === "counter" ? "custom_font" : "name_custom_font",
                e.target.value,
              )
            }
            placeholder="Arial, 'Open Sans'..."
            className="w-full bg-bg-primary border border-border-subtle rounded-lg px-3 py-2 text-xs text-white"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] text-gray-400 uppercase tracking-wider mb-1.5">
              Farbe
            </label>
            <div className="flex gap-2">
              <input
                type="color"
                value={color}
                onChange={(e) =>
                  updateField(
                    prefix === "counter" ? "text_color" : "name_color",
                    e.target.value,
                  )
                }
                className="w-8 h-8 rounded bg-transparent cursor-pointer"
              />
              <input
                type="text"
                value={color}
                onChange={(e) =>
                  updateField(
                    prefix === "counter" ? "text_color" : "name_color",
                    e.target.value,
                  )
                }
                className="flex-1 bg-bg-primary border border-border-subtle rounded-lg px-2 py-1 text-[10px] text-white uppercase"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-gray-400 uppercase tracking-wider mb-1.5">
              Kontur ({oWidth}px)
            </label>
            <input
              type="range"
              min="0"
              max="30"
              value={oWidth}
              onChange={(e) =>
                updateField(
                  prefix === "counter" ? "outline_width" : "name_outline_width",
                  parseInt(e.target.value),
                )
              }
              className="w-full accent-accent-blue"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] text-gray-400 uppercase tracking-wider mb-1.5">
              Kontur Farbe
            </label>
            <input
              type="color"
              value={oColor}
              onChange={(e) =>
                updateField(
                  prefix === "counter" ? "outline_color" : "name_outline_color",
                  e.target.value,
                )
              }
              className="w-full h-8 rounded-lg bg-transparent cursor-pointer"
            />
          </div>
          <div>
            <label className="flex items-center gap-2 cursor-pointer pt-4">
              <input
                type="checkbox"
                checked={gradEnabled}
                onChange={(e) =>
                  updateField(
                    prefix === "counter"
                      ? "gradient_enabled"
                      : "name_gradient_enabled",
                    e.target.checked,
                  )
                }
                className="w-3.5 h-3.5 accent-accent-blue"
              />
              <span className="text-[10px] text-gray-400 uppercase tracking-wider">
                Verlauf
              </span>
            </label>
            {gradEnabled && (
              <input
                type="color"
                value={gradColor}
                onChange={(e) =>
                  updateField(
                    prefix === "counter"
                      ? "gradient_color"
                      : "name_gradient_color",
                    e.target.value,
                  )
                }
                className="w-full h-8 mt-2 rounded bg-transparent cursor-pointer"
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Toggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg border transition-all text-[11px] font-bold ${active ? "bg-accent-blue/10 border-accent-blue text-white" : "bg-bg-primary/50 border-border-subtle text-gray-500 hover:text-gray-400"}`}
    >
      {active ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
      <span className="uppercase tracking-tighter">{label}</span>
    </button>
  );
}
