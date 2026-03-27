import { useRef, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { Pokemon, OverlaySettings, TextStyle } from "../types";
import { useCounterStore } from "../hooks/useCounterState";
import { resolveOverlay } from "../utils/overlay";
import { SPRITE_FALLBACK } from "../utils/sprites";
import { apiUrl } from "../utils/api";

interface Props {
  previewSettings?: OverlaySettings;
  previewPokemon?: Pokemon;
  testTrigger?: { element: string; n: number; reverse?: boolean };
}

/** State for a single animation channel (counter, sprite, name, title). */
interface AnimChannel {
  animClass: string;
  reverse: boolean;
  triggerId: number;
}

/** Setters for a single animation channel. */
interface AnimChannelSetters {
  setAnimClass: (cls: string) => void;
  setReverse: (rev: boolean) => void;
  setTriggerId: (id: number) => void;
  setRenderMode?: (mode: string) => void;
}

/** All animation channels managed by the overlay. */
interface AnimChannels {
  counter: AnimChannel;
  sprite: AnimChannel;
  name: AnimChannel;
  title: AnimChannel;
}

/** All animation channel setters. */
interface AnimChannelSettersMap {
  counter: AnimChannelSetters;
  sprite: AnimChannelSetters;
  name: AnimChannelSetters;
  title: AnimChannelSetters;
}

/**
 * Triggers an animation on a single channel by looking up the CSS class
 * from the given animation map and updating the channel state.
 */
function triggerAnimation(
  key: string,
  animMap: Record<string, string>,
  reverse: boolean,
  setters: AnimChannelSetters,
): void {
  const cls = animMap[key] ?? "";
  if (cls) {
    setters.setReverse(reverse);
    setters.setAnimClass(cls);
    setters.setTriggerId(Date.now());
  }
}

/**
 * useAnimationTriggers manages the four overlay animation channels
 * (counter, sprite, name, title) and returns their state plus setters.
 */
function useAnimationTriggers(): {
  channels: AnimChannels;
  setters: AnimChannelSettersMap;
  counterRenderMode: string;
  setCounterRenderMode: (mode: string) => void;
} {
  const [animClass, setAnimClass] = useState("");
  const [animReverse, setAnimReverse] = useState(false);
  const [triggerId, setTriggerId] = useState(0);
  const [counterRenderMode, setCounterRenderMode] = useState("");

  const [spriteAnimClass, setSpriteAnimClass] = useState("");
  const [spriteAnimReverse, setSpriteAnimReverse] = useState(false);
  const [spriteTriggerId, setSpriteTriggerId] = useState(0);

  const [nameAnimClass, setNameAnimClass] = useState("");
  const [nameAnimReverse, setNameAnimReverse] = useState(false);
  const [nameTriggerId, setNameTriggerId] = useState(0);

  const [titleAnimClass, setTitleAnimClass] = useState("");
  const [titleAnimReverse, setTitleAnimReverse] = useState(false);
  const [titleTriggerId, setTitleTriggerId] = useState(0);

  return {
    channels: {
      counter: { animClass, reverse: animReverse, triggerId },
      sprite: { animClass: spriteAnimClass, reverse: spriteAnimReverse, triggerId: spriteTriggerId },
      name: { animClass: nameAnimClass, reverse: nameAnimReverse, triggerId: nameTriggerId },
      title: { animClass: titleAnimClass, reverse: titleAnimReverse, triggerId: titleTriggerId },
    },
    setters: {
      counter: { setAnimClass, setReverse: setAnimReverse, setTriggerId, setRenderMode: setCounterRenderMode },
      sprite: { setAnimClass: setSpriteAnimClass, setReverse: setSpriteAnimReverse, setTriggerId: setSpriteTriggerId },
      name: { setAnimClass: setNameAnimClass, setReverse: setNameAnimReverse, setTriggerId: setNameTriggerId },
      title: { setAnimClass: setTitleAnimClass, setReverse: setTitleAnimReverse, setTriggerId: setTitleTriggerId },
    },
    counterRenderMode,
    setCounterRenderMode,
  };
}

// Inject Google Font dynamically
function useGoogleFont(fontFamily: string) {
  useEffect(() => {
    const systemFonts = ["sans", "serif", "monospace", "pokemon"];
    if (!fontFamily || systemFonts.includes(fontFamily)) return;
    const id = `gfont-${fontFamily.replaceAll(/\s+/g, "-")}`;
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
  strokePadding = 0,
}: Readonly<{
  value: number;
  counterStyle: React.CSSProperties;
  reverse?: boolean;
  strokePadding?: number;
}>) {
  const digits = String(value).split("");
  const anim = reverse ? "overlay-slide-down" : "overlay-slide-up";
  return (
    <span style={{ display: "inline-flex" }}>
      {digits.map((digit, i) => (
        <span
          key={`${i}_${digit}`}
          style={{ display: "inline-block", overflow: "hidden", padding: strokePadding, margin: -strokePadding }}
        >
          <span
            className="font-black tabular-nums leading-none"
            style={{
              display: "block",
              animation: `${anim} 0.22s ease-out forwards`,
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
  strokePadding = 0,
}: Readonly<{
  value: number;
  counterStyle: React.CSSProperties;
  reverse?: boolean;
  strokePadding?: number;
}>) {
  const digits = String(value).split("");
  return (
    <span style={{ display: "inline-flex" }}>
      {digits.map((digit, i) => (
        <span
          key={`${i}_${digit}`}
          style={{ display: "inline-block", overflow: "hidden", padding: strokePadding, margin: -strokePadding }}
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

/**
 * Resolves the active Pokemon to display in the overlay, checking
 * preview, URL-targeted, and server-active sources in priority order.
 */
function resolveActivePokemon(
  previewPokemon: Pokemon | undefined,
  appState: { pokemon: Pokemon[]; active_id: string } | null,
  overlayPokemonId: string | null,
): Pokemon | null {
  if (previewPokemon) return previewPokemon;
  if (overlayPokemonId) {
    return appState?.pokemon.find((p) => p.id === overlayPokemonId) ?? null;
  }
  if (!appState) return null;
  return appState.pokemon.find((p) => p.id === appState.active_id) ?? null;
}

/** Renders a placeholder when no active Pokemon is available in the overlay. */
function renderNoDataFallback(isPreview: boolean): React.JSX.Element {
  if (isPreview) {
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

/**
 * Dispatches trigger animation for a single overlay element (sprite, name, title).
 * Only fires when the trigger key is set to a valid animation.
 */
function dispatchElementAnim(
  key: string | undefined,
  animMap: Record<string, string>,
  reverse: boolean,
  channelSetters: AnimChannelSetters,
): void {
  if (key && key !== "none") {
    triggerAnimation(key, animMap, reverse, channelSetters);
  }
}

/**
 * Dispatches the counter animation, with special handling for slot/flip-digit modes
 * which only toggle direction instead of playing a CSS animation.
 */
function dispatchCounterAnim(
  counter: { trigger_enter: string; trigger_decrement: string },
  isIncrement: boolean,
  isDecrement: boolean,
  isReset: boolean,
  channelSetters: AnimChannelSetters,
): void {
  const enterKey = counter.trigger_enter;
  const hasExplicitDecrement = counter.trigger_decrement && counter.trigger_decrement !== "none";

  if (isReset) {
    channelSetters.setRenderMode?.("");
    triggerAnimation("rubber", COUNTER_ANIMS, false, channelSetters);
  } else if (isIncrement) {
    if (enterKey === "slot" || enterKey === "flip-digit") {
      channelSetters.setRenderMode?.(enterKey);
      channelSetters.setReverse(false);
    } else {
      channelSetters.setRenderMode?.("");
      triggerAnimation(enterKey, COUNTER_ANIMS, false, channelSetters);
    }
  } else if (isDecrement) {
    if (hasExplicitDecrement) {
      const dk = counter.trigger_decrement;
      if (dk === "slot" || dk === "flip-digit") {
        channelSetters.setRenderMode?.(dk);
        channelSetters.setReverse(true);
      } else {
        channelSetters.setRenderMode?.("");
        triggerAnimation(dk, COUNTER_ANIMS, true, channelSetters);
      }
    } else if (enterKey === "slot" || enterKey === "flip-digit") {
      channelSetters.setRenderMode?.(enterKey);
      channelSetters.setReverse(true);
    } else {
      channelSetters.setRenderMode?.("");
      triggerAnimation("shake", COUNTER_ANIMS, true, channelSetters);
    }
  }
}

/**
 * Dispatches counter-change animations across all overlay channels
 * (counter, sprite, name, title).
 */
function dispatchCounterAnimations(
  settings: OverlaySettings,
  isIncrement: boolean,
  isDecrement: boolean,
  isReset: boolean,
  allSetters: AnimChannelSettersMap,
): void {
  dispatchCounterAnim(settings.counter, isIncrement, isDecrement, isReset, allSetters.counter);

  const spriteKey = isDecrement && settings.sprite.trigger_decrement && settings.sprite.trigger_decrement !== "none"
    ? settings.sprite.trigger_decrement : settings.sprite.trigger_enter;
  dispatchElementAnim(spriteKey, SPRITE_ANIMS, isDecrement, allSetters.sprite);

  const nameKey = isDecrement && settings.name.trigger_decrement && settings.name.trigger_decrement !== "none"
    ? settings.name.trigger_decrement : settings.name.trigger_enter;
  dispatchElementAnim(nameKey, NAME_ANIMS, isDecrement, allSetters.name);

  if (settings.title) {
    const titleKey = isDecrement && settings.title.trigger_decrement && settings.title.trigger_decrement !== "none"
      ? settings.title.trigger_decrement : settings.title.trigger_enter;
    dispatchElementAnim(titleKey, NAME_ANIMS, isDecrement, allSetters.title);
  }
}

/** Resolves the effective overlay settings for the current Pokemon. */
function resolveSettings(
  previewSettings: OverlaySettings | undefined,
  activePokemon: Pokemon | null,
  appState: { pokemon: Pokemon[]; settings: { overlay: OverlaySettings } } | null,
): OverlaySettings | null {
  if (previewSettings) return previewSettings;
  if (!activePokemon || !appState) return null;
  return resolveOverlay(activePokemon, appState.pokemon, appState.settings.overlay);
}

/** Dispatches a test-trigger animation from the overlay editor preview. */
function dispatchTestTrigger(
  testTrigger: { element: string; reverse?: boolean; n: number },
  settings: OverlaySettings,
  allSetters: AnimChannelSettersMap,
): void {
  const rev = testTrigger.reverse ?? false;
  if (testTrigger.element === "counter") {
    const key = rev
      ? (settings.counter.trigger_decrement && settings.counter.trigger_decrement !== "none" ? settings.counter.trigger_decrement : settings.counter.trigger_enter)
      : settings.counter.trigger_enter;
    if (key === "slot" || key === "flip-digit") {
      allSetters.counter.setRenderMode?.(key);
      allSetters.counter.setReverse(rev);
      allSetters.counter.setTriggerId(Date.now());
    } else {
      allSetters.counter.setRenderMode?.("");
      triggerAnimation(key, COUNTER_ANIMS, rev, allSetters.counter);
    }
  } else if (testTrigger.element === "sprite") {
    const key = rev && settings.sprite.trigger_decrement && settings.sprite.trigger_decrement !== "none"
      ? settings.sprite.trigger_decrement : settings.sprite.trigger_enter;
    triggerAnimation(key, SPRITE_ANIMS, rev, allSetters.sprite);
  } else if (testTrigger.element === "name") {
    const key = rev && settings.name.trigger_decrement && settings.name.trigger_decrement !== "none"
      ? settings.name.trigger_decrement : settings.name.trigger_enter;
    triggerAnimation(key, NAME_ANIMS, rev, allSetters.name);
  } else if (testTrigger.element === "title" && settings.title) {
    const key = rev && settings.title.trigger_decrement && settings.title.trigger_decrement !== "none"
      ? settings.title.trigger_decrement : settings.title.trigger_enter;
    triggerAnimation(key, NAME_ANIMS, rev, allSetters.title);
  }
}

/** Computes all derived CSS styles for the overlay background, text, and layout. */
function buildOverlayStyles(
  settings: OverlaySettings,
  isPreview: boolean,
  crispSprites: boolean,
) {
  const bgHex = settings.background_color.replace("#", "");
  const opacity = Math.round(settings.background_opacity * 255)
    .toString(16)
    .padStart(2, "0");
  const bgWithOpacity = `#${bgHex}${opacity}`;

  const nameStyle = buildTextStyle(settings.name.style);
  const counterStyle = buildTextStyle(settings.counter.style);
  const labelStyle = buildTextStyle(settings.counter.label_style);
  const titleStyle = settings.title ? buildTextStyle(settings.title.style) : {};

  const counterMode = settings.counter.trigger_enter;

  const outerStyle: React.CSSProperties = isPreview
    ? { position: "absolute", inset: 0 }
    : {
        position: "relative",
        width: `${settings.canvas_width}px`,
        height: `${settings.canvas_height}px`,
      };

  const hidden = settings.hidden ?? false;
  const borderWidth = settings.border_width ?? 2;

  const bgAnimKey = settings.background_animation ?? "none";
  const hasBgAnim = bgAnimKey !== "none" && bgAnimKey in BG_ANIM_CLASS;

  const bgStyle: React.CSSProperties = hidden
    ? { position: "absolute", inset: 0, pointerEvents: "none" }
    : {
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        backgroundColor: hasBgAnim ? settings.background_color : bgWithOpacity,
        backdropFilter: `blur(${settings.blur}px)`,
        borderRadius: `${settings.border_radius}px`,
        border: settings.show_border
          ? `${borderWidth}px solid ${settings.border_color}`
          : "none",
        overflow: "hidden",
      };

  const bgImageFit = settings.background_image_fit ?? "cover";
  const bgSizeMap: Record<string, string> = { tile: "auto", stretch: "100% 100%" };
  const bgImageSize = bgSizeMap[bgImageFit] ?? bgImageFit;
  const bgImageUrl = settings.background_image
    ? apiUrl(`/api/backgrounds/${settings.background_image}`)
    : "";
  const bgImageStyle: React.CSSProperties | undefined = settings.background_image
    ? {
        position: "absolute",
        inset: 0,
        backgroundImage: `url(${bgImageUrl})`,
        backgroundSize: bgImageSize,
        backgroundRepeat: bgImageFit === "tile" ? "repeat" : "no-repeat",
        backgroundPosition: "center",
        borderRadius: `${settings.border_radius}px`,
        pointerEvents: "none",
      }
    : undefined;

  return {
    nameStyle, counterStyle, labelStyle, titleStyle, counterMode,
    outerStyle, crispSprites, bgAnimKey, hasBgAnim,
    bgStyle, bgImageStyle,
  };
}

export function Overlay({
  previewSettings,
  previewPokemon,
  testTrigger,
}: Readonly<Props>) {
  const { appState } = useCounterStore();
  const { channels, setters, counterRenderMode } = useAnimationTriggers();

  const prevCount = useRef<number | undefined>(undefined);

  // Path-based route param takes priority, query param as fallback
  const { pokemonId: routePokemonId } = useParams<{ pokemonId?: string }>();
  const searchParams = new URLSearchParams(globalThis.location.search);
  const overlayPokemonId = routePokemonId || searchParams.get("id");

  const activePokemon: Pokemon | null = useMemo(
    () => resolveActivePokemon(previewPokemon, appState, overlayPokemonId),
    [previewPokemon, appState, overlayPokemonId],
  );

  const settings: OverlaySettings | null = useMemo(
    () => resolveSettings(previewSettings, activePokemon, appState),
    [previewSettings, activePokemon, appState],
  );

  // Inject fonts
  useGoogleFont(settings?.name.style.font_family || "sans");
  useGoogleFont(settings?.counter.style.font_family || "sans");
  useGoogleFont(settings?.title?.style.font_family || "sans");

  // Trigger animations on counter change
  useEffect(() => {
    if (!activePokemon || !settings) return;
    if (prevCount.current !== undefined && activePokemon.encounters !== prevCount.current) {
      const isReset = activePokemon.encounters === 0;
      const isIncrement = activePokemon.encounters > (prevCount.current ?? 0);
      dispatchCounterAnimations(settings, isIncrement, !isIncrement && !isReset, isReset, setters);
    }
    prevCount.current = activePokemon.encounters;
  }, [activePokemon?.encounters, settings]);

  // Test trigger from editor
  useEffect(() => {
    if (testTrigger && settings) {
      dispatchTestTrigger(testTrigger, settings, setters);
    }
    // eslint-disable-next-line react-hooks/exhaustive-docs
  }, [testTrigger?.n]);

  if (!activePokemon || !settings) {
    return renderNoDataFallback(!!previewSettings);
  }

  const {
    nameStyle, counterStyle, labelStyle, titleStyle, counterMode: defaultCounterMode,
    outerStyle, crispSprites, bgAnimKey, hasBgAnim,
    bgStyle, bgImageStyle,
  } = buildOverlayStyles(settings, !!previewSettings, appState?.settings.crisp_sprites ?? false);

  // Dynamic counter mode: override when a decrement animation uses a different rendering style
  const counterMode = counterRenderMode || defaultCounterMode;

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
            key={`sprite-${channels.sprite.triggerId}`}
            style={{
              position: "relative",
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transformOrigin: "center",
              animationDirection: channels.sprite.reverse ? "reverse" : undefined,
            }}
            className={channels.sprite.animClass}
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
              src={activePokemon.sprite_url || SPRITE_FALLBACK}
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
      {settings.name.visible && (() => {
          const alignToJustify: Record<string, string> = { center: "center", right: "flex-end" };
          const nameJustifyContent = alignToJustify[settings.name.style.text_align] ?? "flex-start";
          const outlinePadding = settings.name.style.outline_type === "solid" ? settings.name.style.outline_width * 2 + 1 : 0;
          const shadowPadding = settings.name.style.text_shadow ? Math.abs(settings.name.style.text_shadow_x) + settings.name.style.text_shadow_blur : 0;
          const namePadding = Math.max(2, outlinePadding, shadowPadding);

          return (
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
              justifyContent: nameJustifyContent,
              padding: `0 ${namePadding}px`,
              overflow: "visible",
            }}
            className={TEXT_IDLE[settings.name.idle_animation] ?? ""}
          >
            <span
              key={`name-${channels.name.triggerId}`}
              className={`uppercase tracking-widest whitespace-nowrap ${channels.name.animClass}`}
              style={{
                ...nameStyle,
                display: "inline-block",
                transformOrigin: "center",
                animationDirection: channels.name.reverse ? "reverse" : undefined,
              }}
            >
              {activePokemon.name}
            </span>
          </div>
          );
      })()}

      {/* Title — outer div holds position + idle (stable, no key), inner span holds trigger (keyed) */}
      {settings.title?.visible && (activePokemon.title || !!previewSettings) && (() => {
          const alignToJustify: Record<string, string> = { center: "center", right: "flex-end" };
          const titleJustifyContent = alignToJustify[settings.title.style.text_align] ?? "flex-start";
          const outlinePadding = settings.title.style.outline_type === "solid" ? settings.title.style.outline_width * 2 + 1 : 0;
          const shadowPadding = settings.title.style.text_shadow ? Math.abs(settings.title.style.text_shadow_x) + settings.title.style.text_shadow_blur : 0;
          const titlePadding = Math.max(2, outlinePadding, shadowPadding);

          return (
          <div
            style={{
              position: "absolute",
              left: settings.title.x,
              top: settings.title.y,
              width: settings.title.width,
              height: settings.title.height,
              zIndex: settings.title.z_index,
              display: "flex",
              alignItems: "center",
              justifyContent: titleJustifyContent,
              padding: `0 ${titlePadding}px`,
              overflow: "visible",
            }}
            className={TEXT_IDLE[settings.title.idle_animation] ?? ""}
          >
            <span
              key={`title-${channels.title.triggerId}`}
              className={`uppercase tracking-widest whitespace-nowrap ${channels.title.animClass}`}
              style={{
                ...titleStyle,
                display: "inline-block",
                transformOrigin: "center",
                animationDirection: channels.title.reverse ? "reverse" : undefined,
              }}
            >
              {activePokemon.title || "Titel"}
            </span>
          </div>
          );
      })()}

      {/* Counter — outer div holds position + idle (stable, no key), inner span holds trigger (keyed) */}
      {settings.counter.visible && (() => {
          const counterAlignMap: Record<string, string> = { center: "center", right: "flex-end" };
          const counterAlignItems = counterAlignMap[settings.counter.style.text_align] ?? "flex-start";

          return (
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
              alignItems: counterAlignItems,
              justifyContent: "center",
            }}
            className={
              counterMode !== "slot" && counterMode !== "flip-digit"
                ? (TEXT_IDLE[settings.counter.idle_animation] ?? "")
                : ""
            }
          >
            {(() => {
              const counterOutlinePad = settings.counter.style.outline_type === "solid" ? settings.counter.style.outline_width * 2 + 1 : 0;
              const counterShadowPad = settings.counter.style.text_shadow ? Math.abs(settings.counter.style.text_shadow_x) + settings.counter.style.text_shadow_blur : 0;
              const counterStrokePad = Math.max(2, counterOutlinePad, counterShadowPad);

              if (counterMode === "slot") {
                return (
                  <span key={`slot-${channels.counter.triggerId}`}>
                    <SlotCounter
                      value={activePokemon.encounters}
                      counterStyle={counterStyle}
                      reverse={channels.counter.reverse}
                      strokePadding={counterStrokePad}
                    />
                  </span>
                );
              }
              if (counterMode === "flip-digit") {
                return (
                  <span key={`flip-${channels.counter.triggerId}`}>
                    <FlipCounter
                      value={activePokemon.encounters}
                      counterStyle={counterStyle}
                      reverse={channels.counter.reverse}
                      strokePadding={counterStrokePad}
                    />
                  </span>
                );
              }
              return (
                <span
                  key={`counter-${channels.counter.triggerId}`}
                  className={`font-black tabular-nums leading-none ${channels.counter.animClass}`}
                  style={{
                    ...counterStyle,
                    display: "inline-block",
                    transformOrigin: "center",
                    animationDirection: channels.counter.reverse ? "reverse" : undefined,
                  }}
                >
                  {activePokemon.encounters}
                </span>
              );
            })()}
            {settings.counter.show_label && (
              <span style={labelStyle}>{settings.counter.label_text}</span>
            )}
          </div>
          );
      })()}
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
