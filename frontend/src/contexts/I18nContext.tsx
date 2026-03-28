/**
 * I18nContext.tsx — Internationalisation context wrapping react-i18next.
 *
 * Provides the same `useI18n()` API as before so that existing consumers
 * require zero import changes: `const { t, locale, setLocale } = useI18n()`.
 * The locale is persisted to localStorage and reflected on
 * `document.documentElement.lang` for accessibility.
 */
import { createContext, useContext, useEffect, useMemo, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { MACHINE_TRANSLATED_LOCALES, type Locale } from "../locales";

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, options?: Record<string, string | number>) => string;
  isMachineTranslated: boolean;
}

const I18nContext = createContext<I18nContextValue>({
  locale: "de",
  setLocale: () => {},
  t: (key) => key,
  isMachineTranslated: false,
});

/** I18nProvider wraps the app with locale state and a translation function. */
export function I18nProvider({ children }: Readonly<{ children: ReactNode }>) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.language || "de") as Locale;

  const setLocale = (l: Locale) => {
    void i18n.changeLanguage(l);
    localStorage.setItem("encounty-locale", l);
  };

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const isMachineTranslated = MACHINE_TRANSLATED_LOCALES.has(locale);

  const value = useMemo(
    () => ({ locale, setLocale, t, isMachineTranslated }),
    [locale, t, isMachineTranslated],
  );

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
}

/** useI18n returns the current locale, a locale setter, and the `t` translator. */
export function useI18n() {
  return useContext(I18nContext);
}

// Re-export for backward compatibility
export { LOCALES, type Locale } from "../locales";
