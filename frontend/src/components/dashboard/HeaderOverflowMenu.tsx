/**
 * HeaderOverflowMenu.tsx: Kebab menu with the hunt header's secondary actions.
 */

import { useRef, useState } from "react";
import { Edit2, MoreVertical, Trash2, Undo2 } from "lucide-react";
import { Pokemon } from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { useAnchorName, anchorTriggerStyle, anchoredMenuStyle } from "../../utils/anchoredMenu";

/**
 * Overflow menu (kebab) in the hunt header bundling the secondary actions
 * Edit, Delete, and (for archived hunts) Reactivate. Uses the same
 * fixed-backdrop dropdown pattern as the sidebar sort menu; Escape closes
 * the menu and focus always returns to the kebab trigger.
 */
export function HeaderOverflowMenu({
  pokemon,
  onEdit,
  onDelete,
  onReactivate,
}: Readonly<{
  pokemon: Pokemon;
  onEdit: () => void;
  onDelete: () => void;
  onReactivate: () => void;
}>) {
  const { t } = useI18n();
  const kebabAnchor = useAnchorName("row-more");
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  /** Closes the menu and restores focus to the kebab trigger (WCAG 2.4.3). */
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  /** Closes the menu, then runs the chosen action. */
  const runAction = (action: () => void) => {
    close();
    action();
  };

  return (
    <div
      className="relative shrink-0"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={triggerRef}
        onClick={() => (open ? close() : setOpen(true))}
        className="flex items-center justify-center min-w-8 min-h-8 rounded-none bg-bg-primary border border-border-subtle hover:border-accent-blue/40 text-text-muted hover:text-text-primary transition-colors"
        title={t("dash.moreActions")}
        aria-label={t("dash.moreActions")}
        aria-expanded={open}
        style={anchorTriggerStyle(kebabAnchor)}
      >
        <MoreVertical className="w-3.5 h-3.5" />
      </button>
      {open && (
        <>
          <button
            className="fixed inset-0 z-40 cursor-default"
            onClick={close}
            aria-label={t("aria.close")}
          />
          <div
            style={anchoredMenuStyle(kebabAnchor, "below-end")}
            className="fixed z-50 overflow-y-auto bg-bg-secondary border border-border-subtle rounded-none shadow-lg py-1 min-w-40"
          >
            <button
              onClick={() => runAction(onEdit)}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-text-secondary hover:bg-bg-primary transition-colors"
              aria-label={t("dash.edit")}
            >
              <Edit2 className="w-3.5 h-3.5" />
              {t("dash.edit")}
            </button>
            {/* Phase entries stay archived: the backend rejects reactivating
                them, they would otherwise keep counting into their parent. */}
            {pokemon.completed_at && !pokemon.phase_of && (
              <button
                onClick={() => runAction(onReactivate)}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-text-secondary hover:bg-bg-primary transition-colors"
                aria-label={t("dash.reactivate")}
              >
                <Undo2 className="w-3.5 h-3.5" />
                {t("dash.reactivate")}
              </button>
            )}
            <button
              onClick={() => runAction(onDelete)}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-accent-red hover:bg-bg-primary transition-colors"
              aria-label={t("dash.delete")}
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t("dash.delete")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
