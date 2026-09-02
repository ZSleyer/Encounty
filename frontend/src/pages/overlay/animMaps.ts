/**
 * Animation vocabularies of the overlay: the stored animation keys of an
 * element mapped onto the CSS classes that play them, plus the guarded lookup
 * every consumer has to use on them.
 */

/** Trigger animations the counter element offers. */
export const COUNTER_ANIMS: Record<string, string> = {
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

/** Trigger animations the sprite element offers. */
export const SPRITE_ANIMS: Record<string, string> = {
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

/** Trigger animations the plain text elements (name, title, odds) offer. */
export const NAME_ANIMS: Record<string, string> = {
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
/** Trigger animations the labeled phasing text elements offer. */
export const LABELED_TEXT_ANIMS: Record<string, string> = {
  ...COUNTER_ANIMS,
  ...NAME_ANIMS,
};

/** Idle animations the sprite element offers. */
export const SPRITE_IDLE: Record<string, string> = {
  float: "animate-float",
  pulse: "animate-overlay-pulse-idle",
  rock: "animate-overlay-rock",
  bob: "animate-overlay-bob",
  wiggle: "animate-overlay-wiggle",
  shimmer: "animate-overlay-shimmer-idle",
};

/** Idle animations every text element offers. */
export const TEXT_IDLE: Record<string, string> = {
  breathe: "animate-overlay-breathe",
  glow: "animate-overlay-glow",
  shimmer: "animate-overlay-text-shimmer",
  float: "animate-overlay-text-float",
};

/** Background animations, mapped onto the class that carries their keyframes. */
export const BG_ANIM_CLASS: Record<string, string> = {
  waves: "canvas-waves",
  "gradient-shift": "canvas-gradient-shift",
  "shimmer-bg": "canvas-shimmer-bg",
};

/** Base cycle length of each background animation, in seconds. */
export const BG_ANIM_DEFAULT_DURATION: Record<string, number> = {
  waves: 30,
  "gradient-shift": 8,
  "shimmer-bg": 3,
};

/**
 * Own-key lookup for the animation maps. `in` would also match inherited
 * Object.prototype members, so a stored animation key like "constructor" would
 * pass the guard and resolve to a function that ends up in a class name.
 */
export function hasOwnKey(map: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(map, key);
}
