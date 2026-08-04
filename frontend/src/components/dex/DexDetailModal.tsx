/**
 * DexDetailModal.tsx: dialog presentation of the Pokédex species detail.
 *
 * Only narrow viewports use it. Once the two-pane Pokédex layout fits, the
 * very same body renders as a permanent side panel next to the grid, so the
 * markup lives in {@link DexSpeciesDetail} and this file is nothing but the
 * dialog shell around it.
 */
import { ModalShell } from "../shared/ModalShell";
import { DexSpeciesDetail, type DexSpeciesDetailProps } from "./DexSpeciesDetail";

/** Props for {@link DexDetailModal}: the detail body plus the dialog's own close. */
export interface DexDetailModalProps extends Omit<DexSpeciesDetailProps, "headingId"> {
  /** Called after the close transition finishes. */
  readonly onClose: () => void;
}

/** Species detail of the Pokédex grid, wrapped in the shared modal shell. */
export function DexDetailModal({ onClose, ...detail }: DexDetailModalProps) {
  return (
    <ModalShell title={detail.name} size="xl" structured onClose={onClose}>
      <DexSpeciesDetail {...detail} />
    </ModalShell>
  );
}
