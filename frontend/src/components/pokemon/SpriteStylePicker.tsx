/**
 * SpriteStylePicker.tsx: The sprite style grid of the Pokemon form, one
 * preview-image button per style.
 *
 * Styles a generation never had are filtered out entirely; styles whose image
 * fails to load are reported upwards through `onStyleUnavailable` and shown
 * disabled, so a picked style can never leave the user on a silhouette.
 */
import { Box, Film, Gamepad2, Package, Palette } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import type { PokemonGender } from "../../types";
import {
  cachedSpriteSrc,
  getSpriteUrl,
  isSpriteStyleAvailable,
  SPRITE_FALLBACK,
  SPRITE_STYLES,
  type SpriteStyle,
  type SpriteType,
} from "../../utils/sprites";
import type { SelectedState } from "./pokemonFormDefaults";

interface SpriteStylePickerProps {
  /** Currently picked species, or null while nothing is selected. */
  readonly selected: SelectedState | null;
  readonly selectedGame: string;
  readonly spriteType: SpriteType;
  readonly spriteStyle: SpriteStyle;
  readonly gender?: PokemonGender;
  /** Generation the availability filter runs against: the game's, else the species'. */
  readonly generation: number | null;
  /** Styles whose preview failed to load for the current species. */
  readonly unavailableStyles: ReadonlySet<SpriteStyle>;
  readonly onSelect: (style: SpriteStyle) => void;
  readonly onStyleUnavailable: (style: SpriteStyle) => void;
}

/** Renders the sprite style grid with a live preview per style. */
export function SpriteStylePicker({
  selected,
  selectedGame,
  spriteType,
  spriteStyle,
  gender,
  generation,
  unavailableStyles,
  onSelect,
  onStyleUnavailable,
}: SpriteStylePickerProps) {
  const { t } = useI18n();
  return (
    <div className="w-full">
      <span className="block text-xs text-text-muted mb-2">{t("modal.spriteStyle")}:</span>
      <div className="grid grid-cols-2 gap-2">
        {SPRITE_STYLES.filter((s) => isSpriteStyleAvailable(s.key, generation)).map(
          (s, index, filtered) => {
            const previewUrl = selected
              ? cachedSpriteSrc(
                  getSpriteUrl(
                    selected.spriteId.toString(),
                    selectedGame,
                    spriteType,
                    s.key,
                    selected.canonical,
                    selected.spriteSlug,
                    selected.baseCanonical,
                    gender,
                  ),
                )
              : "";
            // Last item in an odd-length list spans full width
            const isLastOdd = index === filtered.length - 1 && filtered.length % 2 === 1;
            const isUnavailable = unavailableStyles.has(s.key);
            const isSelected = spriteStyle === s.key;
            let buttonStateClass: string;
            if (isUnavailable) {
              buttonStateClass =
                "bg-bg-primary text-text-faint border-border-subtle opacity-40 cursor-not-allowed";
            } else if (isSelected) {
              buttonStateClass =
                "bg-accent-blue/10 text-accent-blue border-accent-blue/30 ring-1 ring-accent-blue/30";
            } else {
              buttonStateClass =
                "bg-bg-primary text-text-muted border-border-subtle hover:text-text-secondary";
            }
            return (
              <button
                key={s.key}
                type="button"
                disabled={isUnavailable}
                aria-disabled={isUnavailable}
                aria-pressed={isSelected}
                onClick={() => {
                  if (!isUnavailable) onSelect(s.key);
                }}
                title={isUnavailable ? t("modal.spriteUnavailable") : t(s.descKey)}
                className={`flex flex-col items-center gap-1 px-2 py-2 rounded-none text-xs font-medium transition-colors border ${isLastOdd ? "col-span-2" : ""} ${buttonStateClass}`}
              >
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt={t(s.labelKey)}
                    className="h-10 w-10 object-contain pokemon-sprite"
                    style={
                      s.key === "box" || s.key === "classic"
                        ? { imageRendering: "pixelated" }
                        : undefined
                    }
                    onError={(e) => {
                      const img = e.currentTarget;
                      if (img.src !== SPRITE_FALLBACK) {
                        img.src = SPRITE_FALLBACK;
                      }
                      onStyleUnavailable(s.key);
                    }}
                  />
                ) : (
                  <span className="flex items-center justify-center h-10 w-10 text-lg text-text-faint">
                    ?
                  </span>
                )}
                <span className="flex items-center gap-1">
                  {s.key === "box" && <Package className="w-3 h-3" />}
                  {s.key === "animated" && <Film className="w-3 h-3" />}
                  {s.key === "3d" && <Box className="w-3 h-3" />}
                  {s.key === "artwork" && <Palette className="w-3 h-3" />}
                  {s.key === "classic" && <Gamepad2 className="w-3 h-3" />}
                  {t(s.labelKey)}
                </span>
              </button>
            );
          },
        )}
      </div>
    </div>
  );
}
