import { useEffect, useRef, useState } from "react";
import { SPRITE_FALLBACK, getBoxSpriteUrl } from "../../utils/sprites";
import type { SpriteType } from "../../utils/sprites";

interface TrimmedBoxSpriteProps {
  readonly canonicalName: string;
  readonly spriteType?: SpriteType;
  readonly alt: string;
  readonly className?: string;
  /** When true, renders nothing instead of the fallback sprite on failure. */
  readonly hideOnFail?: boolean;
}

/**
 * Scans pixel data for the smallest bounding box that contains all non-transparent
 * content (alpha > 10). Returns null when the image is fully transparent.
 */
function findContentBounds(
  data: Uint8ClampedArray,
  w: number,
  h: number,
): { top: number; left: number; bottom: number; right: number } | null {
  let top = h, left = w, bottom = 0, right = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 10) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  if (bottom <= top || right <= left) return null;
  return { top, left, bottom, right };
}

/**
 * Renders a pokesprite box sprite with transparent padding trimmed away.
 * Loads the image into an off-screen canvas, detects the content bounding box,
 * then displays only the trimmed region — so all Pokemon appear consistently sized
 * and centered regardless of their position within the 68x56 sprite sheet cell.
 */
export function TrimmedBoxSprite({ canonicalName, spriteType = "shiny", alt, className = "", hideOnFail = false }: TrimmedBoxSpriteProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  // Reset failed state when the Pokemon changes so the canvas renders again
  useEffect(() => {
    setFailed(false);
  }, [canonicalName, spriteType]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const { width: w, height: h } = img;
      // Draw to detect content bounds
      canvas.width = w;
      canvas.height = h;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0);

      const bounds = findContentBounds(ctx.getImageData(0, 0, w, h).data, w, h);
      if (!bounds) {
        // Fully transparent — show fallback
        setFailed(true);
        return;
      }

      // Add 1px padding around content
      const pad = 1;
      const cx = Math.max(0, bounds.left - pad);
      const cy = Math.max(0, bounds.top - pad);
      const cw = Math.min(w, bounds.right + 1 + pad) - cx;
      const ch = Math.min(h, bounds.bottom + 1 + pad) - cy;

      canvas.width = cw;
      canvas.height = ch;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, cw, ch);
      ctx.drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);
    };
    img.onerror = () => setFailed(true);
    img.src = getBoxSpriteUrl(canonicalName, spriteType);
  }, [canonicalName, spriteType]);

  if (failed) {
    if (hideOnFail) return null;
    return <img src={SPRITE_FALLBACK} alt={alt} className={`pokemon-sprite ${className}`} />;
  }

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={alt}
      className={`pokemon-sprite [image-rendering:pixelated] ${className}`}
    />
  );
}
