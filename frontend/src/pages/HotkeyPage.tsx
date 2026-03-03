import { useState, useEffect } from "react";
import { HotkeySettings } from "../components/HotkeySettings";
import { useCounterStore } from "../hooks/useCounterState";
import { HotkeyMap } from "../types";
import { useI18n } from "../contexts/I18nContext";

export function HotkeyPage() {
  const { t } = useI18n();
  const { appState } = useCounterStore();
  const [hotkeys, setHotkeys] = useState<HotkeyMap | null>(null);
  const initialised = useState(false);

  useEffect(() => {
    if (appState && !initialised[0]) {
      setHotkeys(appState.hotkeys);
      initialised[1](true);
    }
  }, [appState]);

  if (!hotkeys) {
    return <div className="p-6 text-gray-500">Lade…</div>;
  }

  return (
    <div className="flex-1 overflow-auto p-6 settings-bg">
      <div className="max-w-xl mx-auto space-y-6 relative z-10">
        <section className="glass-card rounded-2xl p-6">
          <h2 className="text-sm font-semibold text-white mb-6">
            {t("settings.hotkeysTitle")}
          </h2>
          <HotkeySettings hotkeys={hotkeys} onUpdate={setHotkeys} />
        </section>
      </div>
    </div>
  );
}
