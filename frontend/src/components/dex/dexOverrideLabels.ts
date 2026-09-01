/**
 * dexOverrideLabels.ts: the label helpers shared by the Pokedex override modal
 * and the species detail view.
 *
 * They used to live in DexOverrideModal.tsx, which the detail view imports for
 * the modal itself, so the detail view had to import back into the modal just
 * to render an override row's scope. Keeping the helpers here leaves that
 * import one-way.
 */
import type { DexOverride } from "../../utils/dex";
import type { PokemonData, PokemonForm } from "../pokemon/pokemonPicker";

/** Gender options in display order; "" means "not gender-restricted". */
export const GENDER_OPTIONS: { value: string; key: string }[] = [
  { value: "", key: "dex.genderAny" },
  { value: "male", key: "dex.genderMale" },
  { value: "female", key: "dex.genderFemale" },
];

/** True when at least one form of the species is gender-restricted. */
export function hasGenderVariance(species: PokemonData | undefined): boolean {
  return (
    species?.gender_rate !== undefined ||
    species?.forms?.some((form) => Boolean(form.gender)) === true
  );
}

/**
 * Localized display label of a form's own canonical. PokeAPI never names a
 * gender-only pseudo-form (there is no in-game distinct form, just a sprite
 * difference), so the fallback below reuses the exact string PokeAPI's own
 * localization gives the equivalent *named* gender forms (verified against
 * the synced data for pyroar-female/meowstic-female/indeedee-female) rather
 * than leaking the raw PokeAPI slug.
 */
export function formCanonicalLabel(
  f: PokemonForm,
  locale: string,
  t: (key: string) => string,
): string {
  return (
    f.form_names?.[locale] ||
    f.form_names?.en ||
    (f.gender === "female" ? t("dex.genderFormFemale") : f.canonical)
  );
}

/** Localized label of one override row's form scope, resolved against the
 * species' known forms so an already-set override shows a real name instead
 * of its raw PokeAPI canonical. */
export function formLabel(
  o: DexOverride,
  forms: PokemonForm[],
  locale: string,
  t: (key: string) => string,
): string {
  if (!o.formCanonical) return t("dex.defaultForm");
  const form = forms.find((f) => f.canonical === o.formCanonical);
  return form ? formCanonicalLabel(form, locale, t) : o.formCanonical;
}

/** Localized label of one override row's gender scope. */
export function genderLabel(o: DexOverride, t: (key: string) => string): string {
  const option = GENDER_OPTIONS.find((g) => g.value === o.gender);
  return t(option?.key ?? "dex.genderAny");
}
