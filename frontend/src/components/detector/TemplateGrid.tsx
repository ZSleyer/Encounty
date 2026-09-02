/**
 * TemplateGrid.tsx -- Template thumbnails of the detector panel sidebar.
 *
 * Shows every stored template as a selectable card with its radio indicator,
 * thumbnail and hover actions, or the empty-state hint when there are none.
 */
import { AlertTriangle, Pencil, X } from "lucide-react";
import { DetectorTemplate } from "../../types";
import { apiUrl } from "../../utils/api";

/** Renders the detector panel's template cards, or the empty-state hint. */
export function TemplateGrid({
  templates,
  pokemonId,
  isRunning,
  onEditTemplate,
  onToggleTemplate,
  onRequestDelete,
  t,
}: Readonly<{
  templates: DetectorTemplate[];
  /** Pokemon the templates belong to, used to build the thumbnail URLs. */
  pokemonId: string;
  isRunning: boolean;
  onEditTemplate: (index: number) => void;
  onToggleTemplate: (index: number) => void;
  /** Opens the delete confirmation for one template. */
  onRequestDelete: (target: { index: number; name: string }) => void;
  t: (k: string) => string;
}>) {
  return templates.length > 0 ? (
    <div className="grid grid-cols-2 gap-2">
      {templates.map((tmpl, index) => {
        const isDimmed = tmpl.regions.length === 0 || tmpl.enabled === false;
        return (
          <div
            key={`template-${tmpl.template_db_id ?? index}`}
            className={`relative group rounded-none overflow-hidden transition-all w-full bg-bg-primary ${(() => {
              if (tmpl.regions.length === 0) return "ring-1 ring-accent-yellow/50";
              if (tmpl.enabled === false) return "ring-1 ring-border-subtle";
              return "ring-2 ring-accent-blue";
            })()}`}
          >
            {/* Clickable toggle area, disabled during active hunt or when template has no regions */}
            <button
              type="button"
              className={`w-full text-left bg-transparent border-none p-0 ${
                isRunning || tmpl.regions.length === 0 ? "cursor-default" : "cursor-pointer"
              }`}
              onClick={() => {
                if (tmpl.regions.length === 0) {
                  onEditTemplate(index);
                  return;
                }
                if (!isRunning) onToggleTemplate(index);
              }}
              disabled={isRunning && tmpl.regions.length > 0}
              aria-label={`${tmpl.name || "Template " + (index + 1)}, ${
                tmpl.regions.length === 0
                  ? t("templateEditor.templateInvalid")
                  : t("detector.setActiveTemplate")
              }`}
            >
              {/* Radio indicator for active selection, disabled for invalid templates */}
              <div
                className={`absolute top-1 left-1 z-10 pointer-events-none ${isDimmed ? "opacity-60" : ""}`}
              >
                <div
                  className={`w-3.5 h-3.5 rounded-none border-2 flex items-center justify-center ${(() => {
                    if (tmpl.regions.length === 0) return "border-accent-yellow/50 bg-transparent";
                    if (tmpl.enabled === false) return "border-text-muted bg-transparent";
                    return "border-accent-blue bg-accent-blue";
                  })()}`}
                >
                  {tmpl.enabled !== false && tmpl.regions.length > 0 && (
                    <div className="w-1.5 h-1.5 rounded-full bg-white" />
                  )}
                </div>
              </div>

              {/* Thumbnail, fixed 16:9 container with centered image. Dimming lives
                  here (not on the name label below) so the label text keeps full
                  contrast even when the template is invalid/disabled. */}
              <div
                className={`relative w-full aspect-video bg-black/40 ${isDimmed ? "opacity-60" : ""}`}
              >
                <img
                  src={apiUrl(`/api/detector/${pokemonId}/template/${index}`)}
                  alt={tmpl.name || `Template ${index + 1}`}
                  className="absolute inset-0 w-full h-full object-contain"
                />
                {/* Invalid template overlay, shown when template has no regions */}
                {tmpl.regions.length === 0 && (
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 bg-accent-yellow/20 flex items-center justify-center rounded-none"
                  >
                    <div className="flex items-center gap-1.5 bg-black/70 px-2 py-1 rounded-none text-xs text-accent-yellow font-medium">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {t("templateEditor.templateInvalid")}
                    </div>
                  </div>
                )}
              </div>

              {/* Template name, read-only display */}
              <div className="px-1.5 py-0.5 bg-bg-primary">
                <span className="block text-[10px] text-text-secondary truncate">
                  {tmpl.name || `Template ${index + 1}`}
                </span>
              </div>
            </button>

            {/* Hover overlay with edit/delete buttons, hidden while detection is running */}
            {!isRunning && (
              <div className="absolute inset-0 bg-black/50 rounded-none opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 pointer-events-none">
                <button
                  type="button"
                  onClick={() => onEditTemplate(index)}
                  className="p-1.5 rounded-none bg-white/20 text-white hover:bg-accent-blue transition-colors pointer-events-auto"
                  title={t("detector.editTemplate")}
                  aria-label={t("detector.editTemplate")}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onRequestDelete({
                      index,
                      name: tmpl.name || `Template ${index + 1}`,
                    })
                  }
                  className="p-1.5 rounded-none bg-white/20 text-white hover:bg-accent-red transition-colors pointer-events-auto"
                  title={t("detector.deleteTemplate")}
                  aria-label={t("detector.deleteTemplate")}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  ) : (
    <p className="text-xs text-text-muted text-center py-4">{t("detector.noTemplates")}</p>
  );
}
