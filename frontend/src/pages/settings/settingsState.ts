/**
 * settingsState.ts: Pure updates applied to the settings draft held by the page.
 *
 * The two appearance helpers also touch the document element, because the
 * matching CSS hooks off data attributes rather than off React state.
 */

import { AccentColor, Settings as SettingsType } from "../../types";

/** Apply crisp-sprites DOM attribute and update settings state. */
export function applyCrispSprites(
  v: boolean,
  setSettings: (updater: (s: SettingsType | null) => SettingsType | null) => void,
): void {
  setSettings((s) => (s ? { ...s, crisp_sprites: v } : s));
  if (v) {
    document.documentElement.dataset.crispSprites = "";
  } else {
    delete document.documentElement.dataset.crispSprites;
  }
}

/** Apply the chosen accent color preset and update settings state. */
export function applyAccentColor(
  v: AccentColor,
  setSettings: (updater: (s: SettingsType | null) => SettingsType | null) => void,
): void {
  setSettings((s) => (s ? { ...s, accent_color: v } : s));
  document.documentElement.dataset.accent = v;
}
