/**
 * CollapsedSidebarItem.tsx: Sprite-only sidebar row of the collapsed sidebar.
 */

import { Pokemon } from "../../types";
import { pokemonDisplayName } from "../../utils/pokemon";
import { hasDetectorReady } from "./huntMode";
import { resolveDetectorDot, sidebarSpriteUrl } from "./presentation";

/** Collapsed sidebar sprite-only button for a single Pokemon. */
export function CollapsedSidebarItem({
  pokemon,
  isViewed,
  detectorStatus,
  imgError,
  onActivate,
  onImgError,
  t,
}: Readonly<{
  pokemon: Pokemon;
  isViewed: boolean;
  detectorStatus: Record<string, { state?: string; confidence?: number }>;
  imgError: Record<string, string>;
  onActivate: (id: string) => void;
  onImgError: (id: string, src: string) => void;
  t: (key: string) => string;
}>) {
  const src = sidebarSpriteUrl(pokemon, imgError);
  const showDot = hasDetectorReady(pokemon);
  return (
    <button
      onClick={() => onActivate(pokemon.id)}
      className={`w-full p-1.5 flex items-center justify-center transition-colors ${
        isViewed ? "bg-accent-blue/15" : "hover:bg-bg-hover"
      }`}
      title={`${pokemonDisplayName(pokemon)} (${pokemon.encounters.toLocaleString()})`}
    >
      <div className="relative w-7 h-7">
        <img
          src={src}
          alt={pokemonDisplayName(pokemon)}
          className="pokemon-sprite w-full h-full object-contain"
          onError={() => onImgError(pokemon.id, src)}
        />
        {showDot &&
          (() => {
            const { dotClass, title } = resolveDetectorDot(detectorStatus, pokemon.id, t);
            return (
              <span
                className={`absolute -top-0.5 -left-0.5 w-2 h-2 rounded-full border border-bg-secondary ${dotClass}`}
                title={title}
              />
            );
          })()}
      </div>
    </button>
  );
}
