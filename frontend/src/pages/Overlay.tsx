import { useRef, useEffect, useMemo, useState } from "react";
import { Pokemon, OverlaySettings, TextStyle } from "../types";
import { useCounterStore } from "../hooks/useCounterState";

interface Props {
  previewSettings?: OverlaySettings;
  previewPokemon?: Pokemon;
  testTrigger?: { element: string; n: number };
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

// Slot counter: only digits that change re-mount and animate
function SlotCounter({ value, counterStyle }: { value: number; counterStyle: React.CSSProperties }) {
  const digits = String(value).split("");
  return (
    <span style={{ display: "inline-flex" }}>
      {digits.map((digit, i) => (
        <span
          key={`${i}_${digit}`}
          style={{ display: "inline-block", overflow: "hidden" }}
        >
          <span
            className="font-black tabular-nums leading-none"
            style={{
              display: "block",
              animation: "overlay-slide-up 0.22s ease-out forwards",
              ...counterStyle,
            }}
          >
            {digit}
          </span>
        </span>
      ))}
    </span>
  );
}

// Flip counter: like SlotCounter but uses the flip-clock animation per digit
function FlipCounter({ value, counterStyle }: { value: number; counterStyle: React.CSSProperties }) {
  const digits = String(value).split("");
  return (
    <span style={{ display: "inline-flex" }}>
      {digits.map((digit, i) => (
        <span
          key={`${i}_${digit}`}
          style={{ display: "inline-block", overflow: "hidden" }}
        >
          <span
            className="font-black tabular-nums leading-none"
            style={{
              display: "block",
              animation: "overlay-flip 0.45s ease-in-out forwards",
              transformOrigin: "center",
              ...counterStyle,
            }}
          >
            {digit}
          </span>
        </span>
      ))}
    </span>
  );
}

// Animation maps
const COUNTER_ANIMS: Record<string, string> = {
  pop:        "animate-overlay-pop",
  flash:      "animate-overlay-flash",
  bounce:     "animate-overlay-bounce",
  shake:      "animate-overlay-shake",
  "slide-up": "animate-overlay-slide-up",
  flip:       "animate-overlay-flip",
  rubber:     "animate-overlay-rubber",
  "count-flash": "animate-overlay-flash", // legacy
};

const SPRITE_ANIMS: Record<string, string> = {
  pop:    "animate-overlay-pop",
  bounce: "animate-overlay-bounce",
  shake:  "animate-overlay-shake",
  spin:   "animate-overlay-spin",
  flip:   "animate-overlay-flip",
  rubber: "animate-overlay-rubber",
  flash:  "animate-overlay-flash",
};

const NAME_ANIMS: Record<string, string> = {
  "fade-in":  "animate-overlay-fade-in",
  "slide-in": "animate-overlay-slide-in",
  pop:        "animate-overlay-pop",
  bounce:     "animate-overlay-bounce",
  shake:      "animate-overlay-shake",
  flip:       "animate-overlay-flip",
  rubber:     "animate-overlay-rubber",
};

const SPRITE_IDLE: Record<string, string> = {
  float: "animate-float",
  pulse: "animate-overlay-pulse-idle",
  rock:  "animate-overlay-rock",
  bob:   "animate-overlay-bob",
};

const TEXT_IDLE: Record<string, string> = {
  breathe: "animate-overlay-breathe",
  glow:    "animate-overlay-glow",
};

export function Overlay({ previewSettings, previewPokemon, testTrigger }: Props) {
  const { appState } = useCounterStore();

  // Counter animation
  const [animClass, setAnimClass] = useState("");
  const [triggerId, setTriggerId] = useState(0);
  // Sprite animation
  const [spriteAnimClass, setSpriteAnimClass] = useState("");
  const [spriteTriggerId, setSpriteTriggerId] = useState(0);
  // Name animation
  const [nameAnimClass, setNameAnimClass] = useState("");
  const [nameTriggerId, setNameTriggerId] = useState(0);

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

  // Trigger animations on counter change
  useEffect(() => {
    if (!activePokemon || !settings) return;
    if (prevCount.current !== undefined && activePokemon.encounters !== prevCount.current) {
      const isReset = activePokemon.encounters === 0;
      const isIncrement = activePokemon.encounters > (prevCount.current ?? 0);

      // Counter
      const counterKey = settings.counter.trigger_enter;
      if (counterKey !== "slot" && counterKey !== "flip-digit") {
        const key = isReset ? "rubber" : isIncrement ? counterKey : "shake";
        const cls = COUNTER_ANIMS[key] ?? "";
        if (cls) { setAnimClass(cls); setTriggerId(Date.now()); }
      }

      // Sprite
      const spriteKey = settings.sprite.trigger_enter;
      if (spriteKey && spriteKey !== "none") {
        const cls = SPRITE_ANIMS[spriteKey] ?? "";
        if (cls) { setSpriteAnimClass(cls); setSpriteTriggerId(Date.now()); }
      }

      // Name
      const nameKey = settings.name.trigger_enter;
      if (nameKey && nameKey !== "none") {
        const cls = NAME_ANIMS[nameKey] ?? "";
        if (cls) { setNameAnimClass(cls); setNameTriggerId(Date.now()); }
      }
    }
    prevCount.current = activePokemon.encounters;
  }, [activePokemon?.encounters, settings]);

  // Test trigger from editor
  useEffect(() => {
    if (!testTrigger || !settings) return;
    if (testTrigger.element === "counter") {
      const key = settings.counter.trigger_enter;
      if (key !== "slot" && key !== "flip-digit") {
        const cls = COUNTER_ANIMS[key] ?? "";
        if (cls) { setAnimClass(cls); setTriggerId(Date.now()); }
      }
    } else if (testTrigger.element === "sprite") {
      const cls = SPRITE_ANIMS[settings.sprite.trigger_enter] ?? "";
      if (cls) { setSpriteAnimClass(cls); setSpriteTriggerId(Date.now()); }
    } else if (testTrigger.element === "name") {
      const cls = NAME_ANIMS[settings.name.trigger_enter] ?? "";
      if (cls) { setNameAnimClass(cls); setNameTriggerId(Date.now()); }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testTrigger?.n]);

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

  const counterMode = settings.counter.trigger_enter;

  // Background and content are on separate layers so animated elements
  // can overflow the card without being clipped (e.g. spin, bounce).
  const outerStyle: React.CSSProperties = previewSettings
    ? { position: "absolute", inset: 0 }
    : { position: "relative", width: `${settings.canvas_width}px`, height: `${settings.canvas_height}px` };

  const bgStyle: React.CSSProperties = {
    position: "absolute", inset: 0, pointerEvents: "none",
    backgroundColor: bgWithOpacity,
    backdropFilter: `blur(${settings.blur}px)`,
    borderRadius: `${settings.border_radius}px`,
    border: settings.show_border ? `2px solid ${settings.border_color}` : "none",
    overflow: "hidden",
  };

  const canvas = (
    <div style={outerStyle}>
      {/* Card background — clipped to border-radius, does NOT clip content */}
      <div style={bgStyle} />

      {/* Sprite — outer div holds idle, inner keyed div holds trigger */}
      {settings.sprite.visible && (
        <div
          style={{
            position: "absolute",
            left: settings.sprite.x,
            top: settings.sprite.y,
            width: settings.sprite.width,
            height: settings.sprite.height,
            zIndex: settings.sprite.z_index,
          }}
          className={SPRITE_IDLE[settings.sprite.idle_animation] ?? ""}
        >
          <div
            key={`sprite-${spriteTriggerId}`}
            style={{
              position: "relative",
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transformOrigin: "center",
            }}
            className={spriteAnimClass}
          >
            {settings.sprite.show_glow && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: settings.sprite.glow_color,
                  opacity: settings.sprite.glow_opacity ?? 0.2,
                  borderRadius: "50%",
                  filter: `blur(${settings.sprite.glow_blur ?? 20}px)`,
                }}
              />
            )}
            <img
              src={activePokemon.sprite_url}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "contain", imageRendering: "pixelated", position: "relative", zIndex: 1 }}
            />
          </div>
        </div>
      )}

      {/* Name — outer div holds position + idle (stable, no key), inner span holds trigger (keyed) */}
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
          className={TEXT_IDLE[settings.name.idle_animation] ?? ""}
        >
          <span
            key={`name-${nameTriggerId}`}
            className={`uppercase tracking-widest whitespace-nowrap overflow-hidden text-ellipsis ${nameAnimClass}`}
            style={{ ...nameStyle, display: "inline-block", transformOrigin: "center" }}
          >
            {activePokemon.name}
          </span>
        </div>
      )}

      {/* Counter — outer div holds position + idle (stable, no key), inner span holds trigger (keyed) */}
      {settings.counter.visible && (
        <div
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
          className={counterMode !== "slot" && counterMode !== "flip-digit" ? (TEXT_IDLE[settings.counter.idle_animation] ?? "") : ""}
        >
          {counterMode === "slot" ? (
            <SlotCounter value={activePokemon.encounters} counterStyle={counterStyle} />
          ) : counterMode === "flip-digit" ? (
            <FlipCounter value={activePokemon.encounters} counterStyle={counterStyle} />
          ) : (
            <span
              key={`counter-${triggerId}`}
              className={`font-black tabular-nums leading-none ${animClass}`}
              style={{ ...counterStyle, display: "inline-block", transformOrigin: "center" }}
            >
              {activePokemon.encounters}
            </span>
          )}
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
