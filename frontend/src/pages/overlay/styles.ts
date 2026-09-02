/**
 * Derived inline styles of the overlay canvas: the background layers of the
 * card and the CSS variables a homebrew background animation reads.
 */
import { OverlaySettings } from "../../types";
import { apiUrl } from "../../utils/api";
import { BG_ANIM_CLASS, BG_ANIM_DEFAULT_DURATION, hasOwnKey } from "./animMaps";

/**
 * Builds the inline style for a homebrew CSS-based background animation,
 * combining the optional speed override with config-driven CSS variables
 * (color, opacity, gradient stops, etc.) consumed by the matching CSS rule.
 */
export function buildHomebrewBgStyle(
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

/** Computes all derived CSS styles for the overlay background, text, and layout. */
export function buildOverlayStyles(
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
        border: settings.show_border ? `${borderWidth}px solid ${settings.border_color}` : "none",
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
    outerStyle,
    crispSprites,
    bgAnimKey,
    hasBgAnim,
    bgStyle,
    bgImageStyle,
  };
}
