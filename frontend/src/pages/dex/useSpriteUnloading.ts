/**
 * useSpriteUnloading.ts: keeps the Pokédex grid from holding every sprite.
 */
import { useEffect } from "react";
import { SPRITE_FALLBACK } from "../../utils/sprites";

/**
 * How far outside the scroll port a slot sprite stays loaded, expressed
 * relative to the port itself.
 *
 * A fixed 600px was smaller than the port it was meant to lead (818px on a
 * maximized window), so a scroll of one screen already outran the keep zone
 * and slots arrived blank. One port height in either direction keeps a full
 * screen of sprites ready on both sides and scales with the window instead of
 * assuming one.
 */
const SPRITE_KEEP_MARGIN = "100%";

/**
 * Keeps only the sprites near the scroll port loaded.
 *
 * `loading="lazy"` alone stops the dex from fetching all 1025 sprites up front,
 * but once a species has scrolled past, its image stays decoded for the rest of
 * the session; walking the dex once therefore ends with the full set resident.
 * The observer swaps the placeholder glyph into every slot that left the port,
 * which releases the sprite, and puts the real URL back on the way in.
 *
 * The URL it puts back is read from `data-dex-sprite`, which React renders
 * alongside `src`, rather than from a copy the observer parked itself: React
 * recycles slot elements when a filter rebuilds the grid, and a parked copy
 * would then restore the previous species' sprite into the reused slot.
 *
 * Swapping in a placeholder rather than dropping the `src` attribute is also
 * load-bearing: an image without a source collapses to a zero area box, an
 * element of zero area intersects nothing, and the observer would never report
 * the slot as visible again, leaving it blank forever. The glyph is the one a
 * failed sprite already shows, so the swap stays unremarkable in the only
 * moment it can be seen at all, a jump long enough to outrun the keep margin.
 *
 * The sprites are the only thing released: the slots stay in the DOM, so
 * find-in-page, focus order and the roving tabindex are untouched.
 *
 * @param gridsRef Element wrapping every generation section.
 * @param revision Changes whenever the rendered slot set does, so the observer
 * picks up sprites of newly mounted or re-filtered blocks.
 */
export function useSpriteUnloading(
  gridsRef: React.RefObject<HTMLDivElement | null>,
  revision: unknown,
) {
  useEffect(() => {
    const root = gridsRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const sprite = entry.target as HTMLImageElement;
          const wanted = entry.isIntersecting
            ? (sprite.dataset.dexSprite ?? SPRITE_FALLBACK)
            : SPRITE_FALLBACK;
          // Coming back into view retries the primary sprite fresh, so a
          // form whose default sprite is permanently missing walks the whole
          // fallback chain again instead of jumping straight to the
          // placeholder on every pass after the first.
          if (entry.isIntersecting) delete sprite.dataset.dexSpriteStep;
          // Compared as the attribute for the same reason as in
          // handleSpriteError: `sprite.src` resolves to an absolute URL and
          // would never match the relative sprite-cache URL, so every
          // registration would reassign every visible sprite for nothing.
          if (sprite.getAttribute("src") !== wanted) sprite.src = wanted;
        }
      },
      // No explicit root: the dex scrolls in a container owned by the app
      // shell, and the viewport intersection is already clipped by it.
      { rootMargin: SPRITE_KEEP_MARGIN },
    );

    for (const sprite of root.querySelectorAll<HTMLImageElement>("img[data-dex-sprite]")) {
      observer.observe(sprite);
    }
    return () => observer.disconnect();
  }, [gridsRef, revision]);
}
