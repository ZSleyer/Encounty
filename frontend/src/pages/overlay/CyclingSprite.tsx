/**
 * Cycling sprite of the overlay: collects the sprite sources of a hunt and its
 * phase targets, rotates through them and moves between two stacked images so
 * a swap never blinks.
 */
import { useEffect, useRef, useState } from "react";
import { Pokemon } from "../../types";
import {
  cachedSpriteSrc,
  getBoxSpriteUrl,
  resolveSpriteSrc,
  SPRITE_FALLBACK,
  type SpriteType,
} from "../../utils/sprites";

/** Milliseconds between two sprite swaps when the overlay carries no value. */
export const DEFAULT_CYCLE_INTERVAL_MS = 3000;

/**
 * One cycle step: the URLs to try for it, best first.
 *
 * Sprite URLs are baked when a hunt or a phase target is created and stored as
 * they were, so a URL that turns out to be wrong stays wrong for that entry.
 * Everywhere else in the app an onError chain papers over that; the overlay had
 * none, so a 404 showed nothing at all instead of a placeholder.
 */
export type SpriteCandidates = readonly string[];

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
export function buildSpriteCycleSources(pokemon: Pokemon | null): SpriteCandidates[] {
  if (!pokemon) return [];
  const spriteType = pokemon.sprite_type || "shiny";
  const sources = [spriteCandidates(pokemon.sprite_url, pokemon.canonical_name, spriteType)];
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
const SPRITE_TRANSITIONS: readonly SpriteTransition[] = ["none", "fade", "wipe-lr", "wipe-rl"];

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
export function CyclingSprite({
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
