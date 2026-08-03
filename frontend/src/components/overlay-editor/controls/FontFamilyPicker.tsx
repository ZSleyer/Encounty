/**
 * FontFamilyPicker.tsx: the font row of the text style editor.
 *
 * Offers three grouped sources (engine aliases, curated Google Fonts, the
 * families installed on this machine) plus a free-text field for anything else.
 *
 * Why a locally installed family still works in an OBS browser source: OBS
 * renders the overlay page on the same machine the font is installed on, so the
 * family name resolves through the system font set exactly like it does in the
 * editor. It does not travel with the overlay, which is why the hint warns
 * about browser sources running on someone else's machine.
 */
import { useId } from "react";
import { useI18n } from "../../../contexts/I18nContext";
import { useLocalFonts, type LocalFontStatus } from "../../../hooks/useLocalFonts";
import { ENGINE_FONT_ALIASES, GOOGLE_FONTS } from "../../../utils/fonts";

/** Translation function signature, mirrored from the I18n context. */
type TranslateFn = (key: string, options?: Record<string, string | number>) => string;

/** Shared CSS of the picker's select and text input. */
const CONTROL_CLASS =
  "w-full bg-bg-secondary border border-border-subtle rounded-none px-2.5 py-1.5 text-xs text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue";

/** statusMessage returns the polite announcement for the local font state. */
function statusMessage(status: LocalFontStatus, count: number, t: TranslateFn): string {
  if (status === "granted") return t("overlay.fontLocalLoaded", { n: count });
  if (status === "empty") return t("overlay.fontLocalNone");
  if (status === "denied") return t("overlay.fontLocalDenied");
  return "";
}

/**
 * FontFamilyPicker lets the user choose a font family from the curated groups,
 * from the fonts installed on this machine, or by typing a family name.
 */
export function FontFamilyPicker({
  value,
  onChange,
}: Readonly<{
  value: string;
  onChange: (family: string) => void;
}>) {
  const { t } = useI18n();
  const { families, supported, status, request } = useLocalFonts();
  const id = useId();
  const selectId = `${id}-font-family`;
  const customId = `${id}-font-custom`;
  const hintId = `${id}-font-hint`;

  const isListed =
    (ENGINE_FONT_ALIASES as readonly string[]).includes(value) ||
    (GOOGLE_FONTS as readonly string[]).includes(value) ||
    families.includes(value);
  const message = statusMessage(status, families.length, t);

  return (
    <div className="space-y-1">
      <label className="block" htmlFor={selectId}>
        <span className="text-xs text-text-muted">{t("overlay.fontFamily")}</span>
        <select
          id={selectId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={CONTROL_CLASS}
        >
          <optgroup label={t("overlay.fontGroupBuiltIn")}>
            {ENGINE_FONT_ALIASES.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </optgroup>
          <optgroup label={t("overlay.fontGroupGoogle")}>
            {GOOGLE_FONTS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </optgroup>
          {families.length > 0 && (
            <optgroup label={t("overlay.fontGroupLocal")}>
              {families.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </optgroup>
          )}
          {!isListed && (
            <optgroup label={t("overlay.fontGroupCustom")}>
              <option value={value}>{value}</option>
            </optgroup>
          )}
        </select>
      </label>

      {/* Only advertised where the API exists, and only until it delivered. */}
      {supported && status !== "granted" && (
        <button
          type="button"
          onClick={request}
          className="w-full px-2.5 py-1.5 rounded-none text-xs bg-bg-primary hover:bg-bg-hover text-text-secondary hover:text-text-primary border border-border-subtle transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
        >
          {t("overlay.fontUseSystem")}
        </button>
      )}

      {/* Rendered even while empty so the region exists before it updates. */}
      <p role="status" className="text-xs text-text-muted leading-snug">
        {message}
      </p>

      <label className="block" htmlFor={customId}>
        <span className="text-xs text-text-muted">{t("overlay.fontCustom")}</span>
        <input
          id={customId}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t("overlay.fontCustom")}
          aria-describedby={hintId}
          className={CONTROL_CLASS}
        />
      </label>
      <p id={hintId} className="text-xs text-text-muted leading-snug">
        {t("overlay.fontLocalHint")}
      </p>
    </div>
  );
}
