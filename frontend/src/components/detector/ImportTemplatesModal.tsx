/**
 * ImportTemplatesModal: Lets the user pick another Pokemon to import templates from.
 *
 * Designed for scalability: search filter, scrollable list with template thumbnails,
 * and expandable detail view per Pokemon. Rendered as a native <dialog> via the
 * shared ModalShell chrome.
 */
import { useState, useMemo } from "react";
import { Download, Search, ChevronDown, ChevronRight } from "lucide-react";
import { useCounterStore } from "../../hooks/useCounterState";
import { useI18n } from "../../contexts/I18nContext";
import { apiUrl } from "../../utils/api";
import { ModalShell } from "../shared/ModalShell";

export type ImportTemplatesModalProps = Readonly<{
  currentPokemonId: string;
  onImport: (sourcePokemonId: string, templateIndices?: number[]) => void;
  onClose: () => void;
}>;

/** Import templates modal with search, preview thumbnails, and scalable list. */
export function ImportTemplatesModal({ currentPokemonId, onImport, onClose }: ImportTemplatesModalProps) {
  const { t } = useI18n();
  const { appState } = useCounterStore();
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const candidates = useMemo(() => {
    const all = (appState?.pokemon ?? []).filter(
      (p) => p.id !== currentPokemonId && (p.detector_config?.templates?.length ?? 0) > 0,
    );
    if (!search.trim()) return all;
    const q = search.toLowerCase().trim();
    return all.filter((p) => p.name.toLowerCase().includes(q));
  }, [appState?.pokemon, currentPokemonId, search]);

  return (
    <ModalShell
      title={t("detector.importFromPokemon")}
      onClose={onClose}
      size="lg"
      titleSize="sm"
    >
      {/* Search */}
      <div className="relative mb-3">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
        <input
          autoFocus
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("detector.searchPokemon")}
          className="w-full pl-8 pr-3 py-2 text-xs bg-bg-primary border border-border-subtle rounded-none text-text-primary placeholder-text-faint outline-none focus:border-accent-blue/50 transition-colors"
          aria-label={t("detector.searchPokemon")}
        />
      </div>

      {/* List */}
      <div className="overflow-y-auto max-h-[min(60vh,480px)]">
        {candidates.length === 0 ? (
          <p className="text-xs text-text-muted text-center py-8">
            {search.trim() ? t("detector.noSearchResults") : t("detector.noImportSources")}
          </p>
        ) : (
          <div className="space-y-1">
            {candidates.map((p) => {
              const templateCount = p.detector_config?.templates?.length ?? 0;
              const isExpanded = expandedId === p.id;
              return (
                <div key={p.id} className="rounded-none border border-border-subtle overflow-hidden">
                  {/* Pokemon row */}
                  <div className="flex items-center gap-3 px-3 py-2 hover:bg-bg-hover transition-colors">
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : p.id)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left"
                      aria-expanded={isExpanded}
                      aria-label={`${p.name}, ${templateCount} Templates`}
                    >
                      {isExpanded
                        ? <ChevronDown className="w-3.5 h-3.5 text-text-muted shrink-0" />
                        : <ChevronRight className="w-3.5 h-3.5 text-text-muted shrink-0" />
                      }
                      <img src={p.sprite_url || undefined} alt="" className="w-7 h-7 object-contain shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-text-primary font-medium truncate block">{p.name}</span>
                        <span className="text-[10px] text-text-muted">
                          {templateCount} {templateCount === 1 ? "Template" : "Templates"}
                        </span>
                      </div>
                    </button>
                    <button
                      onClick={() => onImport(p.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-none text-[11px] font-semibold bg-accent-blue/10 text-accent-blue hover:bg-accent-blue hover:text-bg-primary transition-colors shrink-0"
                      aria-label={`${t("detector.importTemplates")} ${p.name}`}
                    >
                      <Download className="w-3.5 h-3.5" />
                      {t("detector.importTemplates")}
                    </button>
                  </div>

                  {/* Expanded template preview with individual import buttons */}
                  {isExpanded && templateCount > 0 && (
                    <div className="px-3 pb-3 pt-1 bg-bg-primary/50 border-t border-border-subtle">
                      <div className="grid grid-cols-3 gap-1.5">
                        {p.detector_config?.templates?.map((tmpl, i) => (
                          <button
                            key={`preview-${p.id}-${i}`}
                            onClick={() => onImport(p.id, [i])}
                            className={`relative rounded-none overflow-hidden bg-black/40 aspect-video group cursor-pointer transition-all hover:ring-2 hover:ring-accent-blue ${
                              tmpl.enabled === false ? "opacity-70 hover:opacity-100" : "ring-1 ring-accent-blue/50"
                            }`}
                            title={`${tmpl.name || "Template " + (i + 1)} importieren`}
                            aria-label={`${tmpl.name || "Template " + (i + 1)} importieren`}
                          >
                            <img
                              src={apiUrl(`/api/detector/${p.id}/template/${i}`)}
                              alt={tmpl.name || `Template ${i + 1}`}
                              className="absolute inset-0 w-full h-full object-contain"
                              loading="lazy"
                            />
                            {/* Hover overlay with download icon */}
                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <Download className="w-4 h-4 text-white" />
                            </div>
                            <span className="absolute bottom-0 inset-x-0 text-[8px] text-white bg-black/60 px-1 py-0.5 truncate text-center">
                              {tmpl.name || `Template ${i + 1}`}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </ModalShell>
  );
}
