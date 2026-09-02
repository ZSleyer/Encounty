/**
 * EmptyListPlaceholder.tsx: Placeholder shown when the sidebar list is empty.
 */

import { Gamepad2, Plus, Search, Trophy } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import type { SidebarTab } from "./types";

/** Renders the empty-list placeholder based on current search query and sidebar tab. */
export function EmptyListPlaceholder({
  query,
  sidebarTab,
  onClearAndAdd,
  onAdd,
}: Readonly<{
  query: string;
  sidebarTab: SidebarTab;
  onClearAndAdd: () => void;
  onAdd: () => void;
}>) {
  const { t } = useI18n();
  if (query) {
    return (
      <>
        <Search className="w-8 h-8 text-text-faint mb-3" />
        <p className="text-sm text-text-muted">
          {t("dash.noMatch")} &bdquo;{query}&ldquo;
        </p>
        <button
          onClick={onClearAndAdd}
          className="mt-3 text-xs text-accent-blue hover:underline flex items-center gap-1"
        >
          <Plus className="w-3 h-3" />
          {t("dash.addNew")}
        </button>
      </>
    );
  }
  if (sidebarTab === "active") {
    return (
      <>
        <Gamepad2 className="w-10 h-10 text-text-faint mb-3" />
        <p className="text-sm text-text-muted">{t("dash.noPokemon")}</p>
        <button onClick={onAdd} className="mt-4 text-xs text-accent-blue hover:underline">
          {t("dash.addFirst")}
        </button>
      </>
    );
  }
  return (
    <>
      <Trophy className="w-10 h-10 text-text-faint mb-3" />
      <p className="text-sm text-text-muted">{t("dash.noCaught")}</p>
      <p className="text-xs text-text-faint mt-1">{t("dash.noCaughtHint")}</p>
    </>
  );
}
