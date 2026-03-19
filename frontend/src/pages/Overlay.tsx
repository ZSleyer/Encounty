import { useRef, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { Pokemon, OverlaySettings, TextStyle } from "../types";
import { useCounterStore } from "../hooks/useCounterState";
import { resolveOverlay } from "../utils/overlay";

interface Props {
  previewSettings?: OverlaySettings;
  previewPokemon?: Pokemon;
  testTrigger?: { element: string; n: number; reverse?: boolean };
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
  const hasSolidOutline = style.outline_type === "solid";

  // Double width because fill covers the inner half via paint-order: stroke fill
  const effectiveOutlineWidth = style.outline_width * 2;

  // For gradient shadows, fall back to the first gradient stop color
  const shadowColor =
    style.text_shadow_color_type === "gradient" &&
    style.text_shadow_gradient_stops?.length
      ? style.text_shadow_gradient_stops[0].color
      : style.text_shadow_color;

  const css: React.CSSProperties = {
    fontFamily: resolveFont(style.font_family),
    fontSize: `${style.font_size}px`,
    fontWeight: style.font_weight,
    textAlign: (style.text_align || "left") as React.CSSProperties["textAlign"],
    color: style.color,
    WebkitTextStroke: hasSolidOutline
      ? `${effectiveOutlineWidth}px ${style.outline_color}`
      : undefined,
    paintOrder: hasSolidOutline ? "stroke fill" : undefined,
    textShadow: style.text_shadow
      ? `${style.text_shadow_x}px ${style.text_shadow_y}px ${style.text_shadow_blur}px ${shadowColor}`
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
function SlotCounter({
  value,
  counterStyle,
  reverse,
}: {
  value: number;
  counterStyle: React.CSSProperties;
  reverse?: boolean;
}) {
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
              animationDirection: reverse ? "reverse" : "normal",
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
function FlipCounter({
  value,
  counterStyle,
  reverse,
}: {
  value: number;
  counterStyle: React.CSSProperties;
  reverse?: boolean;
}) {
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
              animationDirection: reverse ? "reverse" : "normal",
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
  pop: "animate-overlay-pop",
  flash: "animate-overlay-flash",
  bounce: "animate-overlay-bounce",
  shake: "animate-overlay-shake",
  "slide-up": "animate-overlay-slide-up",
  flip: "animate-overlay-flip",
  rubber: "animate-overlay-rubber",
  "count-flash": "animate-overlay-flash", // legacy
  jello: "animate-overlay-jello",
  tada: "animate-overlay-tada",
  "zoom-in": "animate-overlay-zoom-in",
};

const SPRITE_ANIMS: Record<string, string> = {
  pop: "animate-overlay-pop",
  bounce: "animate-overlay-bounce",
  shake: "animate-overlay-shake",
  spin: "animate-overlay-spin",
  flip: "animate-overlay-flip",
  rubber: "animate-overlay-rubber",
  flash: "animate-overlay-flash",
  jello: "animate-overlay-jello",
  tada: "animate-overlay-tada",
  swing: "animate-overlay-swing",
};

const NAME_ANIMS: Record<string, string> = {
  "fade-in": "animate-overlay-fade-in",
  "slide-in": "animate-overlay-slide-in",
  pop: "animate-overlay-pop",
  bounce: "animate-overlay-bounce",
  shake: "animate-overlay-shake",
  flip: "animate-overlay-flip",
  rubber: "animate-overlay-rubber",
  jello: "animate-overlay-jello",
  tada: "animate-overlay-tada",
  "zoom-in": "animate-overlay-zoom-in",
};

const SPRITE_IDLE: Record<string, string> = {
  float: "animate-float",
  pulse: "animate-overlay-pulse-idle",
  rock: "animate-overlay-rock",
  bob: "animate-overlay-bob",
  wiggle: "animate-overlay-wiggle",
  shimmer: "animate-overlay-shimmer-idle",
};

const TEXT_IDLE: Record<string, string> = {
  breathe: "animate-overlay-breathe",
  glow: "animate-overlay-glow",
  shimmer: "animate-overlay-text-shimmer",
  float: "animate-overlay-text-float",
};

const BG_ANIM_CLASS: Record<string, string> = {
  waves: "canvas-waves",
  "gradient-shift": "canvas-gradient-shift",
  "pulse-bg": "canvas-pulse-bg",
  "shimmer-bg": "canvas-shimmer-bg",
  particles: "canvas-particles",
};

const BG_ANIM_DEFAULT_DURATION: Record<string, number> = {
  waves: 30,
  "gradient-shift": 8,
  "pulse-bg": 3,
  "shimmer-bg": 3,
  particles: 12,
};

export function Overlay({
  previewSettings,
  previewPokemon,
  testTrigger,
}: Props) {
  const { appState } = useCounterStore();

  // Counter animation
  const [animClass, setAnimClass] = useState("");
  const [animReverse, setAnimReverse] = useState(false);
  const [triggerId, setTriggerId] = useState(0);
  // Sprite animation
  const [spriteAnimClass, setSpriteAnimClass] = useState("");
  const [spriteAnimReverse, setSpriteAnimReverse] = useState(false);
  const [spriteTriggerId, setSpriteTriggerId] = useState(0);
  // Name animation
  const [nameAnimClass, setNameAnimClass] = useState("");
  const [nameAnimReverse, setNameAnimReverse] = useState(false);
  const [nameTriggerId, setNameTriggerId] = useState(0);

  const prevCount = useRef<number | undefined>(undefined);

  // Path-based route param takes priority, query param as fallback
  const { pokemonId: routePokemonId } = useParams<{ pokemonId?: string }>();
  const searchParams = new URLSearchParams(window.location.search);
  const overlayPokemonId = routePokemonId || searchParams.get("id");

  const activePokemon: Pokemon | null = useMemo(
    () =>
      previewPokemon ||
      (overlayPokemonId
        ? appState?.pokemon.find((p) => p.id === overlayPokemonId)
        : null) ||
      (appState?.pokemon.find((p) => p.id === appState.active_id) ?? null),
    [previewPokemon, appState, overlayPokemonId],
  );

  const settings: OverlaySettings | null = useMemo(() => {
    if (previewSettings) return previewSettings;
    if (!activePokemon || !appState) return null;
    return resolveOverlay(
      activePokemon,
      appState.pokemon,
      appState.settings.overlay,
    );
  }, [previewSettings, activePokemon, appState]);

  // Inject fonts
  useGoogleFont(settings?.name.style.font_family || "sans");
  useGoogleFont(settings?.counter.style.font_family || "sans");

  // Trigger animations on counter change
  useEffect(() => {
    if (!activePokemon || !settings) return;
    if (
      prevCount.current !== undefined &&
      activePokemon.encounters !== prevCount.current
    ) {
      const isReset = activePokemon.encounters === 0;
      const isIncrement = activePokemon.encounters > (prevCount.current ?? 0);
      const isDecrement = !isIncrement && !isReset;

      // Counter
      const counterKey = settings.counter.trigger_enter;
      if (counterKey !== "slot" && counterKey !== "flip-digit") {
        const key = isReset ? "rubber" : isIncrement ? counterKey : "shake";
        const cls = COUNTER_ANIMS[key] ?? "";
        if (cls) {
          setAnimReverse(isDecrement);
          setAnimClass(cls);
          setTriggerId(Date.now());
        }
      } else {
        // slot / flip-digit: just toggle reverse so digits re-key with right direction
        setAnimReverse(isDecrement);
      }

      // Sprite
      const spriteKey = settings.sprite.trigger_enter;
      if (spriteKey && spriteKey !== "none") {
        const cls = SPRITE_ANIMS[spriteKey] ?? "";
        if (cls) {
          setSpriteAnimReverse(isDecrement);
          setSpriteAnimClass(cls);
          setSpriteTriggerId(Date.now());
        }
      }

      // Name
      const nameKey = settings.name.trigger_enter;
      if (nameKey && nameKey !== "none") {
        const cls = NAME_ANIMS[nameKey] ?? "";
        if (cls) {
          setNameAnimReverse(isDecrement);
          setNameAnimClass(cls);
          setNameTriggerId(Date.now());
        }
      }
    }
    prevCount.current = activePokemon.encounters;
  }, [activePokemon?.encounters, settings]);

  // Test trigger from editor
  useEffect(() => {
    if (!testTrigger || !settings) return;
    const rev = testTrigger.reverse ?? false;
    if (testTrigger.element === "counter") {
      const key = settings.counter.trigger_enter;
      if (key !== "slot" && key !== "flip-digit") {
        const cls = COUNTER_ANIMS[key] ?? "";
        if (cls) {
          setAnimReverse(rev);
          setAnimClass(cls);
          setTriggerId(Date.now());
        }
      } else {
        setAnimReverse(rev);
        setTriggerId(Date.now());
      }
    } else if (testTrigger.element === "sprite") {
      const cls = SPRITE_ANIMS[settings.sprite.trigger_enter] ?? "";
      if (cls) {
        setSpriteAnimReverse(rev);
        setSpriteAnimClass(cls);
        setSpriteTriggerId(Date.now());
      }
    } else if (testTrigger.element === "name") {
      const cls = NAME_ANIMS[settings.name.trigger_enter] ?? "";
      if (cls) {
        setNameAnimReverse(rev);
        setNameAnimClass(cls);
        setNameTriggerId(Date.now());
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testTrigger?.n]);

  if (!activePokemon || !settings) {
    if (previewSettings) {
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span
            style={{
              color: "rgba(255,255,255,0.3)",
              fontSize: 11,
              fontFamily: "sans-serif",
              letterSpacing: "0.2em",
            }}
          >
            Kein aktives Pokémon
          </span>
        </div>
      );
    }
    return (
      <div className="overlay-page min-h-screen flex items-center justify-center bg-transparent overflow-hidden relative">
        <div className="text-white/20 text-xs font-bold uppercase tracking-[0.3em] animate-pulse relative z-10">
          Warten auf Daten...
        </div>
      </div>
    );
  }

  const bgHex = settings.background_color.replace("#", "");
  const opacity = Math.round(settings.background_opacity * 255)
    .toString(16)
    .padStart(2, "0");
  const bgWithOpacity = `#${bgHex}${opacity}`;

  const nameStyle = buildTextStyle(settings.name.style);
  const counterStyle = buildTextStyle(settings.counter.style);
  const labelStyle = buildTextStyle(settings.counter.label_style);

  const counterMode = settings.counter.trigger_enter;

  // Background and content are on separate layers so animated elements
  // can overflow the card without being clipped (e.g. spin, bounce).
  const outerStyle: React.CSSProperties = previewSettings
    ? { position: "absolute", inset: 0 }
    : {
        position: "relative",
        width: `${settings.canvas_width}px`,
        height: `${settings.canvas_height}px`,
      };

  const hidden = settings.hidden ?? false;
  const borderWidth = settings.border_width ?? 2;
  const crispSprites = appState?.settings.crisp_sprites ?? false;

  const bgAnimKey = settings.background_animation ?? "none";
  const hasBgAnim = bgAnimKey !== "none" && bgAnimKey in BG_ANIM_CLASS;

  const bgStyle: React.CSSProperties = hidden
    ? { position: "absolute", inset: 0, pointerEvents: "none" }
    : {
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        // When animation is active, use solid background_color as base
        backgroundColor: hasBgAnim ? settings.background_color : bgWithOpacity,
        backdropFilter: `blur(${settings.blur}px)`,
        borderRadius: `${settings.border_radius}px`,
        border: settings.show_border
          ? `${borderWidth}px solid ${settings.border_color}`
          : "none",
        overflow: "hidden",
      };

  const bgImageFit = settings.background_image_fit ?? "cover";
  const bgImageStyle: React.CSSProperties | undefined = settings.background_image
    ? {
        position: "absolute",
        inset: 0,
        backgroundImage: `url(/api/backgrounds/${settings.background_image})`,
        backgroundSize: bgImageFit === "tile" ? "auto" : bgImageFit === "stretch" ? "100% 100%" : bgImageFit,
        backgroundRepeat: bgImageFit === "tile" ? "repeat" : "no-repeat",
        backgroundPosition: "center",
        borderRadius: `${settings.border_radius}px`,
        pointerEvents: "none",
      }
    : undefined;

  const canvas = (
    <div style={outerStyle}>
      {/* Card background — clipped to border-radius, does NOT clip content */}
      <div style={bgStyle}>
        {bgImageStyle && <div style={bgImageStyle} />}
        {hasBgAnim && (
          <div
            className={BG_ANIM_CLASS[bgAnimKey]}
            style={
              settings.background_animation_speed && settings.background_animation_speed !== 1
                ? { animationDuration: `${(BG_ANIM_DEFAULT_DURATION[bgAnimKey] ?? 8) / settings.background_animation_speed}s` }
                : undefined
            }
          />
        )}
      </div>

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
              animationDirection: spriteAnimReverse ? "reverse" : undefined,
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
              className="pokemon-sprite"
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
                position: "relative",
                zIndex: 1,
                imageRendering: crispSprites ? "pixelated" : undefined,
              }}
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
              justifyContent: settings.name.style.text_align === "center" ? "center" : settings.name.style.text_align === "right" ? "flex-end" : "flex-start",
              padding: `0 ${Math.max(2, settings.name.style.outline_type === "solid" ? settings.name.style.outline_width * 2 + 1 : 0, settings.name.style.text_shadow ? Math.abs(settings.name.style.text_shadow_x) + settings.name.style.text_shadow_blur : 0)}px`,
              overflow: "visible",
            }}
            className={TEXT_IDLE[settings.name.idle_animation] ?? ""}
          >
            <span
              key={`name-${nameTriggerId}`}
              className={`uppercase tracking-widest whitespace-nowrap ${nameAnimClass}`}
              style={{
                ...nameStyle,
                display: "inline-block",
                transformOrigin: "center",
                animationDirection: nameAnimReverse ? "reverse" : undefined,
              }}
            >
              {(() => {
                const mode = settings.name.display_mode || "name";
                const title = activePokemon.title || "";
                if (mode === "title" && title) return title;
                if (mode === "both" && title) return `${activePokemon.name} — ${title}`;
                return activePokemon.name;
              })()}
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
              alignItems: settings.counter.style.text_align === "center" ? "center" : settings.counter.style.text_align === "right" ? "flex-end" : "flex-start",
              justifyContent: "center",
            }}
            className={
              counterMode !== "slot" && counterMode !== "flip-digit"
                ? (TEXT_IDLE[settings.counter.idle_animation] ?? "")
                : ""
            }
          >
            {counterMode === "slot" ? (
              <SlotCounter
                value={activePokemon.encounters}
                counterStyle={counterStyle}
                reverse={animReverse}
              />
            ) : counterMode === "flip-digit" ? (
              <FlipCounter
                value={activePokemon.encounters}
                counterStyle={counterStyle}
                reverse={animReverse}
              />
            ) : (
              <span
                key={`counter-${triggerId}`}
                className={`font-black tabular-nums leading-none ${animClass}`}
                style={{
                  ...counterStyle,
                  display: "inline-block",
                  transformOrigin: "center",
                  animationDirection: animReverse ? "reverse" : undefined,
                }}
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
    <div className="overlay-page w-screen h-screen bg-transparent absolute top-0 left-0 overflow-hidden">
      <style>{`
        html, body, #root {
          width: 100vw !important;
          height: 100vh !important;
          margin: 0 !important;
          padding: 0 !important;
          overflow: hidden !important;
          background-color: transparent !important;
        }
      `}</style>
      {canvas}
    </div>
  );
}
