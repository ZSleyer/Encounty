import { useEffect, useId } from "react";
import { useI18n } from "../../contexts/I18nContext";
import type { PokemonGender } from "../../types";

/** One gender choice supported by a species. */
export interface GenderOption {
  value: PokemonGender | "";
  labelKey: string;
  symbol?: string;
}

/** Return the selectable genders represented by a PokéAPI gender rate. */
export function genderOptions(genderRate: number | undefined): GenderOption[] {
  const unspecified: GenderOption = { value: "", labelKey: "catchMeta.genderUnknown" };
  const male: GenderOption = { value: "male", labelKey: "catchMeta.genderMale", symbol: "♂" };
  const female: GenderOption = { value: "female", labelKey: "catchMeta.genderFemale", symbol: "♀" };
  const genderless: GenderOption = { value: "genderless", labelKey: "catchMeta.genderless" };
  if (genderRate === -1) return [unspecified, genderless];
  if (genderRate === 0) return [unspecified, male];
  if (genderRate === 8) return [unspecified, female];
  if (genderRate !== undefined && genderRate >= 1 && genderRate <= 7) return [unspecified, male, female];
  return [unspecified, male, female, genderless];
}

/** Resolve the only possible gender, leaving multi-gender species unspecified. */
export function defaultGender(genderRate: number | undefined): PokemonGender | undefined {
  const options = genderOptions(genderRate).filter((option) => option.value);
  return options.length === 1 ? options[0].value || undefined : undefined;
}

interface GenderSelectorProps {
  readonly value?: PokemonGender;
  readonly genderRate?: number;
  readonly onChange: (gender: PokemonGender | undefined) => void;
  readonly className?: string;
}

/** Accessible native gender picker shared by hunt and catch flows. */
export function GenderSelector({ value, genderRate, onChange, className }: GenderSelectorProps) {
  const { t } = useI18n();
  const id = useId();
  const options = genderOptions(genderRate);
  const automatic = defaultGender(genderRate);
  useEffect(() => {
    if (!value && automatic) onChange(automatic);
  }, [automatic, onChange, value]);
  return (
    <div className={className || "flex flex-col gap-1.5"}>
      <label htmlFor={id} className="t-label">{t("catchMeta.gender")}</label>
      <select
        id={id}
        value={value ?? automatic ?? ""}
        onChange={(event) => onChange((event.target.value || undefined) as PokemonGender | undefined)}
        className="w-full bg-bg-secondary border border-border-subtle rounded-none px-3 py-2 text-sm text-text-primary focus:border-accent-blue/50 transition-colors"
      >
        {options.map((option) => (
          <option key={option.value || "unspecified"} value={option.value}>
            {option.symbol ? `${option.symbol} ` : ""}{t(option.labelKey)}
          </option>
        ))}
      </select>
    </div>
  );
}
