/**
 * ImportTemplatesModal — Lets the user pick another Pokemon to import templates from.
 */
import { X, Download } from "lucide-react";
import { createPortal } from "react-dom";
import { useCounterStore } from "../../hooks/useCounterState";
import { useI18n } from "../../contexts/I18nContext";

export type ImportTemplatesModalProps = Readonly<{
  currentPokemonId: string;
  onImport: (sourcePokemonId: string) => void;
  onClose: () => void;
}>;

export function ImportTemplatesModal({ currentPokemonId, onImport, onClose }: ImportTemplatesModalProps) {
  const { t } = useI18n();
  const { appState } = useCounterStore();

  const candidates = (appState?.pokemon ?? []).filter(
    (p) => p.id !== currentPokemonId && (p.detector_config?.templates?.length ?? 0) > 0,
  );

  return createPortal(
    <button
      type="button"
      aria-label="Close dialog"
      className="appearance-none border-none p-0 m-0 w-full h-full fixed inset-0 z-100 bg-black/70 flex items-center justify-center backdrop-blur-sm"
      onClick={(e) => { e.stopPropagation(); onClose(); }}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
    >
      <div
        className="bg-bg-card border border-border-subtle rounded-2xl shadow-2xl w-full max-w-md p-6"
        role="none"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-text-primary">{t("detector.importFromPokemon")}</h3>
          <button onClick={onClose} className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {candidates.length === 0 ? (
          <p className="text-xs text-text-muted text-center py-8">{t("detector.noImportSources")}</p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {candidates.map((p) => (
              <button
                key={p.id}
                onClick={() => onImport(p.id)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-bg-hover transition-colors text-left"
              >
                <img src={p.sprite_url} alt={p.name} className="w-8 h-8 object-contain" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-text-primary truncate block">{p.name}</span>
                  <span className="text-[11px] text-text-muted">
                    {p.detector_config?.templates?.length ?? 0} template(s)
                  </span>
                </div>
                <Download className="w-4 h-4 text-text-muted shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </button>,
    document.body,
  );
}
