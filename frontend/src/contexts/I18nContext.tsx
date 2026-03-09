/**
 * I18nContext.tsx — Internationalisation context providing locale state
 * and a `t(key)` translation helper to the component tree.
 *
 * The locale is persisted to localStorage under "encounty-locale" and
 * reflected on `document.documentElement.lang` for accessibility.
 * Supported locales: "de" (default) and "en".
 */
import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { Locale, t as translate } from "../utils/i18n";

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: "de",
  setLocale: () => {},
  t: (key) => key,
});

/** I18nProvider wraps the app with locale state and a translation function. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => {
    const saved = localStorage.getItem("encounty-locale");
    return (saved === "en" ? "en" : "de") as Locale;
  });

  useEffect(() => {
    localStorage.setItem("encounty-locale", locale);
    document.documentElement.lang = locale;
  }, [locale]);

  const t = (key: string) => translate(locale, key);

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

/** useI18n returns the current locale, a locale setter, and the `t` translator. */
export function useI18n() {
  return useContext(I18nContext);
}
