/**
 * pokemonFormSubmit.ts: Submit dispatch for the Pokemon form modal, which has
 * a different onSubmit signature per mode.
 */
import type { NewPokemonData, PokemonFormModalProps } from "./PokemonFormModal";

/** Dispatch the submit action based on modal mode (add vs edit), then play the
 *  dialog's close transition. Awaits `onSubmit` first (it may be async, e.g.
 *  a save request) so the dialog stays open and visibly submitting until
 *  the request settles, succeed or fail, instead of closing instantly and
 *  leaving the caller to close it later with no transition to play. */
export async function submitByMode(
  props: Readonly<PokemonFormModalProps>,
  data: NewPokemonData,
  close: () => void,
) {
  try {
    if (props.mode === "edit") {
      await props.onSubmit(props.pokemon.id, data);
    } else {
      await props.onSubmit(data);
    }
  } finally {
    close();
  }
}
