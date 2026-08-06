/**
 * FreezableSprite.tsx: sprite image that stops animating while the window is
 * unfocused.
 *
 * Animated Showdown GIFs keep the Chromium GPU process busy even when the app
 * is idle in the background, because animated images are decoded and composited
 * outside the renderer's frame loop. Freezing them costs nothing visually: the
 * last decoded frame is painted into a canvas and the <img> is taken out of the
 * render tree, which is what actually stops the animation.
 *
 * Only animated sources are affected. Static sprites render as a plain <img>,
 * so nothing changes for them.
 *
 * Deliberately NOT used by the OBS overlay: that window is never focused, so
 * freezing on blur would stop its sprites permanently.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { useWindowFocused } from "../../hooks/useWindowFocused";

interface FreezableSpriteProps {
  readonly src: string;
  readonly alt: string;
  readonly className?: string;
  readonly style?: React.CSSProperties;
  readonly onError?: () => void;
  /** Mirrors <img aria-hidden>, for sprites that only decorate a labelled control. */
  readonly decorative?: boolean;
}

/** Reports whether a sprite URL points at an animated image. */
function isAnimatedSprite(src: string): boolean {
  return src.toLowerCase().endsWith(".gif");
}

/**
 * Renders a sprite that freezes on its current frame while the window is
 * unfocused. Falls back to a plain image whenever the source is not animated
 * or the frame could not be captured.
 */
export function FreezableSprite({ src, alt, className = "", style, onError, decorative }: FreezableSpriteProps) {
  const focused = useWindowFocused();
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [frozen, setFrozen] = useState(false);

  const shouldFreeze = !focused && isAnimatedSprite(src);

  useLayoutEffect(() => {
    if (!shouldFreeze) {
      setFrozen(false);
      return;
    }
    const img = imgRef.current;
    const canvas = canvasRef.current;
    // A sprite that has not decoded yet has nothing to snapshot; leave it running.
    if (!img || !canvas || !img.naturalWidth || !img.naturalHeight) return;

    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // The GIF host sends no CORS headers, so this taints the canvas. Painting it
    // is still allowed, only reading pixels back would throw, and we never do.
    ctx.drawImage(img, 0, 0);
    setFrozen(true);
  }, [shouldFreeze, src]);

  return (
    <>
      <img
        ref={imgRef}
        src={src}
        alt={frozen || decorative ? "" : alt}
        aria-hidden={frozen || decorative ? true : undefined}
        onError={onError}
        className={className}
        style={frozen ? { ...style, display: "none" } : style}
      />
      {/* Mounted only while freezing. A permanently mounted canvas would expose a
          second element carrying the same accessible name as the image. */}
      {shouldFreeze && (
        <canvas
          ref={canvasRef}
          // The canvas only takes over the accessible name once it actually
          // replaces the image; until then the image still carries it.
          role={frozen && !decorative ? "img" : undefined}
          aria-label={frozen && !decorative ? alt : undefined}
          aria-hidden={frozen && !decorative ? undefined : true}
          className={className}
          style={frozen ? style : { ...style, display: "none" }}
        />
      )}
    </>
  );
}
