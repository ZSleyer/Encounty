/**
 * LanguagesSection.tsx: Picker for the languages Pokémon and game names use.
 */

import { Globe } from "lucide-react";

import { Settings as SettingsType } from "../../types";
import { ALL_LANGUAGES } from "../../utils/games";
import { CountryFlag } from "../../components/shared/CountryFlag";

/**
 * LanguagesSection renders the picker for the languages in which Pokémon and
 * game names are shown throughout the app.
 */
export function LanguagesSection({
  settings,
  toggleLanguage,
  t,
}: Readonly<{
  settings: SettingsType;
  toggleLanguage: (code: string) => void;
  t: (key: string) => string;
}>) {
  return (
    <section className="glass-card rounded-none p-6 space-y-4">
      <h2 className="text-sm 2xl:text-base font-semibold text-text-primary flex items-center gap-2">
        <Globe className="w-4 h-4 text-accent-blue" />
        {t("settings.languages")}
      </h2>
      <p className="text-xs text-text-muted">{t("settings.languagesDesc")}</p>
      <div className="flex flex-wrap gap-2">
        {ALL_LANGUAGES.map(({ code, label }) => {
          const active = (settings.languages ?? ["de", "en"]).includes(code);
          return (
            <button
              key={code}
              onClick={() => toggleLanguage(code)}
              title={code}
              className={`flex items-center gap-1.5 px-3 py-1.5 2xl:px-4 2xl:py-2 rounded-none text-xs 2xl:text-sm font-medium border transition-colors ${
                active
                  ? "bg-accent-blue/20 border-accent-blue/50 text-text-primary"
                  : "bg-bg-secondary border-border-subtle text-text-muted hover:text-text-primary"
              }`}
            >
              <CountryFlag code={code} className="w-4 h-3" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
