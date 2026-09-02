/**
 * Field groups shared by the value layers of the overlay property panel: the
 * optional prefix and suffix drawn around a value, and the optional label with
 * its own text style.
 */
import { TextStyle } from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { PanelSection } from "./controls/PanelSection";
import { BASE_TEXT_STYLE as DEFAULT_TEXT_STYLE } from "./overlayTemplates";
import { TextStyleEditor } from "./TextStyleEditor";
import { TEXT_INPUT_CLASS } from "./panelStyles";
import type { StyleEditorOpeners } from "./propertyPanelTypes";

/**
 * AffixFields renders the optional prefix and suffix inputs of a value layer.
 * Both strings are drawn inside the value's own span, so they inherit its text
 * style instead of the label style. An empty field is the off state, which is
 * why the group carries no toggle.
 */
export function AffixFields({
  idPrefix,
  prefixText,
  suffixText,
  onChange,
}: Readonly<{
  /** Element key the input ids are derived from, so they stay unique per layer. */
  idPrefix: string;
  prefixText: string;
  suffixText: string;
  onChange: (patch: { prefix_text?: string; suffix_text?: string }) => void;
}>) {
  const { t } = useI18n();
  const hintId = `${idPrefix}-affix-hint`;
  return (
    // The wrapper only exists to carry the tutorial anchor: the section itself
    // collapses, and the walkthrough still has to be able to point at it.
    <div data-tutorial="affixes">
      <PanelSection title={t("overlay.affixGroup")}>
        <div>
          <label htmlFor={`${idPrefix}-prefix-text`} className="text-xs text-text-muted">
            {t("overlay.prefixText")}
          </label>
          <input
            id={`${idPrefix}-prefix-text`}
            type="text"
            value={prefixText ?? ""}
            onChange={(e) => onChange({ prefix_text: e.target.value })}
            className={`${TEXT_INPUT_CLASS} mt-0.5`}
            placeholder={t("overlay.prefixText")}
            aria-label={t("aria.prefixText")}
            aria-describedby={hintId}
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-suffix-text`} className="text-xs text-text-muted">
            {t("overlay.suffixText")}
          </label>
          <input
            id={`${idPrefix}-suffix-text`}
            type="text"
            value={suffixText ?? ""}
            onChange={(e) => onChange({ suffix_text: e.target.value })}
            className={`${TEXT_INPUT_CLASS} mt-0.5`}
            placeholder={t("overlay.suffixText")}
            aria-label={t("aria.suffixText")}
            aria-describedby={hintId}
          />
        </div>
        <p id={hintId} className="text-xs text-text-muted leading-snug">
          {t("overlay.affixHint")}
        </p>
      </PanelSection>
    </div>
  );
}

/**
 * LabelFields renders the optional label of a value layer: the toggle, and when
 * it is on the label text plus the label's own text style.
 */
export function LabelFields({
  show,
  text,
  style,
  onChange,
  onOpenTextColorEditor,
  onOpenOutlineEditor,
  onOpenShadowEditor,
}: Readonly<
  StyleEditorOpeners & {
    show: boolean;
    text: string;
    style: TextStyle | undefined;
    onChange: (patch: {
      show_label?: boolean;
      label_text?: string;
      label_style?: TextStyle;
    }) => void;
  }
>) {
  const { t } = useI18n();
  return (
    <>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={show}
          onChange={(e) => onChange({ show_label: e.target.checked })}
          className="accent-accent-blue"
        />
        <span className="text-xs 2xl:text-sm text-text-secondary">{t("overlay.showLabel")}</span>
      </label>
      {show && (
        <>
          <input
            type="text"
            value={text}
            onChange={(e) => onChange({ label_text: e.target.value })}
            className={TEXT_INPUT_CLASS}
            placeholder={t("overlay.labelText")}
            aria-label={t("aria.labelText")}
          />
          <TextStyleEditor
            style={style || DEFAULT_TEXT_STYLE}
            label={t("overlay.labelStyle")}
            onChange={(s) => onChange({ label_style: s })}
            onOpenTextColorEditor={onOpenTextColorEditor}
            onOpenOutlineEditor={onOpenOutlineEditor}
            onOpenShadowEditor={onOpenShadowEditor}
          />
        </>
      )}
    </>
  );
}
