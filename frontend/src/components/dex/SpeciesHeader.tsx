/**
 * SpeciesHeader.tsx: the identity line of one Pokédex species.
 *
 * Its own module rather than part of the species detail: the override modal
 * shows the very same header, and importing it from the detail body made the
 * two files import each other.
 */
import { useI18n } from "../../contexts/I18nContext";
import { TrimmedBoxSprite } from "../shared/TrimmedBoxSprite";
import { getDefaultSpriteUrl, cachedSpriteSrc } from "../../utils/sprites";

/** Props for {@link SpeciesHeader}. */
export interface SpeciesHeaderProps {
  readonly id: number;
  readonly canonical: string;
  readonly name: string;
  readonly generation: number;
  readonly caught: boolean;
  readonly headingId?: string;
}

/** Sprite, padded dex number, localized name and generation chip. */
export function SpeciesHeader({
  id,
  canonical,
  name,
  generation,
  caught,
  headingId,
}: SpeciesHeaderProps) {
  const { t } = useI18n();

  return (
    <div className="flex items-center gap-4">
      <TrimmedBoxSprite
        canonicalName={canonical}
        spriteType={caught ? "shiny" : "normal"}
        alt=""
        fitPx={64}
        // Pokésprite is a gen8 set and 404s for every Gen 9 species, so
        // the PokeAPI default sprite stands in instead of a pokéball.
        fallbackSrc={cachedSpriteSrc(getDefaultSpriteUrl(id, caught ? "shiny" : "normal"))}
        className={caught ? "" : "t-dex-silhouette"}
      />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-mono text-xs tabular-nums text-text-faint">
          #{String(id).padStart(4, "0")}
        </span>
        <h2 id={headingId} className="text-base font-semibold text-text-primary">
          {name}
        </h2>
        <span className="t-label w-fit">{t("dex.generation", { n: generation })}</span>
      </div>
    </div>
  );
}
