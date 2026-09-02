/**
 * DexSlot.tsx: one species or form tile of the Pokédex grid.
 *
 * Also owns the sprite fallback chain, which is a property of the tile rather
 * than of the grid: only the tile knows the three URLs a slot can fall back
 * through.
 */
import { memo } from "react";
import { useI18n } from "../../contexts/I18nContext";
import {
  getDefaultSpriteUrl,
  getBoxSpriteUrl,
  cachedSpriteSrc,
  SPRITE_FALLBACK,
} from "../../utils/sprites";

/** The texture channel of one slot; never picked from color alone (WCAG 1.4.1). */
export function slotTexture(caught: boolean, seenOnly: boolean): string {
  if (caught) return "t-cut";
  if (seenOnly) return "t-dot";
  return "t-hatch";
}

/**
 * Surface and border of one slot. Selection outranks the caught state on both
 * channels, which is why this is a lookup and not classes stacked on the
 * element: `bg-bg-card` and `bg-accent-blue/10` would otherwise fight over
 * stylesheet order.
 */
export function slotStateClass(caught: boolean, seenOnly: boolean, selected: boolean): string {
  const texture = slotTexture(caught, seenOnly);
  if (selected) return `${texture} border-accent-blue bg-accent-blue/10`;
  if (caught) return `${texture} bg-bg-card border-accent-green/70 hover:border-accent-green`;
  if (seenOnly) return `${texture} bg-bg-card border-accent-yellow/70 hover:border-accent-yellow`;
  return `${texture} bg-bg-card border-border-subtle hover:border-text-muted`;
}

/**
 * Falls back to the Pokésprite box sprite, then the base species' own sprite,
 * then the neutral placeholder glyph.
 *
 * A handful of cosmetic forms (e.g. "pikachu-starter", the Let's Go partner
 * form) have no default PokeAPI pixel sprite or Home render at all, only
 * official artwork and a Showdown GIF, so the primary sprite 404s every time,
 * not just transiently. `boxUrl` is Pokésprite's box art for the same
 * canonical name, which does cover these forms.
 *
 * `baseUrl` catches what neither of those reaches: Pokésprite's set stops at
 * Gen 8, so no Gen 9 slot has box art at all, and the ride-legendary builds
 * and modes (Koraidon, Miraidon) and Sinistcha's masterpiece form have no
 * sprite of their own upstream either. Both steps 404 and the slot used to
 * land on the placeholder. The base species sprite is the same creature in a
 * different pose, so it reads far better than a blank glyph.
 *
 * Only `src` (and the `data-dex-sprite-step` cursor) is touched:
 * `data-dex-sprite` keeps the real URL so the unloading observer retries it,
 * and resets the cursor, the next time the slot scrolls back into view.
 * Writing the placeholder into `data-dex-sprite` itself would turn a single
 * transient failure, a network blip or a throttled response from the sprite
 * host, into a permanent one for the rest of the session, because the
 * observer restores from that attribute and React never rewrites a prop whose
 * value did not change.
 */
export function handleSpriteError(
  event: React.SyntheticEvent<HTMLImageElement>,
  boxUrl: string,
  baseUrl: string,
) {
  const img = event.currentTarget;
  // The attribute, never the `src` property: the property resolves to an
  // absolute URL, while the sprite-cache URLs are relative wherever the
  // backend shares the renderer's origin, and the two would never compare
  // equal.
  const current = img.getAttribute("src");
  if (current === SPRITE_FALLBACK) return;
  const chain = [boxUrl, baseUrl, SPRITE_FALLBACK];
  let step = Number(img.dataset.dexSpriteStep ?? 0);
  // Skip a step the slot has no candidate for, and one that repeats the URL
  // which just failed: either would spend a round trip to fail identically.
  while (step < chain.length - 1 && (!chain[step] || chain[step] === current)) step++;
  img.dataset.dexSpriteStep = String(step + 1);
  img.src = chain[step];
}

interface DexSlotProps {
  readonly slotKey: string;
  readonly dexNumber: number;
  readonly name: string;
  /** English PokéAPI slug; drives the Pokésprite box-sprite fallback. */
  readonly canonical: string;
  readonly caught: boolean;
  readonly seenOnly: boolean;
  readonly selected: boolean;
  readonly catchCount: number;
  readonly formEntryCount: number;
  readonly label: string;
  readonly spriteId: number | string;
  readonly spriteSlug?: string;
  readonly gender?: "male" | "female";
  readonly tabIndex: number;
  readonly onOpen: (slotKey: string, dexNumber: number) => void;
}

/**
 * One species or form slot. Caught, seen-only and uncaught differ on three
 * independent channels so the state never rests on color alone (WCAG
 * 1.4.1): the corner cut, dot or hatch texture, the border color, and the
 * sprite, a flat silhouette for uncaught, the plain sprite for seen-only, the
 * full-color shiny for caught, mirroring how mainline games distinguish
 * seen from caught. Selection adds a fourth channel, a filled corner tab no
 * other state paints, so it reads apart from both the caught state and the
 * focus ring.
 */
export const DexSlot = memo(function DexSlot({
  slotKey,
  dexNumber,
  name,
  canonical,
  caught,
  seenOnly,
  selected,
  catchCount,
  formEntryCount,
  label,
  spriteId,
  spriteSlug,
  gender,
  tabIndex,
  onOpen,
}: DexSlotProps) {
  const { t } = useI18n();
  const spriteUrl = cachedSpriteSrc(
    getDefaultSpriteUrl(spriteSlug ?? spriteId, caught ? "shiny" : "normal", gender),
  );
  const boxUrl = cachedSpriteSrc(getBoxSpriteUrl(canonical, caught ? "shiny" : "normal"));
  // Empty on a slot that already is its own base species: stepping to the URL
  // that just failed would spend a second round trip to fail identically.
  const baseSprite = cachedSpriteSrc(getDefaultSpriteUrl(dexNumber, caught ? "shiny" : "normal"));
  const baseUrl = baseSprite === spriteUrl ? "" : baseSprite;
  const showSilhouette = !caught && !seenOnly;
  return (
    <li>
      <button
        type="button"
        data-dex-slot-key={slotKey}
        tabIndex={tabIndex}
        aria-label={label}
        aria-current={selected ? "true" : undefined}
        onClick={() => onOpen(slotKey, dexNumber)}
        className={`relative flex h-full w-full min-h-[104px] flex-col items-center justify-center gap-0.5 border p-1 transition-colors ${slotStateClass(caught, seenOnly, selected)}`}
      >
        {selected && (
          <span aria-hidden="true" className="absolute left-0 top-0 h-2 w-2 bg-accent-blue" />
        )}
        <span className="inline-flex">
          <img
            src={spriteUrl}
            alt=""
            width={96}
            height={96}
            loading="lazy"
            decoding="async"
            // The URL this slot belongs to, kept in an attribute React owns so
            // the unloading observer restores the right sprite even after
            // React recycled the element for another species.
            data-dex-sprite={spriteUrl}
            onError={(e) => handleSpriteError(e, boxUrl, baseUrl)}
            className={`h-12 w-12 object-contain [image-rendering:pixelated] ${showSilhouette ? "t-dex-silhouette" : ""}`}
          />
        </span>
        <span className="font-mono tabular-nums text-[10px] text-text-faint">
          #{String(dexNumber).padStart(4, "0")}
        </span>
        <span className="hidden max-w-full truncate text-[11px] text-text-secondary sm:block">
          {name}
        </span>
        {(catchCount > 1 || formEntryCount > 0) && (
          <span aria-hidden="true" className="flex flex-wrap justify-center gap-1">
            {catchCount > 1 && (
              <span className="t-label dex-slot-badge bg-bg-card tabular-nums">
                {t("dex.catchCount")} {catchCount}
              </span>
            )}
            {formEntryCount > 0 && (
              <span
                className="t-label dex-slot-badge bg-bg-card tabular-nums"
                title={t("dex.formsWithEntries")}
              >
                {t("dex.variants")} {formEntryCount}
              </span>
            )}
          </span>
        )}
      </button>
    </li>
  );
});
