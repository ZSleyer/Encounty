/**
 * games.ts — Utility functions and constants for working with the Pokémon
 * game catalogue. Handles localised name lookup with language fallback chains.
 */
import { GameEntry } from "../types";

/**
 * Language fallback chains.
 * When a specific code isn't found, we try its parents before giving up.
 */
const FALLBACKS: Record<string, string[]> = {
  "es-es": ["es"],
  "es-419": ["es"],
  "pt-br": ["pt"],
  "zh-hant": ["zh-hans"],
};

/**
 * Returns the best available game name for the given language priority list,
 * respecting fallback chains (e.g. es-es → es).
 * Falls back to English, then the first available name, then the key itself.
 */
export function getGameName(game: GameEntry, languages: string[]): string {
  for (const lang of languages) {
    // Try the exact code first
    if (game.names[lang]) return game.names[lang];
    // Then try fallbacks for this code
    for (const fb of FALLBACKS[lang] ?? []) {
      if (game.names[fb]) return game.names[fb];
    }
  }
  return game.names["en"] ?? Object.values(game.names)[0] ?? game.key;
}

/** All language codes that Pokémon games have ever been released in, in display order. */
export const ALL_LANGUAGES: { code: string; label: string; flag: string }[] = [
  { code: "de", label: "Deutsch", flag: "🇩🇪" },
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "it", label: "Italiano", flag: "🇮🇹" },
  { code: "es-es", label: "Español (España)", flag: "🇪🇸" },
  { code: "es-419", label: "Español (Latinoamérica)", flag: "🌎" },
  { code: "pt-br", label: "Português (BR)", flag: "🇧🇷" },
  { code: "ja", label: "日本語", flag: "🇯🇵" },
  { code: "ko", label: "한국어", flag: "🇰🇷" },
  { code: "zh-hans", label: "中文（简体）", flag: "🇨🇳" },
  { code: "zh-hant", label: "中文（繁體）", flag: "🇹🇼" },
];
