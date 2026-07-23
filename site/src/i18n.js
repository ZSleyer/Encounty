// Client-side i18n for the static marketing site (landing, update, changelog).
// System-language detection with a persisted manual override, applied to the
// DOM via [data-i18n] / [data-i18n-attr] hooks. Translations only ever set
// textContent or attributes, never innerHTML, so a dictionary string can never
// be reinterpreted as markup. Dictionaries are flat key -> string maps that
// mirror the app's frontend/src/locales style.

import en from "./locales/en.json";
import de from "./locales/de.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import ja from "./locales/ja.json";

/** Language codes this site ships translations for, in display order. */
export const SUPPORTED_LANGS = ["en", "de", "es", "fr", "ja"];

/** Loaded flat dictionaries keyed by language code. */
const DICTS = { en, de, es, fr, ja };

/** localStorage key holding the visitor's manual language choice. */
const STORAGE_KEY = "encounty-lang";

/**
 * Resolves the initial language: a valid saved choice wins, otherwise the
 * first browser-preferred language whose 2-letter prefix is supported, else
 * English.
 * @returns {string} A supported language code.
 */
function resolveInitialLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SUPPORTED_LANGS.includes(saved)) return saved;
  } catch {
    // localStorage may be unavailable (private mode, blocked cookies).
  }
  const prefs = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const pref of prefs) {
    if (!pref) continue;
    const prefix = pref.slice(0, 2).toLowerCase();
    if (SUPPORTED_LANGS.includes(prefix)) return prefix;
  }
  return "en";
}

let currentLang = resolveInitialLang();

/**
 * Returns the currently active language code.
 * @returns {string} A supported language code.
 */
export function getLang() {
  return currentLang;
}

/**
 * Persists and applies a new language. Ignores unsupported codes.
 * @param {string} lang A language code to switch to.
 */
export function setLang(lang) {
  if (!SUPPORTED_LANGS.includes(lang)) return;
  currentLang = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Non-fatal: the choice just will not persist across reloads.
  }
  applyI18n();
}

/**
 * Looks up a translation for the current language, falling back to English
 * and then to the key itself when a string is missing.
 * @param {string} key A dotted translation key.
 * @returns {string} The resolved string.
 */
export function t(key) {
  const dict = DICTS[currentLang] || DICTS.en;
  if (key in dict) return dict[key];
  if (key in DICTS.en) return DICTS.en[key];
  return key;
}

/**
 * Applies the current language across a DOM subtree: sets the document
 * language, fills [data-i18n] text and [data-i18n-attr] attributes, updates
 * the page title and meta description from the body's data-page, and syncs the
 * language switcher value.
 * @param {Document|Element} [root=document] Subtree to translate.
 */
export function applyI18n(root = document) {
  document.documentElement.lang = currentLang;

  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });

  root.querySelectorAll("[data-i18n-attr]").forEach((el) => {
    for (const pair of el.getAttribute("data-i18n-attr").split(";")) {
      const [attr, key] = pair.split(":");
      if (attr && key) el.setAttribute(attr.trim(), t(key.trim()));
    }
  });

  const page = document.body?.dataset.page;
  if (page) {
    document.title = t(`meta.${page}.title`);
    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute("content", t(`meta.${page}.desc`));
  }

  const select = document.getElementById("lang-select");
  if (select && select.value !== currentLang) select.value = currentLang;

  // Mirror the app's auto-translated marker: every language except German
  // (the source language) is machine-translated and gets the robot badge.
  const badge = document.getElementById("mt-badge");
  if (badge) badge.hidden = currentLang === "de";
}

/**
 * Wires the header language <select> (if present) to setLang. Call once after
 * the DOM is ready; applyI18n keeps its value in sync afterwards.
 */
export function initLangSwitcher() {
  const select = document.getElementById("lang-select");
  if (!select) return;
  select.value = currentLang;
  select.addEventListener("change", () => setLang(select.value));
}

/**
 * Maps a supported language code to a BCP 47 locale for date formatting.
 * Latin-script languages keep a day-month-year presentation; Japanese uses
 * its own locale.
 * @param {string} [lang=getLang()] Language code.
 * @returns {string} A BCP 47 locale tag.
 */
export function dateLocale(lang = currentLang) {
  const LOCALES = { en: "en-GB", de: "de-DE", es: "es-ES", fr: "fr-FR", ja: "ja-JP" };
  return LOCALES[lang] || "en-GB";
}
