/**
 * FormStrip.tsx: the form scope picker of the Pokédex override modal.
 */
import { useMemo } from "react";
import { useI18n } from "../../contexts/I18nContext";
import { formEntriesFor, getPkmnName, type PokemonData } from "../pokemon/pokemonPicker";
import { FormChip } from "./FormChip";

interface FormStripProps {
  readonly species: PokemonData;
  readonly value: string;
  readonly onChange: (formCanonical: string) => void;
}

/**
 * Sprite-preview form picker, replacing a plain `<select>` with the same
 * chip-strip interaction as `PokemonSearchPicker`'s form strip: a leading
 * "default form" chip (the species' own sprite) followed by one chip per
 * game-filtered form. No active game is known inside this modal, so
 * `formEntriesFor` is called with `""`/`[]`, which is also what the removed
 * `<select>` passed to `isFormAvailableForGame` before.
 */
export function FormStrip({ species, value, onChange }: FormStripProps) {
  const { t, locale } = useI18n();
  const forms = useMemo(() => formEntriesFor(species, "", [], locale), [species, locale]);
  if (forms.length === 0) return null;

  return (
    <div>
      <span className="block text-xs text-text-muted mb-1">{t("dex.overrideForm")}</span>
      <div className="flex flex-wrap gap-1.5">
        <FormChip
          active={value === ""}
          onClick={() => onChange("")}
          label={t("dex.defaultForm")}
          spriteId={species.id}
          canonical={species.canonical}
        />
        {forms.map((f) => (
          <FormChip
            key={f.canonical}
            active={value === f.canonical}
            onClick={() => onChange(f.canonical)}
            label={f.formName || getPkmnName(f, locale, t("dex.genderFormFemale"))}
            spriteId={f.spriteId}
            canonical={f.canonical}
            spriteSlug={f.spriteSlug}
            gender={f.gender}
          />
        ))}
      </div>
    </div>
  );
}
