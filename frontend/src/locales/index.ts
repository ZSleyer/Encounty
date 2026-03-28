/**
 * locales/index.ts — i18next initialization with bundled translations.
 *
 * All translations are imported synchronously so the UI is ready on
 * first render without any loading flicker.
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import de from "./de.json";
import en from "./en.json";
import fr from "./fr.json";
import es from "./es.json";
import ja from "./ja.json";

/** Languages where translations are machine-generated and not human-verified. */
export const MACHINE_TRANSLATED_LOCALES = new Set(["en", "fr", "es", "ja"]);

export type Locale = "de" | "en" | "fr" | "es" | "ja";

export const LOCALES: { code: Locale; label: string; flag: string; machineTranslated: boolean }[] = [
  { code: "de", label: "Deutsch", flag: "🇩🇪", machineTranslated: false },
  { code: "en", label: "English", flag: "🇬🇧", machineTranslated: true },
  { code: "fr", label: "Français", flag: "🇫🇷", machineTranslated: true },
  { code: "es", label: "Español", flag: "🇪🇸", machineTranslated: true },
  { code: "ja", label: "日本語", flag: "🇯🇵", machineTranslated: true },
];

const saved = localStorage.getItem("encounty-locale");
const validLocales = LOCALES.map((l) => l.code);
const fallbackLng = "de";

i18n.use(initReactI18next).init({
  resources: {
    de: { translation: de },
    en: { translation: en },
    fr: { translation: fr },
    es: { translation: es },
    ja: { translation: ja },
  },
  lng: saved && validLocales.includes(saved as Locale) ? saved : fallbackLng,
  fallbackLng,
  keySeparator: false,
  nsSeparator: false,
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
