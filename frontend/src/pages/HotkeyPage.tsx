import { useState, useEffect } from "react";
import { HotkeySettings } from "../components/settings/HotkeySettings";
import { useCounterStore } from "../hooks/useCounterState";
import { HotkeyMap } from "../types";
import { useI18n } from "../contexts/I18nContext";

export function HotkeyPage() {
  const { t } = useI18n();
  const { appState } = useCounterStore();
  const [hotkeys, setHotkeys] = useState<HotkeyMap | null>(null);
  const [initialised, setInitialised] = useState(false);

  useEffect(() => {
    if (appState && !initialised) {
      setHotkeys(appState.hotkeys);
      setInitialised(true);
    }
  }, [appState, initialised]);

  if (!hotkeys) {
    return <div className="p-6 text-text-muted">Lade…</div>;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-transparent">
      <div className="switch-waves-container">
        <div className="switch-waves" />
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-6 relative z-10">
        <div className="max-w-xl mx-auto space-y-6">
        <section className="glass-card rounded-2xl p-6">
          <h2 className="text-sm font-semibold text-text-primary mb-6">
            {t("settings.hotkeysTitle")}
          </h2>
          <HotkeySettings hotkeys={hotkeys} onUpdate={setHotkeys} />
        </section>
      </div>
      </div>
    </div>
  );
}
