/**
 * ManualEntryCard.tsx: one hand-entered Pokédex override as a catch card.
 */
import { Pencil } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import { CatchMetaSummary } from "../pokemon/CatchMetaSummary";
import {
  formLabel as overrideFormLabel,
  genderLabel as overrideGenderLabel,
} from "./dexOverrideLabels";
import { usePokedex, PokemonThumb, type PokemonForm } from "../pokemon/pokemonPicker";
import type { DexOverride } from "../../utils/dex";
import { CurrentEvolutionSprite } from "./CurrentEvolutionSprite";
import { spriteForOverride } from "./dexDetailHelpers";

interface ManualEntryCardProps {
  readonly override: DexOverride;
  readonly forms: PokemonForm[];
  readonly speciesId: number;
  readonly speciesCanonical: string;
  readonly originCanonical?: string;
  /** Opens the details editor directly (the summary panel's own pencil). */
  readonly onEditDetails: () => void;
  /**
   * Opens the full override editor (form/gender scope, caught/seen, remove)
   * pre-scoped to this exact entry. The species-level "add manually" button
   * only ever starts a fresh, unscoped entry; this is the only way back into
   * an existing one's own scope without picking it again from that button.
   */
  readonly onEditScope: () => void;
}

/**
 * One manual override styled exactly like {@link CatchCard}, so a hunt logged
 * through the app and a species marked by hand read as the same kind of
 * thing at a glance. The "manually marked" badge is the one thing that tells
 * them apart, since a manual entry has no game/date/hunt-method facts and no
 * dashboard record to open.
 */
export function ManualEntryCard({
  override: o,
  forms,
  speciesId,
  speciesCanonical,
  originCanonical,
  onEditDetails,
  onEditScope,
}: ManualEntryCardProps) {
  const { t, locale } = useI18n();
  const { allPokemon } = usePokedex();
  const sprite = spriteForOverride(o, forms, speciesId, speciesCanonical);
  const currentEvolution = o.meta?.evolutions?.[o.meta.evolutions.length - 1];

  return (
    <div className="t-panel flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {currentEvolution ? (
          <CurrentEvolutionSprite
            canonical={currentEvolution.canonical_name}
            gender={currentEvolution.gender}
            allPokemon={allPokemon}
          />
        ) : (
          <PokemonThumb
            spriteId={sprite.spriteId}
            canonical={sprite.canonical}
            spriteSlug={sprite.spriteSlug}
            gender={sprite.gender}
            alt=""
            className="h-8 w-8 shrink-0 object-contain"
          />
        )}
        <span className="text-sm font-semibold text-text-primary">
          {o.meta?.nickname?.trim() || overrideFormLabel(o, forms, locale, t)}
          {o.gender && ` · ${overrideGenderLabel(o, t)}`}
        </span>
        <span className="t-label t-label--accent">{t("dex.manualBadge")}</span>
        <span className="t-label">
          {o.caught ? t("dex.overrideCaught") : t("dex.overrideSeen")}
        </span>
        <button
          type="button"
          onClick={onEditScope}
          aria-label={t("aria.dexOverrideEdit")}
          className="relative ml-auto after:absolute after:-inset-2 after:content-[''] t-label text-text-muted hover:text-text-primary transition-colors"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </div>

      <CatchMetaSummary
        meta={o.meta}
        gender={(o.gender as "male" | "female") || undefined}
        originCanonical={originCanonical ?? (o.formCanonical || speciesCanonical)}
        onEdit={onEditDetails}
      />
    </div>
  );
}
