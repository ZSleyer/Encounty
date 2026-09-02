/**
 * FormChip.tsx: one chip of the override modal's sprite-preview form strip.
 */
import { PokemonThumb } from "../pokemon/pokemonPicker";

interface FormChipProps {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly label: string;
  readonly spriteId: number;
  readonly canonical: string;
  readonly spriteSlug?: string;
  readonly gender?: "male" | "female";
}

/**
 * One form-strip chip: sprite thumbnail plus label, active state carried by
 * both the border/background and `aria-pressed` (never colour alone).
 * Mirrors the chip markup of `PokemonSearchPicker`'s own form strip exactly,
 * since the user asked for "the same as the Pokédex catch modal".
 */
export function FormChip({
  active,
  onClick,
  label,
  spriteId,
  canonical,
  spriteSlug,
  gender,
}: FormChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1.5 min-h-[24px] px-2 py-1 rounded-none border text-xs transition-colors ${
        active
          ? "border-accent-blue/40 bg-accent-blue/10 text-accent-blue"
          : "border-border-subtle text-text-muted hover:text-text-primary"
      }`}
    >
      <PokemonThumb
        spriteId={spriteId}
        canonical={canonical}
        spriteSlug={spriteSlug}
        gender={gender}
        alt=""
        className="h-6 w-6 object-contain shrink-0"
      />
      <span className="capitalize truncate max-w-[10rem]">{label}</span>
    </button>
  );
}
