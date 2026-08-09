import { useRef, useEffect, useMemo, useState, useReducer } from "react";
import { useParams } from "react-router";
import { Pokemon, OverlaySettings, TextStyle, LabeledTextElement } from "../types";
import { useCounterStore } from "../hooks/useCounterState";
import { resolveOverlay } from "../utils/overlay";
import {
  buildBaseTextStyle,
  buildFillPaint,
  buildOutlinePaint,
  effectiveOutlineWidth,
  outlinePadding,
  textDecorationPadding,
} from "../utils/textStyle";
import {
  cachedSpriteSrc,
  getBoxSpriteUrl,
  resolveSpriteSrc,
  SPRITE_FALLBACK,
  type SpriteType,
} from "../utils/sprites";
import { apiUrl } from "../utils/api";
import { formatTimer, computeTimerMs } from "../utils/timer";
import { computeOddsDisplay } from "../utils/odds";
import { computePhaseStats, PhaseStats } from "../utils/phase";
import { isGoogleFont } from "../utils/fonts";

interface Props {
  previewSettings?: OverlaySettings;
  previewPokemon?: Pokemon;
  /**
   * Snapshot the phase totals are derived from while previewing in the editor.
   * Live overlays read the same list from the counter store instead.
   */
  previewPokemonList?: Pokemon[];
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
  odds: AnimChannel;
  phase: AnimChannel;
  total_counter: AnimChannel;
}

/** All animation channel setters. */
interface AnimChannelSettersMap {
  counter: AnimChannelSetters;
  sprite: AnimChannelSetters;
  name: AnimChannelSetters;
  title: AnimChannelSetters;
  odds: AnimChannelSetters;
  phase: AnimChannelSetters;
  total_counter: AnimChannelSetters;
}

/** State and setters of one animation channel. */
interface AnimChannelHandle {
  channel: AnimChannel;
  setters: AnimChannelSetters;
}

/**
 * useAnimChannel holds the state of a single animation channel. Bundling the
 * three pieces here keeps the channel list below readable now that the overlay
 * drives seven of them.
 */
function useAnimChannel(): AnimChannelHandle {
  const [animClass, setAnimClass] = useState("");
  const [reverse, setReverse] = useState(false);
  const [triggerId, setTriggerId] = useState(0);
  return {
    channel: { animClass, reverse, triggerId },
    setters: { setAnimClass, setReverse, setTriggerId },
  };
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
 * useAnimationTriggers manages the overlay animation channels (counter, sprite,
 * name, title, odds, phase, total_counter) and returns their state plus
 * setters. total_timer has no channel: like timer it only runs an idle
 * animation.
 */
function useAnimationTriggers(): {
  channels: AnimChannels;
  setters: AnimChannelSettersMap;
  counterRenderMode: string;
  setCounterRenderMode: (mode: string) => void;
} {
  const counter = useAnimChannel();
  const sprite = useAnimChannel();
  const name = useAnimChannel();
  const title = useAnimChannel();
  const odds = useAnimChannel();
  const phase = useAnimChannel();
  const totalCounter = useAnimChannel();
  const [counterRenderMode, setCounterRenderMode] = useState("");

  return {
    channels: {
      counter: counter.channel,
      sprite: sprite.channel,
      name: name.channel,
      title: title.channel,
      odds: odds.channel,
      phase: phase.channel,
      total_counter: totalCounter.channel,
    },
    setters: {
      counter: { ...counter.setters, setRenderMode: setCounterRenderMode },
      sprite: sprite.setters,
      name: name.setters,
      title: title.setters,
      odds: odds.setters,
      phase: phase.setters,
      total_counter: totalCounter.setters,
    },
    counterRenderMode,
    setCounterRenderMode,
  };
}

/**
 * useGoogleFont injects the stylesheet of a curated Google font.
 *
 * Only the curated families exist on fonts.googleapis.com. Anything else, an
 * engine alias or a family the user picked from their own machine, resolves
 * locally, so requesting it from Google would only produce a failed request for
 * a font that is already there.
 */
function useGoogleFont(fontFamily: string) {
  useEffect(() => {
    if (!isGoogleFont(fontFamily)) return;
    const id = `gfont-${fontFamily.replaceAll(/\s+/g, "-")}`;
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontFamily)}:wght@100;300;400;700;900&display=swap`;
    document.head.appendChild(link);
  }, [fontFamily]);
}

/** Props of the layered text renderer. */
interface StyledTextProps {
  /** Style model the layers are derived from. */
  style: TextStyle;
  /** Classes of the outer element, carrying the trigger animation. */
  className?: string;
  /** Extra CSS for the outer element (display, animation, white-space). */
  outerStyle?: React.CSSProperties;
  children: React.ReactNode;
}

/**
 * StyledText renders one text element, stroke and fill as two stacked layers.
 *
 * A single span cannot carry both: `background-clip: text` paints the gradient
 * below the glyph, and the fill has to be transparent for the gradient to show,
 * so an opaque stroke on the same span covers the gradient completely. The
 * stroke therefore gets its own layer underneath, and the fill is painted on top
 * of it at the same origin.
 *
 * Without an outline the element stays a single span, so the common case keeps
 * exactly the DOM and CSS it had before.
 */
function StyledText({
  style,
  className,
  outerStyle,
  children,
}: Readonly<StyledTextProps>) {
  const base = buildBaseTextStyle(style);
  const fill = buildFillPaint(style);
  const width = effectiveOutlineWidth(style);

  if (width === 0) {
    return (
      <span className={className} style={{ ...base, ...fill, ...outerStyle }}>
        {children}
      </span>
    );
  }

  // Padding reserves the room the stroke needs outside the glyph box, the
  // matching negative margin takes it back out of the layout so the glyph does
  // not shift. Ancestors that clip therefore cut at the ink, not into it.
  const pad = outlinePadding(style);

  return (
    <span
      className={className}
      style={{
        display: "inline-block",
        ...outerStyle,
        position: "relative",
        padding: pad,
        margin: -pad,
      }}
    >
      <span
        className="overlay-text-stroke"
        style={{ ...base, ...buildOutlinePaint(style, width), display: "block" }}
      >
        {children}
      </span>
      {/* The same text twice would be announced twice, so the stroke layer is
          the only one left in the accessibility tree. */}
      <span
        aria-hidden="true"
        className="overlay-text-fill"
        style={{
          ...base,
          ...fill,
          // The shadow belongs to the widest silhouette, which is the stroke
          // layer. Repeating it here would darken it a second time.
          textShadow: undefined,
          position: "absolute",
          left: pad,
          top: pad,
          right: pad,
        }}
      >
        {children}
      </span>
    </span>
  );
}

/**
 * TextLabel renders the optional label of a text element. Overlays saved before
 * an element had a label style carry none, and those labels keep rendering
 * unstyled instead of crashing on a missing style.
 */
function TextLabel({
  style,
  text,
}: Readonly<{ style?: TextStyle; text: string }>) {
  if (!style) return <span>{text}</span>;
  return <StyledText style={style}>{text}</StyledText>;
}

/**
 * CounterAffix renders the counter prefix or suffix in the counter's own text
 * style, so the digit-animation modes keep the affixes that the plain counter
 * span renders inline. An empty string renders nothing.
 */
function CounterAffix({
  text,
  counterStyle,
}: Readonly<{ text: string; counterStyle: TextStyle }>) {
  if (!text) return null;
  return (
    <StyledText
      style={counterStyle}
      className="font-black leading-none"
      // pre keeps the spacing the user typed: a prefix like "Encounters: " ends
      // in a space that HTML would otherwise collapse away against the digits.
      outerStyle={{ display: "inline-block", whiteSpace: "pre" }}
    >
      {text}
    </StyledText>
  );
}

// Slot counter: only digits that change re-mount and animate
function SlotCounter({
  value,
  counterStyle,
  reverse,
  strokePadding = 0,
}: Readonly<{
  value: number;
  counterStyle: TextStyle;
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
          <StyledText
            style={counterStyle}
            className="font-black tabular-nums leading-none"
            outerStyle={{
              display: "block",
              animation: `${anim} 0.22s ease-out forwards`,
            }}
          >
            {digit}
          </StyledText>
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
  counterStyle: TextStyle;
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
          <StyledText
            style={counterStyle}
            className="font-black tabular-nums leading-none"
            outerStyle={{
              display: "block",
              animation: "overlay-flip 0.45s ease-in-out forwards",
              animationDirection: reverse ? "reverse" : "normal",
              transformOrigin: "center",
            }}
          >
            {digit}
          </StyledText>
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

// Phase and total_counter are numeric text elements, so they accept both the
// counter and the name animation vocabulary; merging avoids a lookup miss no
// matter which of the two lists the property panel offers for them.
const LABELED_TEXT_ANIMS: Record<string, string> = {
  ...COUNTER_ANIMS,
  ...NAME_ANIMS,
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
  "shimmer-bg": "canvas-shimmer-bg",
};

const BG_ANIM_DEFAULT_DURATION: Record<string, number> = {
  waves: 30,
  "gradient-shift": 8,
  "shimmer-bg": 3,
};

/**
 * Own-key lookup for the animation maps. `in` would also match inherited
 * Object.prototype members, so a stored animation key like "constructor" would
 * pass the guard and resolve to a function that ends up in a class name.
 */
function hasOwnKey(map: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(map, key);
}

/**
 * Builds the inline style for a homebrew CSS-based background animation,
 * combining the optional speed override with config-driven CSS variables
 * (color, opacity, gradient stops, etc.) consumed by the matching CSS rule.
 */
function buildHomebrewBgStyle(
  bgAnimKey: string,
  speed: number | undefined,
  cfg: Record<string, unknown>,
): React.CSSProperties {
  const style: React.CSSProperties & Record<string, string> = {};
  if (speed && speed !== 1) {
    const base = hasOwnKey(BG_ANIM_DEFAULT_DURATION, bgAnimKey)
      ? BG_ANIM_DEFAULT_DURATION[bgAnimKey]
      : 8;
    style.animationDuration = `${base / speed}s`;
  }
  if (bgAnimKey === "waves") {
    style["--waves-color"] = (cfg.wavesColor as string) ?? "#ffffff";
    style["--waves-opacity"] = String((cfg.wavesOpacity as number) ?? 0.18);
  } else if (bgAnimKey === "gradient-shift") {
    style["--gradient-c1"] = (cfg.gradientColor1 as string) ?? "#ff6b6b";
    style["--gradient-c2"] = (cfg.gradientColor2 as string) ?? "#feca57";
    style["--gradient-c3"] = (cfg.gradientColor3 as string) ?? "#48dbfb";
    style["--gradient-c4"] = (cfg.gradientColor4 as string) ?? "#ff9ff3";
  } else if (bgAnimKey === "shimmer-bg") {
    style["--shimmer-color"] = (cfg.shimmerColor as string) ?? "#ffffff";
    style["--shimmer-intensity"] = String((cfg.shimmerIntensity as number) ?? 0.12);
  }
  return style;
}

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
 * Dispatches the trigger animation of one labeled phasing text element.
 * Does nothing for elements an older overlay does not carry yet.
 */
function dispatchLabeledTextAnim(
  element: LabeledTextElement | undefined,
  reverse: boolean,
  channelSetters: AnimChannelSetters,
): void {
  if (!element) return;
  const key = resolveTriggerKey(element.trigger_enter, element.trigger_decrement, reverse);
  dispatchElementAnim(key, LABELED_TEXT_ANIMS, reverse, channelSetters);
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

  if (settings.odds) {
    const oddsKey = isDecrement && settings.odds.trigger_decrement && settings.odds.trigger_decrement !== "none"
      ? settings.odds.trigger_decrement : settings.odds.trigger_enter;
    dispatchElementAnim(oddsKey, NAME_ANIMS, isDecrement, allSetters.odds);
  }

  dispatchLabeledTextAnim(settings.phase, isDecrement, allSetters.phase);
  dispatchLabeledTextAnim(settings.total_counter, isDecrement, allSetters.total_counter);
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

/**
 * Resolves which trigger key to use, preferring the decrement trigger on
 * reverse if one is configured, otherwise falling back to the enter trigger.
 */
function resolveTriggerKey(
  enterKey: string,
  decrementKey: string | undefined,
  reverse: boolean,
): string {
  if (reverse && decrementKey && decrementKey !== "none") {
    return decrementKey;
  }
  return enterKey;
}

/** Dispatches a test-trigger animation from the overlay editor preview. */
function dispatchTestTrigger(
  testTrigger: { element: string; reverse?: boolean; n: number },
  settings: OverlaySettings,
  allSetters: AnimChannelSettersMap,
): void {
  const rev = testTrigger.reverse ?? false;

  if (testTrigger.element === "counter") {
    const key = resolveTriggerKey(settings.counter.trigger_enter, settings.counter.trigger_decrement, rev);
    if (key === "slot" || key === "flip-digit") {
      allSetters.counter.setRenderMode?.(key);
      allSetters.counter.setReverse(rev);
      allSetters.counter.setTriggerId(Date.now());
    } else {
      allSetters.counter.setRenderMode?.("");
      triggerAnimation(key, COUNTER_ANIMS, rev, allSetters.counter);
    }
  } else if (testTrigger.element === "sprite") {
    const key = resolveTriggerKey(settings.sprite.trigger_enter, settings.sprite.trigger_decrement, rev);
    triggerAnimation(key, SPRITE_ANIMS, rev, allSetters.sprite);
  } else if (testTrigger.element === "name") {
    const key = resolveTriggerKey(settings.name.trigger_enter, settings.name.trigger_decrement, rev);
    triggerAnimation(key, NAME_ANIMS, rev, allSetters.name);
  } else if (testTrigger.element === "title" && settings.title) {
    const key = resolveTriggerKey(settings.title.trigger_enter, settings.title.trigger_decrement, rev);
    triggerAnimation(key, NAME_ANIMS, rev, allSetters.title);
  } else if (testTrigger.element === "odds" && settings.odds) {
    const key = resolveTriggerKey(settings.odds.trigger_enter, settings.odds.trigger_decrement, rev);
    triggerAnimation(key, NAME_ANIMS, rev, allSetters.odds);
  } else if (testTrigger.element === "phase") {
    dispatchLabeledTextAnim(settings.phase, rev, allSetters.phase);
  } else if (testTrigger.element === "total_counter") {
    dispatchLabeledTextAnim(settings.total_counter, rev, allSetters.total_counter);
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
  // Unknown keys (for example animations removed in a later version but still
  // stored in an old profile) fall back to rendering no animation at all.
  // A hidden canvas drops every background layer: the animation paints from its
  // own color, opacity and keyframes, so clearing the card style is not enough.
  const hasBgAnim = !hidden && hasOwnKey(BG_ANIM_CLASS, bgAnimKey);

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
  const showBgImage = !!settings.background_image && !hidden;
  const bgImageStyle: React.CSSProperties | undefined = showBgImage
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
    counterMode,
    outerStyle, crispSprites, bgAnimKey, hasBgAnim,
    bgStyle, bgImageStyle,
  };
}

/** Props of the shared layer for the phasing text elements. */
interface LabeledTextLayerProps {
  element: LabeledTextElement;
  /** Stable prefix of the keyed value span, e.g. "phase". */
  channelKey: string;
  /** Trigger channel of the element; omitted for idle-only elements. */
  channel?: AnimChannel;
  /** Already formatted value to display. */
  value: string;
}

/**
 * LabeledTextLayer renders one positioned text element with an optional label,
 * following the same structure as the counter and timer layers: the outer box
 * carries position and idle animation, the keyed inner span carries the trigger
 * animation so it replays on every new trigger id.
 *
 * Used only by the phasing elements (phase, total_counter, total_timer); the
 * older layers keep their hand-written markup.
 */
function LabeledTextLayer({
  element,
  channelKey,
  channel,
  value,
}: Readonly<LabeledTextLayerProps>) {
  const alignMap: Record<string, string> = { center: "center", right: "flex-end" };
  const alignItems = alignMap[element.style.text_align] ?? "flex-start";

  return (
    <div
      style={{
        position: "absolute",
        left: element.x,
        top: element.y,
        width: element.width,
        height: element.height,
        zIndex: element.z_index,
        display: "flex",
        flexDirection: "column",
        alignItems,
        justifyContent: "center",
      }}
      className={TEXT_IDLE[element.idle_animation] ?? ""}
    >
      <StyledText
        key={`${channelKey}-${channel?.triggerId ?? 0}`}
        style={element.style}
        className={`font-black tabular-nums leading-none ${channel?.animClass ?? ""}`}
        outerStyle={{
          display: "inline-block",
          transformOrigin: "center",
          animationDirection: channel?.reverse ? "reverse" : undefined,
          // pre keeps the spacing the user typed around the value: a prefix
          // like "Phase: " ends in a space that HTML would collapse away.
          whiteSpace: "pre",
        }}
      >
        {(element.prefix_text ?? "") + value + (element.suffix_text ?? "")}
      </StyledText>
      {element.show_label && (
        <TextLabel style={element.label_style} text={element.label_text} />
      )}
    </div>
  );
}

/** Milliseconds between two sprite swaps when the overlay carries no value. */
const DEFAULT_CYCLE_INTERVAL_MS = 3000;

/**
 * One cycle step: the URLs to try for it, best first.
 *
 * Sprite URLs are baked when a hunt or a phase target is created and stored as
 * they were, so a URL that turns out to be wrong stays wrong for that entry.
 * Everywhere else in the app an onError chain papers over that; the overlay had
 * none, so a 404 showed nothing at all instead of a placeholder.
 */
type SpriteCandidates = readonly string[];

/** Build the candidate chain for one entry: stored URL, box sprite, placeholder. */
function spriteCandidates(
  spriteUrl: string | undefined,
  canonicalName: string | undefined,
  spriteType: SpriteType,
): SpriteCandidates {
  const candidates = [resolveSpriteSrc(spriteUrl)];
  // Pokesprite is name-based, so it still resolves for forms whose stored URL
  // was built from a wrong numeric ID or a wrong Showdown slug.
  if (canonicalName) candidates.push(cachedSpriteSrc(getBoxSpriteUrl(canonicalName, spriteType)));
  candidates.push(SPRITE_FALLBACK);
  return [...new Set(candidates)];
}

/**
 * Collects the sprite sources the sprite element can cycle through: the hunt
 * sprite first, then every phase target that has a sprite of its own.
 */
function buildSpriteCycleSources(pokemon: Pokemon | null): SpriteCandidates[] {
  if (!pokemon) return [];
  const spriteType = pokemon.sprite_type || "shiny";
  const sources = [
    spriteCandidates(pokemon.sprite_url, pokemon.canonical_name, spriteType),
  ];
  for (const target of pokemon.phase_targets ?? []) {
    if (target.sprite_url) {
      // A phase only ends when a shiny of another species shows up, so a
      // target is shiny regardless of what the hunt itself is after.
      sources.push(spriteCandidates(target.sprite_url, target.canonical_name, "shiny"));
    }
  }
  return sources;
}

/**
 * useSpriteCycle rotates through the given sprite sources and returns the one
 * to show right now. It only ever swaps the `src` of the image: feeding the
 * index into the key of the animated wrapper would restart the trigger
 * animation and make the idle animation jump on every tick.
 *
 * All effect dependencies are primitives on purpose. In the editor this
 * component re-renders on every drag frame, and an array or object dependency
 * would tear down and re-create the interval each frame, so the cycle would
 * stall while dragging.
 */
function useSpriteCycle(
  sources: readonly SpriteCandidates[],
  enabled: boolean,
  intervalMs: number,
  resetKey: string,
): SpriteCandidates {
  const [index, setIndex] = useState(0);
  const count = sources.length;
  const period = intervalMs > 0 ? intervalMs : DEFAULT_CYCLE_INTERVAL_MS;
  const cycling = enabled && count > 1;
  // Read inside the effect without becoming a dependency of it, so the array
  // identity changing on every render does not restart the interval.
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;

  useEffect(() => {
    // Restart at the hunt's own sprite whenever the sources change. The count
    // alone does not catch a switch to another hunt with equally many targets.
    setIndex(0);
    if (!cycling) return;
    // Warm the browser cache for the whole cycle before the first swap. A
    // sprite that is still being fetched when its transition starts decodes
    // mid-animation, which drops frames on every swap of the first round.
    for (const candidates of sourcesRef.current) {
      const preload = new Image();
      // Only the first candidate: the rest exist for the case where this one
      // fails, and fetching them up front would waste a request per swap.
      preload.src = candidates[0];
    }
    const id = setInterval(() => setIndex((i) => (i + 1) % count), period);
    return () => clearInterval(id);
  }, [cycling, count, period, resetKey]);

  // Read through `cycling` instead of trusting the state: after the setting is
  // switched off the reset only lands in the next effect run.
  return sources[cycling ? index % count : 0] ?? EMPTY_CANDIDATES;
}

/** Stable empty chain, so a sourceless render does not churn the slot state. */
const EMPTY_CANDIDATES: SpriteCandidates = [];

/** A slot's chain plus how far its onError has already walked down it. */
interface SpriteSlot {
  readonly candidates: SpriteCandidates;
  readonly index: number;
}

const EMPTY_SLOT: SpriteSlot = { candidates: EMPTY_CANDIDATES, index: 0 };

/** The URL a slot shows right now, empty while it holds no chain. */
function slotSrcOf(slot: SpriteSlot): string {
  return slot.candidates[slot.index] ?? "";
}

/** Longest transition between two cycled sprites, in milliseconds. */
const SPRITE_TRANSITION_MS = 400;

/** Effects the cycling sprite can play on a swap. */
export type SpriteTransition = "none" | "fade" | "wipe-lr" | "wipe-rl";

/**
 * Transition an overlay falls back to. Cycling shipped with the crossfade as
 * its only behaviour, so an overlay that carries no choice keeps that one.
 */
const DEFAULT_SPRITE_TRANSITION: SpriteTransition = "fade";

/** Every transition this build renders, in the order the editor offers them. */
export const SPRITE_TRANSITIONS: readonly SpriteTransition[] = [
  "none",
  "fade",
  "wipe-lr",
  "wipe-rl",
];

/**
 * resolveSpriteTransition maps a stored value onto a transition this build
 * knows. Overlays saved before the setting existed carry an empty string, and
 * one written by a newer version can name an effect this build does not have;
 * both render as the crossfade rather than as nothing at all.
 */
export function resolveSpriteTransition(value: string | undefined): SpriteTransition {
  return SPRITE_TRANSITIONS.includes(value as SpriteTransition)
    ? (value as SpriteTransition)
    : DEFAULT_SPRITE_TRANSITION;
}

/** Keyframes that reveal the incoming sprite, per wipe direction. */
const WIPE_KEYFRAMES: Record<string, string> = {
  "wipe-lr": "overlay-sprite-wipe-lr",
  "wipe-rl": "overlay-sprite-wipe-rl",
};

/**
 * Builds the transition half of one slot's style: everything that differs
 * between the incoming and the outgoing sprite.
 *
 * A wipe reveals the incoming sprite over the outgoing one, which therefore has
 * to stay fully visible until the reveal has covered it. Being covered is not
 * enough to make it disappear afterwards, because sprites are transparent
 * outside their silhouette, so the outgoing slot is cut away by a zero-length
 * opacity transition that waits out the wipe first.
 */
function spriteSlotTransitionStyle(
  transition: SpriteTransition,
  incoming: boolean,
  /** Whether the other slot holds a sprite that the incoming one wipes over. */
  covers: boolean,
  durationMs: number,
): React.CSSProperties {
  if (transition === "none") {
    return { opacity: incoming ? 1 : 0, transition: "none" };
  }
  if (transition === "fade") {
    return {
      opacity: incoming ? 1 : 0,
      transition: `opacity ${durationMs}ms ease-in-out`,
    };
  }
  if (incoming) {
    return {
      opacity: 1,
      transition: "none",
      // The animation only exists on the slot that is in front, so handing the
      // front over restarts it without remounting anything.
      animation: covers
        ? `${WIPE_KEYFRAMES[transition]} ${durationMs}ms ease-in-out both`
        : undefined,
    };
  }
  return { opacity: 0, transition: `opacity 0s linear ${durationMs}ms` };
}

/** Props for {@link CyclingSprite}. */
interface CyclingSpriteProps {
  /** Candidate chains to rotate through, hunt sprite first. */
  readonly sources: readonly SpriteCandidates[];
  /** Whether the overlay cycles at all; a single sprite is shown at rest. */
  readonly enabled: boolean;
  /** Hunt the sources belong to, so a switch restarts the cycle. */
  readonly resetKey: string;
  /** Render pixel art without smoothing. */
  readonly crisp: boolean;
  /** Cycle period, so a transition never outlasts the interval driving it. */
  readonly intervalMs: number;
  /** Effect to play on a swap. */
  readonly transition: SpriteTransition;
}

/**
 * CyclingSprite moves between phase-target sprites instead of swapping the
 * image source in one frame.
 *
 * It keeps two stacked images and alternates which one is in front, so the
 * outgoing sprite is still on screen while the incoming one appears. A single
 * image that merely remounts would blink, because the old frame is gone before
 * the new one has decoded. Neither image is keyed on the cycle index: the idle
 * and trigger animations live on the wrapper divs above, and remounting them
 * every tick would restart those animations.
 *
 * The incoming slot always paints above the outgoing one. A wipe that ran
 * behind the sprite it replaces would reveal nothing.
 *
 * The cycle itself is driven from in here rather than from the overlay root:
 * state up there would re-render every element on the overlay once per tick,
 * for a swap that only ever touches these two images.
 */
function CyclingSprite({
  sources,
  enabled,
  resetKey,
  crisp,
  intervalMs,
  transition,
}: CyclingSpriteProps) {
  const candidates = useSpriteCycle(sources, enabled, intervalMs, resetKey);
  // The chain's first entry identifies the cycle step. Everything below it only
  // ever comes into play through onError, so it never drives a swap.
  const src = candidates[0] ?? "";

  // Two slots, alternating. `front` is the one currently being shown.
  const [slots, setSlots] = useState<readonly [SpriteSlot, SpriteSlot]>([
    { candidates, index: 0 },
    EMPTY_SLOT,
  ]);
  const [front, setFront] = useState(0);
  // Mirrors of what the swap already handed to the slots. Reading the state
  // through refs keeps it out of the dependency list, so the effect runs once
  // per source change instead of a second time on the render it just caused.
  const shownRef = useRef(src);
  const frontRef = useRef(0);
  // Same reason: the chain changes identity on every render, `src` does not.
  const candidatesRef = useRef(candidates);
  candidatesRef.current = candidates;

  useEffect(() => {
    if (!src || src === shownRef.current) return;
    shownRef.current = src;
    const back = frontRef.current === 0 ? 1 : 0;
    frontRef.current = back;
    // A fresh step starts at the head of its chain: the stored URL may well
    // load now even if the previous step's did not.
    const slot: SpriteSlot = { candidates: candidatesRef.current, index: 0 };
    setSlots((prev) => (back === 0 ? [slot, prev[1]] : [prev[0], slot]));
    setFront(back);
  }, [src]);

  /** Walk one slot down to its next candidate after a failed load. */
  const advanceSlot = (slotIndex: number) => {
    setSlots((prev) => {
      const slot = prev[slotIndex];
      if (slot.index >= slot.candidates.length - 1) return prev;
      const next: SpriteSlot = { candidates: slot.candidates, index: slot.index + 1 };
      return slotIndex === 0 ? [next, prev[1]] : [prev[0], next];
    });
  };

  // Half the period, so a fast cycle never spends longer moving between two
  // sprites than it spends showing either of them on its own.
  const durationMs = Math.min(SPRITE_TRANSITION_MS, Math.max(0, intervalMs) / 2);

  return (
    <>
      {slots.map((slot, i) => {
        const slotSrc = slotSrcOf(slot);
        return (
        <img
          // Index keys are correct here: the two slots are fixed positions that
          // swap contents, not a reorderable list.
          key={i}
          src={slotSrc || undefined}
          alt=""
          onError={() => advanceSlot(i)}
          className="pokemon-sprite motion-reduce:transition-none motion-reduce:animate-none"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            position: "absolute",
            inset: 0,
            zIndex: i === front ? 2 : 1,
            imageRendering: crisp ? "pixelated" : undefined,
            ...spriteSlotTransitionStyle(
              transition,
              !!slotSrc && i === front,
              !!slotSrcOf(slots[i === 0 ? 1 : 0]),
              durationMs,
            ),
          }}
        />
        );
      })}
    </>
  );
}

/**
 * Total timer of a hunt across all of its phases, including the segment that is
 * running right now. computePhaseStats stays clock-free so callers can cache it,
 * which is why the live segment is added here on every render instead.
 */
function liveTotalTimerMs(pokemon: Pokemon, stats: PhaseStats): number {
  const childrenMs = stats.totalTimerMs - (pokemon.timer_accumulated_ms || 0);
  return childrenMs + computeTimerMs(pokemon);
}

export function Overlay({
  previewSettings,
  previewPokemon,
  previewPokemonList,
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

  // Snapshot the phase totals are derived from: the editor preview passes its
  // own list, the live overlay already holds every phase entry in the store.
  const pokemonList: Pokemon[] = useMemo(
    () => previewPokemonList ?? appState?.pokemon ?? [],
    [previewPokemonList, appState],
  );

  const phaseStats = useMemo(
    () => computePhaseStats(activePokemon, pokemonList),
    [activePokemon, pokemonList],
  );

  const spriteCycleSources = useMemo(
    () => buildSpriteCycleSources(activePokemon),
    [activePokemon],
  );

  // Inject fonts
  useGoogleFont(settings?.name.style.font_family || "sans");
  useGoogleFont(settings?.counter.style.font_family || "sans");
  useGoogleFont(settings?.title?.style.font_family || "sans");
  useGoogleFont(settings?.timer?.style.font_family ?? "sans");
  useGoogleFont(settings?.timer?.label_style?.font_family ?? "sans");
  useGoogleFont(settings?.odds?.style.font_family ?? "sans");
  useGoogleFont(settings?.odds?.label_style?.font_family ?? "sans");
  useGoogleFont(settings?.phase?.style.font_family ?? "sans");
  useGoogleFont(settings?.phase?.label_style?.font_family ?? "sans");
  useGoogleFont(settings?.total_counter?.style.font_family ?? "sans");
  useGoogleFont(settings?.total_counter?.label_style?.font_family ?? "sans");
  useGoogleFont(settings?.total_timer?.style.font_family ?? "sans");
  useGoogleFont(settings?.total_timer?.label_style?.font_family ?? "sans");

  // Timer tick — force re-render every second while the timer is running
  const [, forceTimerUpdate] = useReducer((x: number) => x + 1, 0);
  const isTimerRunning = !!activePokemon?.timer_started_at;
  useEffect(() => {
    if (!isTimerRunning) return;
    const id = setInterval(() => forceTimerUpdate(), 1000);
    return () => clearInterval(id);
  }, [isTimerRunning]);

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
    counterMode: defaultCounterMode,
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
            style={buildHomebrewBgStyle(
              bgAnimKey,
              settings.background_animation_speed,
              settings.background_animation_config ?? {},
            )}
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
            <CyclingSprite
              sources={spriteCycleSources}
              enabled={settings.sprite.cycle_phase_targets ?? false}
              resetKey={activePokemon?.id ?? ""}
              crisp={crispSprites}
              intervalMs={settings.sprite.cycle_interval_ms ?? DEFAULT_CYCLE_INTERVAL_MS}
              transition={resolveSpriteTransition(settings.sprite.cycle_transition)}
            />
          </div>
        </div>
      )}

      {/* Name — outer div holds position + idle (stable, no key), inner span holds trigger (keyed) */}
      {settings.name.visible && (() => {
          const alignToJustify: Record<string, string> = { center: "center", right: "flex-end" };
          const nameJustifyContent = alignToJustify[settings.name.style.text_align] ?? "flex-start";

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
              // No padding for the stroke: the box does not clip, so the only
              // thing padding would do is indent the glyphs by an amount that
              // depends on the outline width, which makes the text jump the
              // moment someone changes the outline.
              overflow: "visible",
            }}
            className={TEXT_IDLE[settings.name.idle_animation] ?? ""}
          >
            <StyledText
              key={`name-${channels.name.triggerId}`}
              style={settings.name.style}
              className={`uppercase tracking-widest whitespace-nowrap ${channels.name.animClass}`}
              outerStyle={{
                display: "inline-block",
                transformOrigin: "center",
                animationDirection: channels.name.reverse ? "reverse" : undefined,
              }}
            >
              {activePokemon.name}
            </StyledText>
          </div>
          );
      })()}

      {/* Title — outer div holds position + idle (stable, no key), inner span holds trigger (keyed) */}
      {settings.title?.visible && (activePokemon.title || !!previewSettings) && (() => {
          const alignToJustify: Record<string, string> = { center: "center", right: "flex-end" };
          const titleJustifyContent = alignToJustify[settings.title.style.text_align] ?? "flex-start";

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
              // See the name layer: padding here would only indent the glyphs
              // by an outline-dependent amount, and the box does not clip.
              overflow: "visible",
            }}
            className={TEXT_IDLE[settings.title.idle_animation] ?? ""}
          >
            <StyledText
              key={`title-${channels.title.triggerId}`}
              style={settings.title.style}
              className={`uppercase tracking-widest whitespace-nowrap ${channels.title.animClass}`}
              outerStyle={{
                display: "inline-block",
                transformOrigin: "center",
                animationDirection: channels.title.reverse ? "reverse" : undefined,
              }}
            >
              {activePokemon.title || "Titel"}
            </StyledText>
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
              // The digit wrappers below clip their overflow, so they must hold
              // the room the stroke layer of every digit reserves for itself.
              const counterStrokePad = textDecorationPadding(settings.counter.style);
              const counterPrefix = settings.counter.prefix_text ?? "";
              const counterSuffix = settings.counter.suffix_text ?? "";

              if (counterMode === "slot") {
                return (
                  // nowrap: affix and digits are one value, they must not be
                  // torn onto two lines when the element is narrow.
                  <span key={`slot-${channels.counter.triggerId}`} style={{ whiteSpace: "nowrap" }}>
                    <CounterAffix text={counterPrefix} counterStyle={settings.counter.style} />
                    <SlotCounter
                      value={activePokemon.encounters}
                      counterStyle={settings.counter.style}
                      reverse={channels.counter.reverse}
                      strokePadding={counterStrokePad}
                    />
                    <CounterAffix text={counterSuffix} counterStyle={settings.counter.style} />
                  </span>
                );
              }
              if (counterMode === "flip-digit") {
                return (
                  <span key={`flip-${channels.counter.triggerId}`} style={{ whiteSpace: "nowrap" }}>
                    <CounterAffix text={counterPrefix} counterStyle={settings.counter.style} />
                    <FlipCounter
                      value={activePokemon.encounters}
                      counterStyle={settings.counter.style}
                      reverse={channels.counter.reverse}
                      strokePadding={counterStrokePad}
                    />
                    <CounterAffix text={counterSuffix} counterStyle={settings.counter.style} />
                  </span>
                );
              }
              return (
                <StyledText
                  key={`counter-${channels.counter.triggerId}`}
                  style={settings.counter.style}
                  className={`font-black tabular-nums leading-none ${channels.counter.animClass}`}
                  outerStyle={{
                    display: "inline-block",
                    transformOrigin: "center",
                    animationDirection: channels.counter.reverse ? "reverse" : undefined,
                    whiteSpace: "pre",
                  }}
                >
                  {counterPrefix + activePokemon.encounters + counterSuffix}
                </StyledText>
              );
            })()}
            {settings.counter.show_label && (
              <TextLabel
                style={settings.counter.label_style}
                text={settings.counter.label_text}
              />
            )}
          </div>
          );
      })()}

      {/* Timer — live HH:MM:SS display with optional label */}
      {settings.timer?.visible && (() => {
          const timerAlignMap: Record<string, string> = { center: "center", right: "flex-end" };
          const timerAlignItems = timerAlignMap[settings.timer.style.text_align] ?? "flex-start";
          const timerMs = activePokemon ? computeTimerMs(activePokemon) : 0;

          return (
          <div
            style={{
              position: "absolute",
              left: settings.timer.x,
              top: settings.timer.y,
              width: settings.timer.width,
              height: settings.timer.height,
              zIndex: settings.timer.z_index,
              display: "flex",
              flexDirection: "column",
              alignItems: timerAlignItems,
              justifyContent: "center",
            }}
            className={TEXT_IDLE[settings.timer.idle_animation] ?? ""}
          >
            <StyledText
              style={settings.timer.style}
              className="font-black tabular-nums leading-none"
              outerStyle={{
                display: "inline-block",
                whiteSpace: "pre",
              }}
            >
              {(settings.timer.prefix_text ?? "") +
                formatTimer(timerMs) +
                (settings.timer.suffix_text ?? "")}
            </StyledText>
            {settings.timer.show_label && (
              <TextLabel
                style={settings.timer.label_style}
                text={settings.timer.label_text}
              />
            )}
          </div>
          );
      })()}

      {/* Odds — shiny-probability display (fractional or cumulative percent) */}
      {settings.odds?.visible && (() => {
          const oddsAlignMap: Record<string, string> = { center: "center", right: "flex-end" };
          const oddsAlignItems = oddsAlignMap[settings.odds.style.text_align] ?? "flex-start";
          // Every encounter of every phase was a roll at the target, so the
          // percentage counts them all, exactly like the statistics panel.
          const oddsText = computeOddsDisplay(
            activePokemon,
            settings.odds.format,
            phaseStats.totalEncounters,
          );

          return (
          <div
            style={{
              position: "absolute",
              left: settings.odds.x,
              top: settings.odds.y,
              width: settings.odds.width,
              height: settings.odds.height,
              zIndex: settings.odds.z_index,
              display: "flex",
              flexDirection: "column",
              alignItems: oddsAlignItems,
              justifyContent: "center",
            }}
            className={TEXT_IDLE[settings.odds.idle_animation] ?? ""}
          >
            <StyledText
              key={`odds-${channels.odds.triggerId}`}
              style={settings.odds.style}
              className={`font-black tabular-nums leading-none ${channels.odds.animClass}`}
              outerStyle={{
                display: "inline-block",
                transformOrigin: "center",
                animationDirection: channels.odds.reverse ? "reverse" : undefined,
                whiteSpace: "pre",
              }}
            >
              {(settings.odds.prefix_text ?? "") +
                oddsText +
                (settings.odds.suffix_text ?? "")}
            </StyledText>
            {settings.odds.show_label && (
              <TextLabel
                style={settings.odds.label_style}
                text={settings.odds.label_text}
              />
            )}
          </div>
          );
      })()}

      {/* Phase: number of the phase currently in progress */}
      {settings.phase?.visible && (
        <LabeledTextLayer
          element={settings.phase}
          channelKey="phase"
          channel={channels.phase}
          value={String(phaseStats.phaseNumber)}
        />
      )}

      {/* Total encounters: current phase plus all finished ones */}
      {settings.total_counter?.visible && (
        <LabeledTextLayer
          element={settings.total_counter}
          channelKey="total-counter"
          channel={channels.total_counter}
          value={String(phaseStats.totalEncounters)}
        />
      )}

      {/* Total timer: accumulated phase time plus the running segment */}
      {settings.total_timer?.visible && (
        <LabeledTextLayer
          element={settings.total_timer}
          channelKey="total-timer"
          value={formatTimer(liveTotalTimerMs(activePokemon, phaseStats))}
        />
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
