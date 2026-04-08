import { useEffect, useState } from "react";
import { SPRITE_FALLBACK, getBoxSpriteUrl } from "../../utils/sprites";
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

/**
 * Renders a pokesprite box sprite with transparent padding trimmed away.
 * Loads the image into an off-screen canvas, detects the content bounding box,
 * then displays only the trimmed region as an img element — so all Pokemon appear
 * consistently sized and centered regardless of their position within the 68x56
 * sprite sheet cell.
 */
export function TrimmedBoxSprite({ canonicalName, spriteType = "shiny", alt, className = "", hideOnFail = false, fallbackSrc }: TrimmedBoxSpriteProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
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
      setSrc(dataUrl);
    };
    img.onerror = () => setFailed(true);
    img.src = getBoxSpriteUrl(canonicalName, spriteType);
  }, [canonicalName, spriteType]);

  if (failed) {
    if (fallbackSrc) {
      return <img src={fallbackSrc} alt={alt} className={`pokemon-sprite ${className}`} />;
    }
    if (hideOnFail) return null;
    return <img src={SPRITE_FALLBACK} alt={alt} className={`pokemon-sprite ${className}`} />;
  }

  if (!src) return <div className={className} aria-hidden="true" />;

  return (
    <img
      src={src}
      alt={alt}
      className={`pokemon-sprite [image-rendering:pixelated] ${className}`}
    />
  );
}
