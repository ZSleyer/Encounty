/**
 * Layers panel of the overlay editor: the stacking list of the draggable
 * elements plus the canvas pseudo layer, with the per-layer selection,
 * reordering and visibility controls and the header shortcuts to the template
 * picker and the layout reset.
 */
import { Eye, EyeOff, ChevronUp, ChevronDown, RotateCcw, LayoutTemplate } from "lucide-react";
import { OverlaySettings, OverlayElementBase } from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { buildDefaultOverlaySettings } from "./overlayTemplates";
import {
  DRAGGABLE_ELEMENT_KEYS,
  getElementLabels,
  type ElementKey,
} from "../../utils/overlayElements";

/**
 * LayersPanel lists every overlay layer bottom-up and owns the controls that
 * change a layer's order or visibility.
 */
export function LayersPanel({
  localSettings,
  selectedEl,
  onSelectElement,
  update,
  onShowTemplates,
}: Readonly<{
  localSettings: OverlaySettings;
  selectedEl: ElementKey;
  onSelectElement: (key: ElementKey) => void;
  update: (settings: OverlaySettings) => void;
  onShowTemplates: () => void;
}>) {
  const { t } = useI18n();
  const ELEMENT_LABELS = getElementLabels(t);

  const moveLayer = (key: ElementKey, dir: "up" | "down") => {
    if (key === "canvas") return;
    const el = localSettings[key] as OverlayElementBase;
    const delta = dir === "up" ? 1 : -1;
    update({
      ...localSettings,
      [key]: { ...el, z_index: Math.max(0, el.z_index + delta) },
    });
  };

  return (
    <div data-tutorial="layers" className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-1">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider">
          {t("overlay.layers")}
        </h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onShowTemplates()}
            data-tutorial="templates"
            title={t("overlay.templatesTitle")}
            aria-label={t("overlay.templatesTitle")}
            className="flex items-center gap-1 px-1 py-0.5 rounded-none text-[10px] text-text-muted hover:text-accent-blue hover:bg-accent-blue/10 transition-colors relative after:absolute after:-inset-2 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-blue"
          >
            <LayoutTemplate className="w-3 h-3" />
          </button>
          <button
            onClick={() => update(buildDefaultOverlaySettings(t))}
            title={t("tooltip.editor.resetLayout")}
            className="flex items-center gap-1 px-1 py-0.5 rounded-none text-[10px] text-text-muted hover:text-accent-red hover:bg-accent-red/10 transition-colors relative after:absolute after:-inset-2 after:content-['']"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        </div>
      </div>
      {DRAGGABLE_ELEMENT_KEYS.map((key) => {
        const el = localSettings[key] as OverlayElementBase;
        return (
          <div
            key={key}
            className={`flex items-center justify-between px-2 py-1.5 rounded-none transition-colors w-full ${
              selectedEl === key
                ? "bg-accent-blue/20 border border-accent-blue/40"
                : "hover:bg-bg-hover border border-transparent"
            }`}
          >
            <button
              type="button"
              onClick={() => onSelectElement(key)}
              className="flex-1 text-left cursor-pointer bg-transparent border-none p-0"
              aria-label={ELEMENT_LABELS[key]}
            >
              <span className="text-xs text-text-primary">{ELEMENT_LABELS[key]}</span>
            </button>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                title={t("tooltip.editor.moveUp")}
                aria-label={t("tooltip.editor.moveUp")}
                onClick={() => moveLayer(key, "up")}
                className="p-1.5 text-text-muted hover:text-text-primary transition-colors"
              >
                <ChevronUp className="w-3 h-3" />
              </button>
              <button
                type="button"
                title={t("tooltip.editor.moveDown")}
                aria-label={t("tooltip.editor.moveDown")}
                onClick={() => moveLayer(key, "down")}
                className="p-1.5 text-text-muted hover:text-text-primary transition-colors"
              >
                <ChevronDown className="w-3 h-3" />
              </button>
              <button
                type="button"
                title={el.visible ? t("tooltip.editor.hide") : t("tooltip.editor.show")}
                aria-label={el.visible ? t("tooltip.editor.hide") : t("tooltip.editor.show")}
                onClick={() => {
                  update({
                    ...localSettings,
                    [key]: { ...el, visible: !el.visible },
                  });
                }}
                className="p-1.5 text-text-muted hover:text-text-primary transition-colors"
              >
                {el.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
              </button>
            </div>
          </div>
        );
      })}

      {/* Canvas layer, always at bottom */}
      <div
        className={`flex items-center justify-between px-2 py-1.5 rounded-none transition-colors w-full ${
          selectedEl === "canvas"
            ? "bg-accent-blue/20 border border-accent-blue/40"
            : "hover:bg-bg-hover border border-transparent"
        }`}
      >
        <button
          type="button"
          onClick={() => onSelectElement("canvas")}
          className="flex-1 text-left cursor-pointer bg-transparent border-none p-0"
          aria-label="Canvas"
        >
          <span className="text-xs text-text-primary">Canvas</span>
        </button>
        <div className="flex items-center gap-0.5">
          <span className="p-1 text-text-faint cursor-not-allowed">
            <ChevronUp className="w-3 h-3" />
          </span>
          <span className="p-1 text-text-faint cursor-not-allowed">
            <ChevronDown className="w-3 h-3" />
          </span>
          <button
            type="button"
            title={localSettings.hidden ? t("tooltip.editor.show") : t("tooltip.editor.hide")}
            aria-label={localSettings.hidden ? t("tooltip.editor.show") : t("tooltip.editor.hide")}
            onClick={() => update({ ...localSettings, hidden: !localSettings.hidden })}
            className="p-1.5 text-text-muted hover:text-text-primary transition-colors"
          >
            {localSettings.hidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          </button>
        </div>
      </div>
    </div>
  );
}
