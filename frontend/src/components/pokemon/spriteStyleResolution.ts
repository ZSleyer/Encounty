/**
 * spriteStyleResolution.ts: Rules that keep the picked sprite style and the
 * picked game compatible with the selected Pokemon.
 *
 * Every entry point takes the setter it may need instead of returning a
 * command, because each of them is driven from an effect that would otherwise
 * have to branch on the result.
 */
import type { GameEntry } from "../../types";
import {
  bestAvailableStyle,
  getPokemonGeneration,
  isSpriteStyleAvailable,
  type SpriteStyle,
} from "../../utils/sprites";

/** Resolve the effective sprite style for a Pokemon, auto-switching if the current style is unavailable. */
export function resolveEffectiveStyle(
  pokemonId: number,
  current: SpriteStyle,
  setSpriteStyle: (s: SpriteStyle) => void,
): SpriteStyle {
  const pkGen = getPokemonGeneration(pokemonId);
  if (isSpriteStyleAvailable(current, pkGen)) return current;
  const best = bestAvailableStyle(current, pkGen);
  setSpriteStyle(best);
  return best;
}
/**
 * Pick the first sprite style that is both generation-available and not marked
 * as unavailable for the currently selected Pokemon. Returns null if every
 * style has been ruled out.
 */
export function pickAvailableStyle(
  unavailable: Set<SpriteStyle>,
  gen: number | null,
): SpriteStyle | null {
  const order: SpriteStyle[] = ["animated", "3d", "artwork", "classic", "box"];
  for (const s of order) {
    if (!unavailable.has(s) && isSpriteStyleAvailable(s, gen)) return s;
  }
  return null;
}

/** Switch sprite style to best available when the current style is unavailable for a generation. */
export function autoSwitchSpriteStyle(
  gen: number | null,
  current: SpriteStyle,
  setSpriteStyle: (s: SpriteStyle) => void,
) {
  if (gen == null) return;
  const best = bestAvailableStyle(current, gen);
  if (best !== current) setSpriteStyle(best);
}

/** Clear game selection when the game predates the selected Pokemon's introduction generation. */
export function clearIncompatibleGame(
  selected: { id: number } | null,
  selectedGame: string,
  games: GameEntry[],
  setSelectedGame: (g: string) => void,
) {
  if (!selected || !selectedGame) return;
  const gameGen = games.find((g) => g.key === selectedGame)?.generation;
  const pkGen = getPokemonGeneration(selected.id);
  if (gameGen != null && gameGen < pkGen) setSelectedGame("");
}
