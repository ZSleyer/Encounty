import { useEffect, useRef, useState } from "react";
import { SPRITE_FALLBACK, getBoxSpriteUrl } from "../../utils/sprites";
import type { SpriteType } from "../../utils/sprites";

interface TrimmedBoxSpriteProps {
  readonly canonicalName: string;
  readonly spriteType?: SpriteType;
  readonly alt: string;
  readonly className?: string;
}

/**
 * Renders a pokesprite box sprite with transparent padding trimmed away.
 * Loads the image into an off-screen canvas, detects the content bounding box,
 * then displays only the trimmed region — so all Pokemon appear consistently sized
 * and centered regardless of their position within the 68x56 sprite sheet cell.
 */
export function TrimmedBoxSprite({ canonicalName, spriteType = "shiny", alt, className = "" }: TrimmedBoxSpriteProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

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

      const data = ctx.getImageData(0, 0, w, h).data;
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

      if (bottom <= top || right <= left) {
        // Fully transparent — show fallback
        setFailed(true);
        return;
      }

      // Add 1px padding around content
      const pad = 1;
      const cx = Math.max(0, left - pad);
      const cy = Math.max(0, top - pad);
      const cw = Math.min(w, right + 1 + pad) - cx;
      const ch = Math.min(h, bottom + 1 + pad) - cy;

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
