/**
 * i18n.ts — Re-export shim for backward compatibility.
 *
 * The translation system has moved to react-i18next with locale JSON files
 * in src/locales/. This file re-exports the types and constants so that
 * existing imports from "../utils/i18n" continue to work.
 */
export { LOCALES, type Locale, MACHINE_TRANSLATED_LOCALES } from "../locales";
export { default } from "../locales";
