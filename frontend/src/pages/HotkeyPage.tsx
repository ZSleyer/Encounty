import { useState, useEffect } from "react";
import { HotkeySettings } from "../components/settings/HotkeySettings";
import { useCounterStore } from "../hooks/useCounterState";
import { HotkeyMap } from "../types";
import { useI18n } from "../contexts/I18nContext";

export function HotkeyPage() {
  const { t } = useI18n();
  const { appState } = useCounterStore();
  const [hotkeys, setHotkeys] = useState<HotkeyMap | null>(appState?.hotkeys ?? null);
  const [initialised, setInitialised] = useState(!!appState);

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
      </div>
      </div>
    </main>
  );
}
