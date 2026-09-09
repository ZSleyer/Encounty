/**
 * UiLanguageMenu.tsx: Dropdown for the interface language.
 *
 * The locale list outgrew the segmented button row it used to be, so the
 * languages live in an anchored menu instead. A native <select> is not used
 * because every entry carries a flag and a machine-translation marker, neither
 * of which an <option> can hold.
 */
import { Bot, Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { LOCALES, type Locale } from "../../utils/i18n";
import { anchoredMenuStyle, anchorTriggerStyle, useAnchorName } from "../../utils/anchoredMenu";
import { CountryFlag } from "../shared/CountryFlag";

interface UiLanguageMenuProps {
  /** Currently active interface locale. */
  readonly locale: string;
  readonly onChange: (code: Locale) => void;
  /** Accessible name of the trigger, e.g. the settings row label. */
  readonly label: string;
  /** Tooltip suffix marking a machine-translated language. */
  readonly autoTranslatedLabel: string;
  /** Accessible name of the click-away backdrop. */
  readonly closeLabel: string;
}

/** Renders the interface-language dropdown. */
export function UiLanguageMenu({
  locale,
  onChange,
  label,
  autoTranslatedLabel,
  closeLabel,
}: UiLanguageMenuProps) {
  const [open, setOpen] = useState(false);
  const anchorName = useAnchorName("ui-lang");
  const active = LOCALES.find((l) => l.code === locale);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={label}
        style={anchorTriggerStyle(anchorName)}
        className="flex items-center gap-2 min-w-40 bg-bg-primary border border-border-subtle rounded-none px-3 py-1.5 text-xs text-text-primary hover:border-border-default transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
      >
        <CountryFlag code={locale} className="w-4 h-3" />
        <span className="flex-1 text-left">{active?.label ?? locale.toUpperCase()}</span>
        {active?.machineTranslated && (
          <Bot className="w-3 h-3 text-text-faint" role="img" aria-label={autoTranslatedLabel} />
        )}
        <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
      </button>
      {open && (
        <>
          <button
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
            aria-label={closeLabel}
          />
          <div
            aria-label={label}
            style={anchoredMenuStyle(anchorName, "below-end", true)}
            className="fixed z-50 bg-bg-secondary border border-border-subtle rounded-none shadow-lg py-1 overflow-y-auto"
          >
            {LOCALES.map((l) => (
              <button
                key={l.code}
                type="button"
                aria-pressed={locale === l.code}
                title={l.machineTranslated ? `${l.label} (${autoTranslatedLabel})` : l.label}
                onClick={() => {
                  onChange(l.code);
                  setOpen(false);
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-primary transition-colors"
              >
                <CountryFlag code={l.code} className="w-4 h-3" />
                <span className="flex-1 text-left">{l.label}</span>
                {l.machineTranslated && (
                  <Bot
                    className="w-3 h-3 text-text-faint"
                    role="img"
                    aria-label={autoTranslatedLabel}
                  />
                )}
                {locale === l.code && <Check className="w-3.5 h-3.5 text-accent-green" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
