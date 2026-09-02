/**
 * bulkActions.ts: Actions applied to the whole sidebar selection at once.
 */

import { apiUrl } from "../../utils/api";

/** Marks all selected Pokemon as complete. */
export function completePokemonBulk(
  selectedIds: Set<string>,
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>,
): void {
  for (const id of selectedIds)
    void fetch(apiUrl(`/api/pokemon/${id}/complete`), { method: "POST" }).catch(() => {});
  setSelectedIds(new Set());
}

/** Shows a bulk-delete confirmation dialog for the selected Pokemon. */
export function requestBulkDelete(
  selectedIds: Set<string>,
  t: (key: string) => string,
  setConfirmConfig: React.Dispatch<
    React.SetStateAction<{
      isOpen: boolean;
      title: string;
      message: string;
      isDestructive: boolean;
      onConfirm: () => void;
    }>
  >,
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>,
): void {
  if (selectedIds.size === 0) return;
  setConfirmConfig({
    isOpen: true,
    title: t("confirm.deleteTitle"),
    message: `${selectedIds.size} ${t("dash.pokemonSelected")}. ${t("confirm.deleteMsg")}`,
    isDestructive: true,
    onConfirm: () => {
      for (const id of selectedIds)
        void fetch(apiUrl(`/api/pokemon/${id}`), { method: "DELETE" }).catch(() => {});
      setSelectedIds(new Set());
    },
  });
}
