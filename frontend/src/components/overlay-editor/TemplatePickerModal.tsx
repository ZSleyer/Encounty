/**
 * TemplatePickerModal.tsx: the list of ready-made overlay layouts.
 *
 * Picking an entry does not apply it. The editor asks for confirmation first,
 * because applying a template discards the current layout, so this component
 * only reports the choice upwards.
 *
 * Each row carries a wireframe preview of the layout next to its name and a
 * one-line description. The preview is decoration: it is hidden from assistive
 * technology, and the row's accessible name is built from the text instead.
 */
import { useMemo } from "react";
import { useI18n } from "../../contexts/I18nContext";
import type { OverlayElementBase, OverlaySettings } from "../../types";
import { DRAGGABLE_ELEMENT_KEYS } from "../../utils/overlayElements";
import { ModalShell } from "../shared/ModalShell";
import { buildTemplates, type OverlayTemplate } from "./overlayTemplates";

/** Width in px of the wireframe preview; the height follows the canvas ratio. */
const PREVIEW_WIDTH = 76;

/** Tallest preview we allow, so the 320x744 rail cannot stretch the row. */
const PREVIEW_MAX_HEIGHT = 60;

/**
 * TemplatePreview draws the visible element boxes of a layout as a scaled
 * wireframe: the canvas as a hairline plate, every visible element as a filled
 * block at its own position. It is purely decorative, so it is removed from the
 * accessibility tree.
 */
function TemplatePreview({ settings }: Readonly<{ settings: OverlaySettings }>) {
  const scale = Math.min(
    PREVIEW_WIDTH / settings.canvas_width,
    PREVIEW_MAX_HEIGHT / settings.canvas_height,
  );
  const boxes = DRAGGABLE_ELEMENT_KEYS.flatMap((key) => {
    const el = settings[key] as OverlayElementBase | undefined;
    return el?.visible ? [{ key, el }] : [];
  });

  return (
    <span
      aria-hidden="true"
      className="relative block shrink-0 bg-bg-primary border border-border-subtle"
      style={{
        width: settings.canvas_width * scale,
        height: settings.canvas_height * scale,
      }}
    >
      {boxes.map(({ key, el }) => (
        <span
          key={key}
          className={key === "sprite" ? "absolute bg-accent-blue/70" : "absolute bg-text-muted/70"}
          style={{
            left: el.x * scale,
            top: el.y * scale,
            // A sub-pixel block would disappear entirely, so every box keeps a
            // 1px floor and the wireframe stays readable at any canvas size.
            width: Math.max(1, el.width * scale),
            height: Math.max(1, el.height * scale),
          }}
        />
      ))}
    </span>
  );
}

/** Props for {@link TemplatePickerModal}. */
export interface TemplatePickerModalProps {
  /** Called with the picked template; the caller confirms before applying it. */
  readonly onSelect: (template: OverlayTemplate) => void;
  /** Called after the close transition finishes; unmount the modal here. */
  readonly onClose: () => void;
}

/** Lists every overlay template with a wireframe, its name and its canvas size. */
export function TemplatePickerModal({ onSelect, onClose }: Readonly<TemplatePickerModalProps>) {
  const { t } = useI18n();
  const templates = useMemo(() => buildTemplates(t), [t]);

  return (
    <ModalShell title={t("overlay.templatesTitle")} onClose={onClose} size="lg" titleSize="sm">
      {(requestClose) => (
        <ul className="space-y-2" aria-label={t("overlay.templatesTitle")}>
          {templates.map((template) => {
            const size = `${template.settings.canvas_width} × ${template.settings.canvas_height}`;
            return (
              <li key={template.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(template);
                    requestClose();
                  }}
                  // The outline is drawn inside the border on purpose: the modal
                  // body scrolls, and an outward offset would be clipped away at
                  // the first and last row (WCAG 2.2 SC 2.4.11).
                  className="w-full flex items-center gap-3 text-left px-3 py-2.5 rounded-none bg-bg-primary border border-border-subtle hover:border-accent-blue/60 hover:bg-bg-hover transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent-blue"
                >
                  <TemplatePreview settings={template.settings} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-semibold text-text-primary">
                        {t(template.nameKey)}
                      </span>
                      <span className="text-[10px] text-text-muted tabular-nums whitespace-nowrap">
                        {size}
                      </span>
                    </span>
                    <span className="block mt-0.5 text-xs text-text-secondary">
                      {t(template.descriptionKey)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </ModalShell>
  );
}
