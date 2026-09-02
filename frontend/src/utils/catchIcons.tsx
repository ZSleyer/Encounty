/**
 * catchIcons.tsx: Icon URLs for the catch reference catalogs (balls, ribbons,
 * marks) plus the small <img> wrapper that renders them.
 *
 * No image is vendored into this repository, every icon is hotlinked from the
 * upstream project it belongs to, the same arrangement the Pokemon sprites in
 * `sprites.ts` already use. Two sources are needed:
 *
 *   - Balls come from the PokeAPI sprite repository, whose item filenames are
 *     the very item slugs our catalog stores (all 38 balls resolve).
 *   - Ribbons and marks come from PKHeX, which is also where the generator took
 *     their slugs from, so the filename is the slug with its dashes removed
 *     (53/53 marks, 106/111 ribbons).
 *
 * Every URL is derived from a slug of our own generated catalog, never from
 * user input, so none of them needs the guarding `safeSpriteSrc` applies to
 * pasted sprite URLs.
 */
import { useEffect, useState } from "react";
import { cachedSpriteSrc } from "./sprites";

// --- Sources ---

/** PokeAPI item sprites, used for the Poke Ball icons. */
const BALL_ICON_BASE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items";

/** PKHeX ribbon resources, which hold both the ribbon and the mark icons. */
const RIBBON_ICON_BASE =
  "https://raw.githubusercontent.com/kwsch/PKHeX/master/PKHeX.Drawing.Misc/Resources/img/ribbons";

// --- URL builders ---

// These three are render-only: nothing persists their result, so they can hand
// back the sprite-cache detour directly instead of leaving it to every caller.

/**
 * Icon URL of a Poke Ball.
 * @param slug Ball slug as stored in CatchMeta, e.g. "dusk-ball".
 */
export function getBallIconUrl(slug: string): string {
  return cachedSpriteSrc(`${BALL_ICON_BASE}/${slug}.png`);
}

/**
 * Icon URL of a ribbon.
 *
 * The five `ribbon-count-g3-*` entries are the Hoenn contest counters, which
 * PKHeX draws with the plain contest ribbon instead of an own image, so they
 * are folded onto their base ribbon rather than left without an icon.
 *
 * @param slug Ribbon slug as stored in CatchMeta, e.g. "ribbon-champion-kalos".
 */
export function getRibbonIconUrl(slug: string): string {
  const base = slug.replace(/^ribbon-count-g3-/, "ribbon-g3-");
  return cachedSpriteSrc(`${RIBBON_ICON_BASE}/${base.replace(/-/g, "")}.png`);
}

/**
 * Icon URL of a mark. PKHeX files them under the ribbons with a `ribbonmark`
 * prefix, e.g. "mark-sleepy-time" becomes "ribbonmarksleepytime".
 *
 * @param slug Mark slug as stored in CatchMeta, e.g. "mark-lunchtime".
 */
export function getMarkIconUrl(slug: string): string {
  const name = slug.replace(/^mark-/, "").replace(/-/g, "");
  return cachedSpriteSrc(`${RIBBON_ICON_BASE}/ribbonmark${name}.png`);
}

// --- Component ---

/** Props for {@link CatchIcon}. */
export interface CatchIconProps {
  /** Icon URL, or an empty string to render nothing. */
  readonly src: string;
  /** Size and spacing classes; the caller owns the layout. */
  readonly className?: string;
}

/**
 * Decorative catch icon.
 *
 * Always paired with the visible name of the same entry, so it carries an empty
 * alt text and stays out of the accessibility tree (WCAG 1.1.1). A slug the
 * upstream repository does not know, or a machine that is offline, removes the
 * image instead of leaving a broken-image glyph behind.
 */
export function CatchIcon({ src, className }: CatchIconProps) {
  const [failed, setFailed] = useState(false);

  // The surrounding lists key their rows, not this component, so one instance
  // can be reused for a different entry and has to retry for the new URL.
  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) return null;
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      loading="lazy"
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
