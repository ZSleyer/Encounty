/**
 * DexCatchesModal.tsx: every catch of one species, opened from its summary card.
 *
 * The Pokédex panel shows a species once, so the individual catches need a
 * surface of their own. This is it: the shared modal shell around
 * {@link DexCatchList}, scrolling on the shell's own body row so even a species
 * caught in every shipped game stays one ordinary scrollport.
 */
import { useRef } from "react";
import { useI18n } from "../../contexts/I18nContext";
import { ModalShell } from "../shared/ModalShell";
import { DexCatchList } from "./DexSpeciesDetail";
import type { GameEntry, Pokemon } from "../../types";

/** Props for {@link DexCatchesModal}. */
export interface DexCatchesModalProps {
  /** Localized species name, used in the dialog title. */
  readonly name: string;
  /** English PokéAPI slug of the base species. */
  readonly canonical: string;
  /** Catches on this slot, newest `completed_at` first. */
  readonly catches: Pokemon[];
  /** Full state snapshot, needed to resolve phase parents and children. */
  readonly snapshot: Pokemon[];
  /** Game catalog used to localize the source game. */
  readonly games: GameEntry[];
  /** Language priority list for game names. */
  readonly languages: string[];
  /** Called with the catch to edit, after this dialog has closed. */
  readonly onEditCatch?: (pokemonId: string) => void;
  /** Called after the close transition finishes; unmount the modal here. */
  readonly onClose: () => void;
}

/**
 * Lists the catches of one species inside the shared modal shell.
 *
 * An edit request is reported only once this dialog is gone, so the catch
 * metadata editor never opens on top of it.
 */
export function DexCatchesModal({ name, onEditCatch, onClose, ...list }: DexCatchesModalProps) {
  const { t } = useI18n();
  const pendingEditRef = useRef<string | null>(null);

  const handleClose = () => {
    onClose();
    const pending = pendingEditRef.current;
    pendingEditRef.current = null;
    if (pending) onEditCatch?.(pending);
  };

  return (
    <ModalShell title={t("dex.allCatchesOf", { name })} size="xl" structured onClose={handleClose}>
      {(requestClose) => (
        <DexCatchList
          {...list}
          onEditCatch={
            onEditCatch &&
            ((pokemonId: string) => {
              pendingEditRef.current = pokemonId;
              requestClose();
            })
          }
        />
      )}
    </ModalShell>
  );
}
