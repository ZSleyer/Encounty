/**
 * DexDetailModal.tsx: dialog presentation of the Pokédex species detail.
 *
 * Only narrow viewports use it. Once the two-pane Pokédex layout fits, the
 * very same body renders as a permanent side panel next to the grid, so the
 * markup lives in {@link DexSpeciesDetail} and this file is nothing but the
 * dialog shell around it.
 *
 * The narrow path shows the same summary card as the panel. Its "all catches"
 * control swaps this dialog's own body instead of stacking a second dialog on
 * top: on a phone there is no room for two, and one dialog keeps the escape
 * and focus story single-file.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import { ModalShell } from "../shared/ModalShell";
import { DexCatchList, DexSpeciesDetail, type DexSpeciesDetailProps } from "./DexSpeciesDetail";

/** Props for {@link DexDetailModal}: the detail body plus the dialog's own close. */
export interface DexDetailModalProps extends Omit<
  DexSpeciesDetailProps,
  "headingId" | "onShowAllCatches" | "showAllRef"
> {
  /** Called after the close transition finishes; unmount the modal here. */
  readonly onClose: () => void;
}

/**
 * Species detail of the Pokédex grid, wrapped in the shared modal shell.
 *
 * An edit request is reported only once this dialog is gone, so the catch
 * metadata editor never opens on top of it.
 */
export function DexDetailModal({ onClose, onEditCatch, ...detail }: DexDetailModalProps) {
  const { t } = useI18n();
  const [showAll, setShowAll] = useState(false);
  const showAllButtonRef = useRef<HTMLButtonElement>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const swappedRef = useRef(false);
  const pendingEditRef = useRef<string | null>(null);

  // Focus follows the view swap so the keyboard never lands back at the top of
  // the dialog. Skipped on the first pass: showModal() has already placed the
  // initial focus by then and stealing it would be a surprise.
  useEffect(() => {
    if (!swappedRef.current) {
      swappedRef.current = true;
      return;
    }
    const target = showAll ? backButtonRef.current : showAllButtonRef.current;
    target?.focus();
  }, [showAll]);

  const handleClose = () => {
    onClose();
    const pending = pendingEditRef.current;
    pendingEditRef.current = null;
    if (pending) onEditCatch?.(pending);
  };

  const title = showAll ? t("dex.allCatchesOf", { name: detail.name }) : detail.name;

  return (
    <ModalShell title={title} size="xl" structured onClose={handleClose}>
      {(requestClose) => {
        const editCatch =
          onEditCatch &&
          ((pokemonId: string) => {
            pendingEditRef.current = pokemonId;
            requestClose();
          });

        if (showAll) {
          return (
            <div className="flex flex-col gap-3">
              <button
                ref={backButtonRef}
                type="button"
                onClick={() => setShowAll(false)}
                className="t-cut flex min-h-[32px] w-fit items-center gap-1.5 border border-border-subtle px-3 py-2 text-xs text-text-muted transition-colors hover:border-accent-blue hover:text-text-primary"
              >
                <ChevronLeft className="h-3 w-3" aria-hidden="true" />
                {t("dex.backToSummary")}
              </button>
              {/* Same split the summary makes: this list is the catch
                  history, and a failed attempt was never a catch. */}
              <DexCatchList
                catches={detail.catches.filter((entry) => !entry.failed)}
                canonical={detail.canonical}
                snapshot={detail.snapshot}
                games={detail.games}
                languages={detail.languages}
                nameLanguage={detail.nameLanguage}
                onEditCatch={editCatch}
              />
            </div>
          );
        }

        return (
          <DexSpeciesDetail
            {...detail}
            onEditCatch={editCatch}
            onShowAllCatches={() => setShowAll(true)}
            showAllRef={showAllButtonRef}
          />
        );
      }}
    </ModalShell>
  );
}
