import { useState, useEffect } from "react";
import { Check, Copy } from "lucide-react";
import { HotkeySettings } from "../components/settings/HotkeySettings";
import { useCounterStore } from "../hooks/useCounterState";
import { HotkeyMap } from "../types";
import { useI18n } from "../contexts/I18nContext";
import { apiUrl } from "../utils/api";

/**
 * HotkeyPage renders the global-hotkey configuration panel and a companion
 * OBS Browser Source info card that surfaces the universal overlay URL.
 *
 * The universal URL is paired with the next_pokemon hotkey so that streamers
 * can cycle the active Pokémon live without reloading the OBS source.
 */
export function HotkeyPage() {
  const { t } = useI18n();
  const { appState } = useCounterStore();
  const [hotkeys, setHotkeys] = useState<HotkeyMap | null>(appState?.hotkeys ?? null);
  const [initialised, setInitialised] = useState(!!appState);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (appState && !initialised) {
      setHotkeys(appState.hotkeys);
      setInitialised(true);
    }
  }, [appState, initialised]);

  if (!hotkeys) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-accent-blue border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-text-muted">{t("nav.connecting")}</p>
        </div>
      </div>
    );
  }

  // Mirror the URL construction used by OverlayBrowserSourceButton so both
  // surfaces stay consistent in Electron (apiBaseUrl) and web (origin) modes.
  const baseUrl = apiUrl("") || globalThis.location.origin;
  const universalUrl = `${baseUrl}/overlay`;

  const nextPokemonCombo = hotkeys.next_pokemon;
  const hintText = nextPokemonCombo
    ? t("hotkey.obsCard.hintWithKey", { key: nextPokemonCombo })
    : t("hotkey.obsCard.hintNoKey");

  const handleCopy = () => {
    navigator.clipboard.writeText(universalUrl).then(() => {
      setCopied(true);
      // Short visual feedback window; matches OverlayBrowserSourceButton.
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <main id="main-content" className="flex-1 flex flex-col min-h-0 bg-transparent">
      <div className="flex-1 min-h-0 overflow-auto p-6 relative z-10">
        <div className="max-w-xl mx-auto space-y-6">
          <section className="glass-card rounded-2xl p-6">
            <h1 className="text-sm font-semibold text-text-primary mb-6">
              {t("settings.hotkeysTitle")}
            </h1>
            <HotkeySettings hotkeys={hotkeys} onUpdate={setHotkeys} />
          </section>

          <section className="glass-card rounded-2xl p-6" aria-labelledby="obs-card-title">
            <h2
              id="obs-card-title"
              className="text-sm font-semibold text-text-primary mb-3"
            >
              {t("hotkey.obsCard.title")}
            </h2>
            <p className="text-xs 2xl:text-sm text-text-secondary mb-4">
              {t("hotkey.obsCard.description")}
            </p>

            <div className="flex items-center gap-2 mb-3">
              <label htmlFor="obs-universal-url" className="sr-only">
                {t("hotkey.obsCard.urlLabel")}
              </label>
              <input
                id="obs-universal-url"
                type="text"
                readOnly
                value={universalUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 min-w-0 px-3 py-2 bg-bg-secondary border border-border-subtle rounded-lg text-xs 2xl:text-sm font-mono text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
              />
              <button
                type="button"
                onClick={handleCopy}
                aria-label={t("hotkey.obsCard.copyAria")}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border-subtle text-xs 2xl:text-sm font-semibold text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-accent-green" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span className="hidden sm:inline">
                  {copied ? t("hotkey.obsCard.copied") : t("overlay.copy")}
                </span>
              </button>
            </div>

            {/* aria-live announces copy feedback without stealing focus. */}
            <p
              aria-live="polite"
              className={`text-xs text-accent-green mb-2 ${copied ? "" : "sr-only"}`}
            >
              {copied ? t("hotkey.obsCard.copied") : ""}
            </p>

            <p className="text-xs 2xl:text-sm text-text-muted">{hintText}</p>
          </section>
        </div>
      </div>
    </main>
  );
}
