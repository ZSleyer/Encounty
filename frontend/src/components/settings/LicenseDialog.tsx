/**
 * LicenseDialog.tsx — First-launch license acceptance dialog for AGPLv3.
 *
 * Shown once on first startup. The user must scroll through the full original
 * AGPLv3 text and accept before using the app. Switching language also updates
 * the app locale. Acceptance is persisted via the backend state.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Scale, ChevronDown } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import { useModalA11y } from "../../hooks/useModalA11y";
import { LOCALES, type Locale } from "../../utils/i18n";
import { AGPLV3_LICENSE } from "../../utils/agplv3";
import { apiUrl } from "../../utils/api";
import { CountryFlag } from "../shared/CountryFlag";

/** Accept the license via the backend API. */
async function acceptLicenseAPI(): Promise<void> {
  await fetch(apiUrl("/api/license/accept"), { method: "POST" });
}

interface LicenseDialogProps {
  readonly onAccept: () => void;
}

/** LicenseDialog — blocking overlay requiring AGPLv3 acceptance. */
export function LicenseDialog({ onAccept }: Readonly<LicenseDialogProps>) {
  const { locale, setLocale, t } = useI18n();
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Focus trap for the blocking overlay. Escape is deliberately inert: the
  // license gate must not be dismissible without acceptance.
  const containerRef = useModalA11y<HTMLDivElement>({ isOpen: true, onClose: () => {} });

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottom) setHasScrolledToBottom(true);
  }, []);

  // Auto-accept if content fits without scrolling
  useEffect(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el) return;
      if (el.scrollHeight <= el.clientHeight + 40) {
        setHasScrolledToBottom(true);
      }
    });
  }, []);

  const handleAccept = async () => {
    await acceptLicenseAPI();
    onAccept();
  };

  const switchLocale = (code: Locale) => {
    setLocale(code);
  };

  return createPortal(
    <div
      ref={containerRef}
      tabIndex={-1}
      className="fixed inset-0 z-200 bg-bg-primary flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="license-title"
    >
      <div className="t-panel anim-t-crt-in shadow-2xl w-full max-w-2xl h-[min(90vh,720px)] flex flex-col">
        {/* Header */}
        <div className="px-8 pt-8 pb-4 flex flex-col items-center gap-4 shrink-0">
          <div className="flex items-center gap-4">
            <img
              src="/app-icon.png"
              alt="Encounty"
              className="w-12 h-12 rounded-none object-contain"
            />
            <div>
              <h1 id="license-title" className="text-xl font-bold text-text-primary">
                Encounty
              </h1>
              <p className="text-xs text-text-muted">{t("license.subtitle")}</p>
            </div>
          </div>

          {/* Language switcher */}
          <div className="flex gap-2">
            {LOCALES.map((l) => (
              <button
                key={l.code}
                onClick={() => switchLocale(l.code)}
                aria-pressed={locale === l.code}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-none text-xs font-medium transition-colors ${
                  locale === l.code
                    ? "bg-accent-blue text-bg-primary"
                    : "bg-bg-hover text-text-muted hover:text-text-primary"
                }`}
              >
                <CountryFlag code={l.code} />
                {l.label}
              </button>
            ))}
          </div>
        </div>

        {/* Summary line */}
        <div className="px-8 pb-3 shrink-0">
          <div className="flex items-start gap-3 p-4 rounded-none bg-accent-blue/5 border border-accent-blue/10">
            <Scale className="w-5 h-5 text-accent-blue shrink-0 mt-0.5" />
            <p className="text-sm text-text-secondary leading-relaxed">
              {t("license.summary")}
            </p>
          </div>
        </div>

        {/* Trademark disclaimer */}
        <div className="px-8 pb-2 shrink-0">
          <p className="text-[10px] text-text-faint leading-relaxed">
            {t("licenses.trademark")}
          </p>
        </div>

        {/* Scrollable full original license text */}
        <div className="px-8 flex-1 min-h-0 overflow-hidden relative">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            tabIndex={0}
            role="region"
            aria-label={t("aria.licenseText")}
            className="h-full overflow-y-auto rounded-none bg-bg-primary border border-border-subtle p-4 text-xs text-text-muted font-mono whitespace-pre-wrap leading-relaxed"
          >
            {AGPLV3_LICENSE}
          </div>

          {/* Scroll hint overlaid at bottom-center of license area */}
          {!hasScrolledToBottom && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 animate-bounce pointer-events-none">
              <ChevronDown className="w-5 h-5 text-text-muted drop-shadow-lg" />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-8 py-6 flex flex-col gap-3 shrink-0">
          <button
            onClick={handleAccept}
            disabled={!hasScrolledToBottom}
            className={`w-full py-3 rounded-none text-sm font-semibold transition-all ${
              hasScrolledToBottom
                ? "t-cut bg-accent-blue hover:bg-accent-blue/80 text-bg-primary shadow-lg shadow-accent-blue/20"
                : "bg-bg-hover text-text-faint cursor-not-allowed"
            }`}
          >
            {t("license.accept")}
          </button>
          <p className="text-center text-[10px] text-text-faint">
            {t("license.hint")}
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
