import { useRef, useEffect, useMemo, useState } from "react";
import { Pokemon, OverlaySettings, TextStyle } from "../types";
import { useCounterStore } from "../hooks/useCounterState";

interface Props {
  previewSettings?: OverlaySettings;
  previewPokemon?: Pokemon;
}

// Inject Google Font dynamically
function useGoogleFont(fontFamily: string) {
  useEffect(() => {
    const systemFonts = ["sans", "serif", "monospace", "pokemon"];
    if (!fontFamily || systemFonts.includes(fontFamily)) return;
    const id = `gfont-${fontFamily.replace(/\s+/g, "-")}`;
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontFamily)}:wght@100;300;400;700;900&display=swap`;
    document.head.appendChild(link);
  }, [fontFamily]);
}

function resolveFont(family: string): string {
  if (family === "pokemon") return "'Press Start 2P', cursive";
  if (family === "sans") return "'Inter', sans-serif";
  if (family === "serif") return "serif";
  if (family === "monospace") return "monospace";
  return `'${family}', sans-serif`;
}

function buildTextStyle(style: TextStyle): React.CSSProperties {
  const css: React.CSSProperties = {
    fontFamily: resolveFont(style.font_family),
    fontSize: `${style.font_size}px`,
    fontWeight: style.font_weight,
    color: style.color,
    WebkitTextStroke: style.outline_type === "solid"
      ? `${style.outline_width}px ${style.outline_color}`
      : undefined,
    paintOrder: style.outline_type === "solid" ? "stroke fill" : undefined,
    textShadow: style.text_shadow
      ? `${style.text_shadow_x}px ${style.text_shadow_y}px ${style.text_shadow_blur}px ${style.text_shadow_color}`
      : undefined,
  } as React.CSSProperties;

  if (style.color_type === "gradient" && style.gradient_stops?.length >= 2) {
    const stops = style.gradient_stops
      .map((s) => `${s.color} ${s.position}%`)
      .join(", ");
    css.background = `linear-gradient(${style.gradient_angle}deg, ${stops})`;
    css.WebkitBackgroundClip = "text";
    css.WebkitTextFillColor = "transparent";
    css.color = undefined;
  }

  return css;
}

const COUNTER_ANIMS: Record<string, string> = {
  pop:        "animate-overlay-pop",
  flash:      "animate-overlay-flash",
  bounce:     "animate-overlay-bounce",
  shake:      "animate-overlay-shake",
  "slide-up": "animate-overlay-slide-up",
  flip:       "animate-overlay-flip",
  rubber:     "animate-overlay-rubber",
  // legacy
  "count-flash": "animate-overlay-flash",
};

export function Overlay({ previewSettings, previewPokemon }: Props) {
  const { appState } = useCounterStore();
  const [animClass, setAnimClass] = useState("");
  const [triggerId, setTriggerId] = useState(0);
  const prevCount = useRef<number | undefined>(undefined);

  const activePokemon: Pokemon | null = useMemo(
    () => previewPokemon || (appState?.pokemon.find((p) => p.id === appState.active_id) ?? null),
    [previewPokemon, appState],
  );

  const settings: OverlaySettings | null = useMemo(
    () => previewSettings || appState?.settings.overlay || null,
    [previewSettings, appState],
  );

  // Inject fonts
  useGoogleFont(settings?.name.style.font_family || "sans");
  useGoogleFont(settings?.counter.style.font_family || "sans");

  // Animation trigger
  useEffect(() => {
    if (!activePokemon || !settings) return;
    if (prevCount.current !== undefined && activePokemon.encounters !== prevCount.current) {
      const key = activePokemon.encounters === 0
        ? "rubber"
        : activePokemon.encounters > prevCount.current
          ? settings.counter.trigger_enter
          : "shake";
      const cls = COUNTER_ANIMS[key] ?? "";
      if (cls) {
        setAnimClass(cls);
        setTriggerId(Date.now());
      }
    }
    prevCount.current = activePokemon.encounters;
  }, [activePokemon?.encounters, settings]);

  if (!activePokemon || !settings) {
    if (previewSettings) {
      return (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 11, fontFamily: "sans-serif", letterSpacing: "0.2em" }}>
            Kein aktives Pokémon
          </span>
        </div>
      );
    }
    return (
      <div className="overlay-page min-h-screen flex items-center justify-center bg-transparent">
        <div className="text-white/20 text-xs font-bold uppercase tracking-[0.3em] animate-pulse">
          Warten auf Daten...
        </div>
      </div>
    );
  }

  const bgHex = settings.background_color.replace("#", "");
  const opacity = Math.round(settings.background_opacity * 255).toString(16).padStart(2, "0");
  const bgWithOpacity = `#${bgHex}${opacity}`;

  const nameStyle = buildTextStyle(settings.name.style);
  const counterStyle = buildTextStyle(settings.counter.style);
  const labelStyle = buildTextStyle(settings.counter.label_style);

  const canvasStyle: React.CSSProperties = previewSettings
    ? {
        position: "absolute",
        inset: 0,
        backgroundColor: bgWithOpacity,
        backdropFilter: `blur(${settings.blur}px)`,
        borderRadius: `${settings.border_radius}px`,
        border: settings.show_border ? `2px solid ${settings.border_color}` : "none",
        overflow: "hidden",
      }
    : {
        position: "relative",
        width: `${settings.canvas_width}px`,
        height: `${settings.canvas_height}px`,
        backgroundColor: bgWithOpacity,
        backdropFilter: `blur(${settings.blur}px)`,
        borderRadius: `${settings.border_radius}px`,
        border: settings.show_border ? `2px solid ${settings.border_color}` : "none",
        overflow: "hidden",
      };

  const canvas = (
    <div style={canvasStyle}>
        {/* Sprite */}
        {settings.sprite.visible && (
          <div
            style={{
              position: "absolute",
              left: settings.sprite.x,
              top: settings.sprite.y,
              width: settings.sprite.width,
              height: settings.sprite.height,
              zIndex: settings.sprite.z_index,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            className={`${settings.sprite.idle_animation === "float" ? "animate-float" : ""}`}
          >
            {settings.sprite.show_glow && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: settings.sprite.glow_color,
                  borderRadius: "50%",
                  filter: "blur(20px)",
                }}
              />
            )}
            <img
              src={activePokemon.sprite_url}
              alt={activePokemon.name}
              style={{ width: "100%", height: "100%", objectFit: "contain", imageRendering: "pixelated", position: "relative", zIndex: 1 }}
            />
          </div>
        )}

        {/* Name */}
        {settings.name.visible && (
          <div
            style={{
              position: "absolute",
              left: settings.name.x,
              top: settings.name.y,
              width: settings.name.width,
              height: settings.name.height,
              zIndex: settings.name.z_index,
              display: "flex",
              alignItems: "center",
            }}
          >
            <span
              className="uppercase tracking-widest whitespace-nowrap overflow-hidden text-ellipsis"
              style={nameStyle}
            >
              {activePokemon.name}
            </span>
          </div>
        )}

        {/* Counter */}
        {settings.counter.visible && (
          <div
            key={`counter-${triggerId}`}
            style={{
              position: "absolute",
              left: settings.counter.x,
              top: settings.counter.y,
              width: settings.counter.width,
              height: settings.counter.height,
              zIndex: settings.counter.z_index,
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              justifyContent: "center",
            }}
          >
            <span
              className={`font-black tabular-nums leading-none ${animClass}`}
              style={{ ...counterStyle, display: "inline-block", transformOrigin: "center" }}
            >
              {activePokemon.encounters}
            </span>
            {settings.counter.show_label && (
              <span style={labelStyle}>{settings.counter.label_text}</span>
            )}
          </div>
        )}
    </div>
  );

  if (previewSettings) return canvas;

  return (
    <div className="overlay-page min-h-screen flex items-center justify-center bg-transparent">
      {canvas}
    </div>
  );
}
