/**
 * PreparingScreen.tsx: First-launch setup and sync progress screen.
 *
 * Covers the window until the backend reports readiness. It owns its own
 * reconnecting WebSocket because the app-wide WebSocketProvider is only mounted
 * once the gate has opened, and the server may not even be listening yet.
 */
import { useState, useEffect } from "react";
import { Globe, HardDrive } from "lucide-react";
import { useI18n } from "../contexts/I18nContext";
import { apiUrl, wsUrl } from "../utils/api";

/** Payload shape for `sync_progress` WebSocket events. */
interface SyncProgress {
  phase: string;
  step: string;
  message: string;
  error: string;
}

/** Map sync phase to i18n key. */
export function phaseKey(phase: string): string {
  if (phase === "pokedex") return "app.syncPhasePokedex";
  return "app.syncPhaseGames";
}

/** Map sync step to i18n key. */
export function stepKey(step: string): string {
  switch (step) {
    case "species":
      return "app.syncStepSpecies";
    case "forms":
      return "app.syncStepForms";
    case "cosmetic_forms":
      return "app.syncStepCosmeticForms";
    case "names":
      return "app.syncStepNames";
    case "form_names":
      return "app.syncStepFormNames";
    default:
      return "";
  }
}

/** Props for the PreparingScreen component. */
interface PreparingScreenProps {
  onReady: () => void;
  setupPending?: boolean;
  devMode?: boolean;
}

/** Full-screen overlay shown while the backend performs initial setup (e.g. first-launch game sync). */
export function PreparingScreen({
  onReady,
  setupPending,
  devMode,
}: Readonly<PreparingScreenProps>) {
  const { t } = useI18n();
  const [phase, setPhase] = useState("");
  const [step, setStep] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showProgress, setShowProgress] = useState(!setupPending);

  useEffect(() => {
    if (!showProgress) return;

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    function connect() {
      if (disposed) return;
      try {
        ws = new WebSocket(wsUrl());
      } catch {
        // Server may not be up yet, retry after a short delay
        reconnectTimer = setTimeout(connect, 2000);
        return;
      }

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as { type: string; payload: unknown };
          if (msg.type === "sync_progress") {
            const p = msg.payload as SyncProgress;
            setPhase(p.phase);
            setStep(p.step);
            if (p.step === "error" && p.error) {
              setError(p.error);
            }
          } else if (msg.type === "system_ready") {
            onReady();
          }
        } catch {
          // Ignore unparseable messages
        }
      };

      ws.onclose = () => {
        if (!disposed) {
          reconnectTimer = setTimeout(connect, 2000);
        }
      };

      ws.onerror = () => {
        // onclose fires after onerror, so the reconnect is handled there
      };
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, [onReady, showProgress]);

  const handleOnlineSetup = () => {
    fetch(apiUrl("/api/setup/online"), { method: "POST" }).catch(() => {});
    setShowProgress(true);
  };

  const handleOfflineSetup = async () => {
    try {
      await fetch(apiUrl("/api/setup/offline"), { method: "POST" });
      onReady();
    } catch {
      setError("Offline setup failed");
      setShowProgress(true);
    }
  };

  const handleRetry = () => {
    setError(null);
    setPhase("");
    setStep("");
    fetch(apiUrl("/api/setup/online"), { method: "POST" }).catch(() => {});
  };

  const handleOfflineFallback = async () => {
    try {
      await fetch(apiUrl("/api/setup/offline"), { method: "POST" });
      onReady();
    } catch {
      setError("Offline setup failed");
    }
  };

  // Dev mode setup choice screen
  if (setupPending && devMode && !showProgress) {
    return (
      <div className="fixed inset-0 bg-bg-primary flex flex-col items-center-safe justify-center-safe z-50">
        <div className="flex flex-col items-center gap-6 max-w-lg text-center">
          <img
            src="/app-icon.png"
            alt="Encounty"
            className="w-16 h-16 rounded-none object-contain"
          />
          <h1 className="text-xl font-bold text-text-primary">{t("app.setupChoiceTitle")}</h1>
          <p className="text-sm text-text-muted">{t("app.setupChoiceDesc")}</p>
          <div className="flex gap-4 mt-2">
            <button
              onClick={handleOnlineSetup}
              className="flex flex-col items-center gap-3 p-6 rounded-none border border-border-subtle bg-bg-secondary hover:bg-bg-hover transition-colors w-52"
            >
              <div className="w-12 h-12 rounded-none flex items-center justify-center">
                <Globe className="w-6 h-6 text-accent-blue" />
              </div>
              <span className="text-sm font-semibold text-text-primary">
                {t("app.setupOnline")}
              </span>
              <span className="text-xs text-text-muted">{t("app.setupOnlineDesc")}</span>
            </button>
            <button
              onClick={handleOfflineSetup}
              className="flex flex-col items-center gap-3 p-6 rounded-none border border-border-subtle bg-bg-secondary hover:bg-bg-hover transition-colors w-52"
            >
              <div className="w-12 h-12 rounded-none flex items-center justify-center">
                <HardDrive className="w-6 h-6 text-accent-blue" />
              </div>
              <span className="text-sm font-semibold text-text-primary">
                {t("app.setupOffline")}
              </span>
              <span className="text-xs text-text-muted">{t("app.setupOfflineDesc")}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const phaseText = phase ? t(phaseKey(phase)) : t("app.preparingSync");
  const stepText = step && step !== "syncing" && step !== "error" ? t(stepKey(step)) : "";

  return (
    <div className="fixed inset-0 bg-bg-primary flex flex-col items-center-safe justify-center-safe z-50">
      <div className="flex flex-col items-center gap-4 max-w-sm text-center">
        <img
          src="/app-icon.png"
          alt="Encounty"
          className="w-16 h-16 rounded-none object-contain mb-2"
        />
        {!error && (
          <div className="w-12 h-12 border-4 border-accent-blue/30 border-t-accent-blue rounded-full animate-spin" />
        )}
        <h1 className="text-xl font-bold text-text-primary">{t("app.preparing")}</h1>
        {error ? (
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-accent-red font-medium">{t("app.syncError")}</p>
            <p className="text-xs text-accent-red/80">{error}</p>
            <div className="flex gap-3 mt-2">
              <button
                onClick={handleRetry}
                className="px-4 py-2 rounded-none border border-border-subtle text-text-muted hover:bg-bg-hover text-sm font-medium transition-colors"
              >
                {t("app.syncRetry")}
              </button>
              <button
                onClick={handleOfflineFallback}
                className="px-4 py-2 rounded-none bg-accent-blue hover:bg-accent-blue/80 text-white text-sm font-semibold transition-colors"
              >
                {t("app.syncErrorFallback")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-text-muted">{phaseText}</p>
            {stepText && <p className="text-xs text-text-faint animate-pulse">{stepText}</p>}
          </>
        )}
      </div>
    </div>
  );
}
