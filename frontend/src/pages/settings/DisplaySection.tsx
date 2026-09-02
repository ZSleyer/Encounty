/**
 * DisplaySection.tsx: Appearance settings, meaning theme, UI language, zoom,
 * crisp sprites, reduced motion and the accent color picker.
 */

import { Globe, Image, Sun, Moon, Bot } from "lucide-react";

import { Settings as SettingsType, AccentColor, ACCENT_COLORS } from "../../types";
import { useMotion } from "../../contexts/ThemeContext";
import { UiZoomSetting } from "../../components/settings/UiZoomSetting";
import { LOCALES } from "../../utils/i18n";
import type { Locale } from "../../locales";
import { Toggle } from "../../components/shared/Toggle";

/**
 * Visual swatch hex per accent preset. The actual --accent-blue values applied
 * by the app live in index.css; this map only powers the picker buttons. Use
 * the dark-mode value so the swatch reads well against the card background.
 */
const ACCENT_SWATCH: Record<AccentColor, string> = {
  violet: "#a685f0",
  acid: "#c8e04a",
  crimson: "#f0507a",
  cyan: "#3fd4e0",
  blue: "#7ab8ff",
  green: "#3fe08c",
  pink: "#f47ad0",
  orange: "#ffa14a",
};

/**
 * DisplaySection renders the appearance card of the settings page: theme
 * switch, UI language, interface zoom, crisp sprites, reduced motion and the
 * accent color picker.
 */
export function DisplaySection({
  settings,
  theme,
  toggleTheme,
  locale,
  setLocale,
  setCrispSprites,
  setAccentColor,
  t,
}: Readonly<{
  settings: SettingsType;
  theme: string;
  toggleTheme: () => void;
  locale: string;
  setLocale: (code: Locale) => void;
  setCrispSprites: (v: boolean) => void;
  setAccentColor: (v: AccentColor) => void;
  t: (key: string) => string;
}>) {
  const activeAccent = settings.accent_color ?? "violet";
  // Local (per-device) preference, persisted in localStorage rather than the
  // backend settings payload, hence not part of the auto-save flow.
  const { motion, setMotion } = useMotion();
  return (
    <section className="glass-card rounded-none p-6 space-y-5">
      <h2 className="text-sm 2xl:text-base font-semibold text-text-primary flex items-center gap-2">
        <Image className="w-4 h-4 text-accent-blue" />
        {t("settings.sectionDisplay")}
      </h2>

      {/* Theme */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-text-primary flex items-center gap-2">
            {theme === "dark" ? (
              <Moon className="w-3.5 h-3.5 text-accent-blue" />
            ) : (
              <Sun className="w-3.5 h-3.5 text-accent-yellow" />
            )}
            {t("settings.themeDark")} / {t("settings.themeLight")}
          </p>
        </div>
        <div className="flex items-center border border-border-subtle rounded-none overflow-hidden">
          <button
            onClick={() => {
              if (theme !== "dark") toggleTheme();
            }}
            aria-label={t("settings.themeDark")}
            aria-pressed={theme === "dark"}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              theme === "dark"
                ? "bg-accent-blue/15 text-accent-blue"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            <Moon className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              if (theme !== "light") toggleTheme();
            }}
            aria-label={t("settings.themeLight")}
            aria-pressed={theme === "light"}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              theme === "light"
                ? "bg-accent-blue/15 text-accent-blue"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            <Sun className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="border-t border-border-subtle/50" />

      {/* UI Language */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-text-primary flex items-center gap-2">
            <Globe className="w-3.5 h-3.5 text-accent-blue" />
            {t("settings.uiLanguage") || "UI Language"}
          </p>
        </div>
        <div className="flex items-center border border-border-subtle rounded-none overflow-hidden">
          {LOCALES.map((l) => (
            <button
              key={l.code}
              onClick={() => setLocale(l.code)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                locale === l.code
                  ? "bg-accent-blue/15 text-accent-blue"
                  : "text-text-muted hover:text-text-primary"
              }`}
              title={l.machineTranslated ? `${l.label} (${t("settings.autoTranslated")})` : l.label}
            >
              {l.code.toUpperCase()}
              {l.machineTranslated && <Bot className="inline w-2.5 h-2.5 ml-0.5 text-text-faint" />}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-border-subtle/50" />

      {/* Interface zoom (Electron only) */}
      <UiZoomSetting />

      <div className="border-t border-border-subtle/50" />

      {/* Crisp sprites */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-text-primary">{t("settings.crispSprites")}</p>
          <p className="text-xs text-text-muted mt-0.5 max-w-sm">
            {t("settings.crispSpritesDesc")}
          </p>
        </div>
        <Toggle
          enabled={settings.crisp_sprites ?? false}
          onChange={() => setCrispSprites(!(settings.crisp_sprites ?? false))}
          label={t("settings.crispSprites")}
          color="bg-accent-blue/80"
        />
      </div>

      <div className="border-t border-border-subtle/50" />

      {/* Reduce motion (local preference, stored in localStorage) */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-text-primary">{t("settings.reduceMotion")}</p>
          <p className="text-xs text-text-muted mt-0.5 max-w-sm">
            {t("settings.reduceMotionDesc")}
          </p>
        </div>
        <Toggle
          enabled={motion === "off"}
          onChange={() => setMotion(motion === "off" ? "auto" : "off")}
          label={t("settings.reduceMotion")}
          color="bg-accent-blue/80"
        />
      </div>

      <div className="border-t border-border-subtle/50" />

      {/* Accent color picker */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-text-primary">{t("settings.accentColor")}</p>
          <p className="text-xs text-text-muted mt-0.5 max-w-sm">{t("settings.accentColorDesc")}</p>
        </div>
        <div
          role="radiogroup"
          aria-label={t("settings.accentColor")}
          className="flex items-center gap-2"
        >
          {ACCENT_COLORS.map((c) => {
            const selected = activeAccent === c;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={t(`settings.accentColor.${c}`)}
                title={t(`settings.accentColor.${c}`)}
                onClick={() => setAccentColor(c)}
                data-accent={c}
                className={`relative h-8 w-8 rounded-none border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card focus-visible:ring-(--accent-blue) ${
                  selected
                    ? "border-text-primary scale-110"
                    : "border-border-subtle hover:scale-105"
                }`}
                style={{ backgroundColor: ACCENT_SWATCH[c] }}
              >
                {selected && <span className="sr-only">{t("settings.accentColorActive")}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
