/**
 * LanguageMenu.tsx: Reusable language picker, an anchored dropdown over a
 * given set of language codes.
 *
 * A native <select> is not used because each entry carries a country flag,
 * which an <option> cannot hold.
 */
import { Check, ChevronDown, Globe } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../../contexts/I18nContext";
import { anchoredMenuStyle, anchorTriggerStyle } from "../../utils/anchoredMenu";
import { ALL_LANGUAGES } from "../../utils/games";
import { CountryFlag } from "../shared/CountryFlag";

interface LanguageMenuProps {
  /** Currently picked language code. Empty string means "auto" when `autoLabel` is set. */
  readonly language: string;
  /** Language codes to offer, in display order. */
  readonly availableLangs: readonly string[];
  /** Anchor name of the trigger; owned by the form so the id stays stable. */
  readonly anchorName: string;
  readonly onChange: (language: string) => void;
  /**
   * When set, prepends a pseudo-option (value `""`) for "no override", shown
   * with a globe icon and this label instead of a flag and language name.
   */
  readonly autoLabel?: string;
  /** Visible label and accessible name. Defaults to the generic "Language" text. */
  readonly label?: string;
}

/** Renders the labeled language dropdown. */
export function LanguageMenu({
  language,
  availableLangs,
  anchorName,
  onChange,
  autoLabel,
  label,
}: LanguageMenuProps) {
  const { t } = useI18n();
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const isAuto = autoLabel !== undefined && language === "";
  const resolvedLabel = label ?? t("modal.language");
  return (
    <div className="w-full">
      <label className="flex items-center gap-2 mb-2">
        <Globe className="w-3.5 h-3.5 text-text-muted" />
        <span className="text-xs text-text-muted">{resolvedLabel}</span>
      </label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setLangMenuOpen((v) => !v)}
          aria-expanded={langMenuOpen}
          aria-haspopup="true"
          aria-label={resolvedLabel}
          style={anchorTriggerStyle(anchorName)}
          className="flex items-center gap-2 w-full bg-bg-primary border border-border-subtle rounded-none px-3 py-2 text-sm text-text-primary hover:border-border-default transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
        >
          {isAuto ? (
            <Globe className="w-3.5 h-3.5 text-text-muted" />
          ) : (
            <CountryFlag code={language} />
          )}
          <span className="flex-1 text-left">
            {isAuto
              ? autoLabel
              : (ALL_LANGUAGES.find((l) => l.code === language)?.label ?? language.toUpperCase())}
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
        </button>
        {langMenuOpen && (
          <>
            <button
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setLangMenuOpen(false)}
              aria-label={t("aria.close")}
            />
            <div
              aria-label={resolvedLabel}
              style={anchoredMenuStyle(anchorName, "above-start", true)}
              className="fixed z-50 bg-bg-secondary border border-border-subtle rounded-none shadow-lg py-1 overflow-y-auto"
            >
              {autoLabel !== undefined && (
                <button
                  type="button"
                  aria-pressed={language === ""}
                  onClick={() => {
                    onChange("");
                    setLangMenuOpen(false);
                  }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-primary transition-colors"
                >
                  <Globe className="w-4 h-3" />
                  <span className="flex-1 text-left">{autoLabel}</span>
                  {language === "" && <Check className="w-3.5 h-3.5 text-accent-green" />}
                </button>
              )}
              {availableLangs.map((lang) => {
                const info = ALL_LANGUAGES.find((l) => l.code === lang);
                return (
                  <button
                    key={lang}
                    type="button"
                    aria-pressed={language === lang}
                    onClick={() => {
                      onChange(lang);
                      setLangMenuOpen(false);
                    }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-primary transition-colors"
                  >
                    <CountryFlag code={lang} className="w-4 h-3" />
                    <span className="flex-1 text-left">{info?.label ?? lang.toUpperCase()}</span>
                    {language === lang && <Check className="w-3.5 h-3.5 text-accent-green" />}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
