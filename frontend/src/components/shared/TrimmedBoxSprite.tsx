import { useEffect, useState, type ReactElement } from "react";
import { SPRITE_FALLBACK, cachedSpriteSrc, getBoxSpriteUrl } from "../../utils/sprites";
import type { SpriteType } from "../../utils/sprites";

interface TrimmedBoxSpriteProps {
  readonly canonicalName: string;
  readonly spriteType?: SpriteType;
  readonly alt: string;
  readonly className?: string;
  /** When true, renders nothing instead of the fallback sprite on failure. */
  readonly hideOnFail?: boolean;
  /**
   * When the box sprite fails to load, render this image URL instead of the
   * generic SPRITE_FALLBACK silhouette. Takes precedence over hideOnFail.
   */
  readonly fallbackSrc?: string;
  /**
   * Render the trimmed content at the largest integer multiple of its
   * natural size that fits a fitPx square. Keeps pixel rows uniform so
   * nearest-neighbour scaling never distorts the sprite. Overrides any
   * size classes in className.
   */
  readonly fitPx?: number;
}

interface ContentBounds {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/**
 * Scans pixel data for the smallest bounding box that contains all non-transparent
 * content (alpha > 10). Returns null when the image is fully transparent.
 */
function findContentBounds(
  data: Uint8ClampedArray,
  w: number,
  h: number,
): ContentBounds | null {
  let top = h, left = w, bottom = 0, right = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 10) {
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
  }
  if (bottom <= top || right <= left) return null;
  return { top, left, bottom, right };
}

/** Computes the padded crop region from content bounds, clamped to image dimensions. */
function computeCropRegion(bounds: ContentBounds, w: number, h: number, pad: number) {
  const cx = Math.max(0, bounds.left - pad);
  const cy = Math.max(0, bounds.top - pad);
  const cw = Math.min(w, bounds.right + 1 + pad) - cx;
  const ch = Math.min(h, bounds.bottom + 1 + pad) - cy;
  return { cx, cy, cw, ch };
}

/** Draws the trimmed sprite region onto a canvas and returns a data URL. */
function drawTrimmedSprite(img: HTMLImageElement, bounds: ContentBounds): string {
  const { width: w, height: h } = img;
  const { cx, cy, cw, ch } = computeCropRegion(bounds, w, h, 1);

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return "";

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);
  return canvas.toDataURL("image/png");
}

/** Detects content bounds of an image using an offscreen canvas. */
function detectBounds(img: HTMLImageElement): ContentBounds | null {
  const { width: w, height: h } = img;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(img, 0, 0);
  return findContentBounds(ctx.getImageData(0, 0, w, h).data, w, h);
}

/** A trimmed sprite ready to render: the cropped data URL and its size. */
interface TrimmedSprite {
  url: string;
  w: number;
  h: number;
}

/**
 * Trimmed sprites by canonical name and sprite type.
 *
 * Producing one costs an image load, a full getImageData pixel scan, a
 * synchronous PNG encode through toDataURL and a second decode of the result.
 * The inputs are static, so the answer is worth keeping: the dashboard and the
 * dex detail mount these constantly and used to redo all of it every time.
 *
 * Only successes are remembered. A failure is cheap to reach and may well be a
 * hiccup rather than a missing file, so remembering it would strand a sprite on
 * the placeholder for the rest of the session.
 *
 * ponytail: unbounded. One entry per species and sprite type, so a few thousand
 * small data URLs at the very worst. Bound it if a sprite set ever grows past
 * that.
 */
const trimmedCache = new Map<string, TrimmedSprite>();

/** Cache key of one trimmed sprite. */
function trimmedKey(canonicalName: string, spriteType: SpriteType): string {
  return `${canonicalName}|${spriteType}`;
}

/**
 * Drops every memoised trim. Test-only: the cache lives in the module and
 * outlives a single `it()`, so a suite that re-stubs `Image` between cases
 * would otherwise never see its stub used again.
 */
export function resetTrimmedSpriteCache(): void {
  trimmedCache.clear();
}

/**
 * Renders a pokesprite box sprite with transparent padding trimmed away.
 * Loads the image into an off-screen canvas, detects the content bounding box,
 * then displays only the trimmed region as an img element — so all Pokemon appear
 * consistently sized and centered regardless of their position within the 68x56
 * sprite sheet cell.
 */
export function TrimmedBoxSprite({ canonicalName, spriteType = "shiny", alt, className = "", hideOnFail = false, fallbackSrc, fitPx }: TrimmedBoxSpriteProps) {
  const [src, setSrc] = useState<TrimmedSprite | null>(
    () => trimmedCache.get(trimmedKey(canonicalName, spriteType)) ?? null,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const key = trimmedKey(canonicalName, spriteType);
    const hit = trimmedCache.get(key);
    if (hit) {
      setFailed(false);
      setSrc(hit);
      return;
    }
    setFailed(false);

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const bounds = detectBounds(img);
      if (!bounds) {
        setFailed(true);
        return;
      }
      const dataUrl = drawTrimmedSprite(img, bounds);
      if (!dataUrl) {
        setFailed(true);
        return;
      }
      const { cw, ch } = computeCropRegion(bounds, img.width, img.height, 1);
      const trimmed = { url: dataUrl, w: cw, h: ch };
      trimmedCache.set(key, trimmed);
      setSrc(trimmed);
    };
    img.onerror = () => setFailed(true);
    img.src = cachedSpriteSrc(getBoxSpriteUrl(canonicalName, spriteType));
  }, [canonicalName, spriteType]);

  /**
   * Holds the square `fitPx` asks for, in every state.
   *
   * The trimmed sprite is smaller than that square by construction, and every
   * species trims to a different size, so letting the element take the
   * sprite's own size moves whatever sits beside it, both when the sprite
   * lands and on each change of species. Without `fitPx` the caller sizes the
   * sprite through `className` and no box is needed.
   */
  const inFitBox = (node: ReactElement) =>
    fitPx === undefined ? (
      node
    ) : (
      <span
        className="inline-flex shrink-0 items-center justify-center"
        style={{ width: fitPx, height: fitPx }}
      >
        {node}
      </span>
    );

  if (failed) {
    if (fallbackSrc) {
      return inFitBox(
        <img src={fallbackSrc} alt={alt} className={`pokemon-sprite object-contain ${className}`} />,
      );
    }
    if (hideOnFail) return null;
    return inFitBox(
      <img src={SPRITE_FALLBACK} alt={alt} className={`pokemon-sprite object-contain ${className}`} />,
    );
  }

  // Nothing decoded yet. An empty slot that later pops the sprite in reads as
  // a flicker, so the glyph a failed load would show stands in and the space
  // is already the right shape. `hideOnFail` is the exception: those callers
  // drop the slot entirely on failure, and a placeholder that appears only to
  // vanish is a worse flicker than one that never appeared.
  if (!src) {
    if (hideOnFail) return inFitBox(<div className={className} aria-hidden="true" />);
    return inFitBox(
      <img src={SPRITE_FALLBACK} alt={alt} className={`pokemon-sprite object-contain ${className}`} />,
    );
  }

  const fitStyle = fitPx
    ? (() => {
        const scale = Math.max(1, Math.floor(fitPx / Math.max(src.w, src.h)));
        return { width: src.w * scale, height: src.h * scale };
      })()
    : undefined;

  return inFitBox(
    <img
      src={src.url}
      alt={alt}
      style={fitStyle}
      className={`pokemon-sprite object-contain [image-rendering:pixelated] ${className}`}
    />,
  );
}
