/**
 * App.tsx — Root component tree.
 *
 * App wraps the application in ThemeProvider, I18nProvider, and ToastProvider,
 * then renders AppShell which owns the navigation header, route outlets, and
 * the global WebSocket connection. The /overlay route renders the bare Overlay
 * page without any chrome so it can be used as an OBS Browser Source.
 */
import { useState, useEffect, useCallback } from "react";
import { Routes, Route, Link, useLocation, useNavigate } from "react-router";
import {
  LayoutGrid,
  Settings as SettingsIcon,
  Power,
  Keyboard,
  Layers,
  ArrowUpCircle,
  AlertTriangle,
  Bot,
  Globe,
  HardDrive,
} from "lucide-react";
import { Dashboard } from "./pages/Dashboard";
import { Settings } from "./pages/Settings";
import { HotkeyPage } from "./pages/HotkeyPage";
import { OverlayEditorPage } from "./pages/OverlayEditorPage";
import { Overlay } from "./pages/Overlay";
import { useWebSocket } from "./hooks/useWebSocket";
import { useCounterStore, DetectorStatusEntry } from "./hooks/useCounterState";
import { WSMessage, AppState } from "./types";
import { I18nProvider, useI18n } from "./contexts/I18nContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ToastProvider, useToast } from "./contexts/ToastContext";
import { ToastContainer } from "./components/shared/ToastContainer";
import { WindowControls } from "./components/settings/WindowControls";
import { LicenseDialog } from "./components/settings/LicenseDialog";
import { apiUrl, wsUrl } from "./utils/api";
import { CaptureServiceProvider } from "./contexts/CaptureServiceContext";

/** Full-screen blocking overlay shown while an update is being installed or restarting. */
function UpdateOverlay({
  updateState,
  version,
}: Readonly<{
  updateState: "installing" | "restarting";
  version: string;
}>) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-100 bg-black/80 backdrop-blur-sm flex items-center justify-center animate-fadeIn">
      <div className="bg-bg-secondary border border-border-subtle rounded-2xl p-12 flex flex-col items-center gap-6 max-w-md mx-4 shadow-2xl">
        <div className="w-16 h-16 border-3 border-accent-blue border-t-transparent rounded-full animate-spin" />
        <div className="text-center space-y-2">
          <p className="text-lg font-semibold text-text-primary">
            {updateState === "restarting" ? t("update.restarting") : t("update.installing")}
          </p>
          <p className="text-sm text-text-muted">
            {t("update.updatingTo")} {version}
          </p>
        </div>
        <p className="text-xs text-text-faint">
          {t("update.doNotClose")}
        </p>
      </div>
    </div>
  );
}

/** Dismissable modal shown on startup when a newer version is available. */
function UpdateNotification({
  version,
  onUpdate,
  onDismiss,
  manualDownload,
}: Readonly<{
  version: string;
  onUpdate: () => void;
  onDismiss: () => void;
  manualDownload?: boolean;
}>) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-90 bg-black/50 backdrop-blur-sm flex items-center justify-center animate-fadeIn" role="alert">
      <div className="bg-bg-secondary border border-border-subtle rounded-2xl p-10 flex flex-col items-center gap-5 max-w-md mx-4 shadow-2xl">
        <div className="w-14 h-14 rounded-full bg-accent-blue/15 flex items-center justify-center">
          <ArrowUpCircle className="w-7 h-7 text-accent-blue" />
        </div>
        <div className="text-center space-y-1.5">
          <p className="text-lg font-semibold text-text-primary">
            {t("update.newVersion")}
          </p>
          <p className="text-sm text-text-muted">
            {version}
          </p>
          <a
            href={`https://github.com/ZSleyer/Encounty/releases/tag/${version.startsWith("v") ? version : `v${version}`}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-accent-blue hover:underline"
          >
            {t("update.changelog")}
          </a>
        </div>
        <div className="flex gap-3 w-full">
          <button
            onClick={onDismiss}
            className="flex-1 px-4 py-2.5 rounded-xl border border-border-subtle text-text-muted hover:bg-bg-hover text-sm font-medium transition-colors"
          >
            {t("update.later")}
          </button>
          <button
            onClick={onUpdate}
            className="flex-1 px-4 py-2.5 rounded-xl bg-accent-blue hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
          >
            {manualDownload ? t("update.openDownload") : t("update.updateNow")}
          </button>
        </div>
      </div>
    </div>
  );
}

function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const isOverlay = location.pathname === "/overlay" || location.pathname.startsWith("/overlay/");
  const { setAppState, setConnected, flashPokemon, isConnected, appState, setDetectorStatus, clearDetectorStatus } =
    useCounterStore();
  const { t, isMachineTranslated } = useI18n();
  const { push: pushToast } = useToast();

  const [restarting] = useState(false);
  const [quitting, setQuitting] = useState(false);
  const [buildInfo, setBuildInfo] = useState("Encounty");
  const [updateInfo, setUpdateInfo] = useState<{
    available: boolean;
    latest_version: string;
    download_url: string;
  } | null>(null);
  const [updateState, setUpdateState] = useState<"idle" | "installing" | "restarting">("idle");
  const [showUpdateNotification, setShowUpdateNotification] = useState(false);
  const [showCloseWarning, setShowCloseWarning] = useState(false);

  const [buildDate, setBuildDate] = useState("");

  useEffect(() => {
    fetch(apiUrl("/api/version"))
      .then((r) => r.json())
      .then((d: { display: string; build_date: string }) => {
        setBuildInfo(`Encounty ${d.display}`);
        setBuildDate(d.build_date);
      })
      .catch(() => setBuildInfo("Encounty"));
  }, []);

  useEffect(() => {
    if (!globalThis.electronAPI) return;

    const cleanupAvailable = globalThis.electronAPI.onUpdateAvailable((info) => {
      setUpdateInfo({
        available: true,
        latest_version: info.version,
        download_url: `https://github.com/ZSleyer/Encounty/releases/tag/v${info.version}`,
      });
      if (!sessionStorage.getItem("update_dismissed")) {
        setShowUpdateNotification(true);
      }
    });

    const cleanupProgress = globalThis.electronAPI.onUpdateProgress(() => {
      // Progress updates received but not currently displayed
    });

    const cleanupDownloaded = globalThis.electronAPI.onUpdateDownloaded(() => {
      // Auto-install on Linux AppImage (electron-updater replaces the binary).
      // Windows portable and macOS DMG: user downloads manually from GitHub.
      if (globalThis.electronAPI!.platform === "linux") {
        globalThis.electronAPI!.installUpdate();
        setUpdateState("restarting");
      }
    });

    const cleanupError = globalThis.electronAPI.onUpdateError((message) => {
      console.error("[Update] Error:", message);
      setUpdateState("idle");
    });

    return () => {
      cleanupAvailable();
      cleanupProgress();
      cleanupDownloaded();
      cleanupError();
    };
  }, []);

  const applyUpdate = async () => {
    if (!updateInfo) return;

    // Windows portable + macOS DMG: open the GitHub release page for manual download.
    if (globalThis.electronAPI?.platform === "win32" || globalThis.electronAPI?.platform === "darwin") {
      globalThis.open(
        `https://github.com/ZSleyer/Encounty/releases/tag/${updateInfo.latest_version.startsWith("v") ? updateInfo.latest_version : `v${updateInfo.latest_version}`}`,
        "_blank",
      );
      setShowUpdateNotification(false);
      return;
    }

    // Linux/macOS: download via electron-updater IPC (auto-installs on completion)
    setUpdateState("installing");
    if (globalThis.electronAPI) {
      try {
        await globalThis.electronAPI.downloadUpdate();
      } catch {
        setUpdateState("idle");
      }
    }
  };

  // Reload/close warning disabled — Electron handles window lifecycle,
  // and in dev mode the native dialog interferes with HMR and testing.

  // Intercept Ctrl+W / Cmd+W to show custom warning modal instead of closing
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "w") {
        if (isConnected && !quitting && !restarting && updateState === "idle" && !globalThis.electronAPI) {
          e.preventDefault();
          setShowCloseWarning(true);
        }
      }
    };
    globalThis.addEventListener("keydown", handleKeyDown);
    return () => globalThis.removeEventListener("keydown", handleKeyDown);
  }, [isConnected, quitting, restarting, updateState]);

  // Sync hotkeys to Electron's globalShortcut manager (macOS)
  useEffect(() => {
    if (globalThis.electronAPI?.syncHotkeys && appState?.hotkeys) {
      globalThis.electronAPI.syncHotkeys(appState.hotkeys as unknown as Record<string, string>);
    }
  }, [appState?.hotkeys]);

  // Sync crisp-sprites attribute from backend settings whenever state arrives
  useEffect(() => {
    if (appState?.settings.crisp_sprites) {
      document.documentElement.dataset.crispSprites = "";
    } else if (appState) {
      delete document.documentElement.dataset.crispSprites;
    }
  }, [appState?.settings.crisp_sprites]);

  // Sync ui-animations setting with CSS class
  useEffect(() => {
    if (appState?.settings.ui_animations === false) {
      document.documentElement.classList.add('animations-disabled');
    } else {
      document.documentElement.classList.remove('animations-disabled');
    }
  }, [appState?.settings.ui_animations]);

  // Pause CSS animations when the app tab/window is not visible (CPU savings)
  useEffect(() => {
    const handler = () => {
      document.documentElement.classList.toggle('app-hidden', document.hidden);
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  const quitApp = useCallback(async () => {
    if (!confirm(t("app.confirmQuit"))) return;
    setQuitting(true);
    setShowCloseWarning(false);
    await fetch(apiUrl("/api/quit"), { method: "POST" }).catch(() => {});
    // Try to close the tab (works if opened via globalThis.open)
    globalThis.close();
  }, [t]);

  // --- WebSocket message handler ---
  const handleWSMessage = useCallback((msg: WSMessage) => {
    if (msg.type === "state_update") {
      handleStateUpdate(msg.payload as AppState);
    } else if (msg.type === "encounter_added") {
      handleEncounterAdded(msg.payload as { pokemon_id: string; count: number });
    } else if (msg.type === "encounter_removed") {
      handleEncounterToast(msg.payload as { pokemon_id: string; count: number }, "-1");
    } else if (msg.type === "encounter_reset") {
      handlePokemonToast((msg.payload as { pokemon_id: string }).pokemon_id, "0", t("app.counterReset") || "Zähler zurückgesetzt");
    } else if (msg.type === "pokemon_completed") {
      handlePokemonToast((msg.payload as { pokemon_id: string }).pokemon_id, "✔", t("app.pokemonCompleted") || "Hunt erfolgreich abgeschlossen!");
    } else if (msg.type === "pokemon_deleted") {
      handlePokemonToast((msg.payload as { pokemon_id: string }).pokemon_id, "🗑", t("app.pokemonDeleted") || "Pokémon entfernt");
    } else if (msg.type === "detector_status") {
      const p = msg.payload as { pokemon_id: string; state: string; confidence: number; poll_ms: number };
      setDetectorStatus(p.pokemon_id, { state: p.state, confidence: p.confidence, poll_ms: p.poll_ms } as DetectorStatusEntry);
    } else if (msg.type === "request_reset_confirm") {
      // Navigate to dashboard so the reset confirmation modal can be shown.
      // Without this, the modal is invisible on non-dashboard pages and the
      // app appears frozen because the modal blocks interaction.
      globalThis.electronAPI?.focusWindow();
      navigate("/");
    }
    // detector_match: counter already incremented by backend; encounter_added fires separately
  }, [appState, t, setAppState, setConnected, flashPokemon, pushToast, clearDetectorStatus, setDetectorStatus, navigate]);

  function handleStateUpdate(newState: AppState) {
    setAppState(newState);
    setConnected(true);
    for (const p of newState.pokemon ?? []) {
      if (!p.detector_config?.enabled) {
        clearDetectorStatus(p.id);
      }
    }
  }

  function handleEncounterAdded(p: { pokemon_id: string; count: number }) {
    flashPokemon(p.pokemon_id);
    handleEncounterToast(p);
  }

  function handleEncounterToast(p: { pokemon_id: string; count: number }, badge?: string) {
    const pokemon = appState?.pokemon.find((x) => x.id === p.pokemon_id);
    if (!pokemon) return;
    pushToast({
      type: "encounter",
      badge,
      spriteUrl: pokemon.sprite_url || undefined,
      title: pokemon.name,
      message: `${p.count} ${t("settings.encounterToast")}`,
    });
  }

  function handlePokemonToast(pokemonId: string, badge: string, message: string) {
    const pokemon = appState?.pokemon.find((x) => x.id === pokemonId);
    if (!pokemon) return;
    pushToast({
      type: "encounter",
      badge,
      spriteUrl: pokemon.sprite_url || undefined,
      title: pokemon.name,
      message,
    });
  }

  useWebSocket(handleWSMessage, () => setConnected(true), () => setConnected(false));

  if (isOverlay) {
    return (
      <Routes>
        <Route path="/overlay/:pokemonId" element={<Overlay />} />
        <Route path="/overlay" element={<Overlay />} />
      </Routes>
    );
  }

  // Show a goodbye screen after quitting so the user knows they can close the tab
  if (quitting) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-transparent text-text-primary gap-4">
        <Power className="w-12 h-12 text-text-faint" />
        <p className="text-lg font-semibold">{t("app.quitMessage")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-transparent text-text-primary overflow-hidden relative">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-100 focus:px-4 focus:py-2 focus:bg-accent-blue focus:text-white focus:rounded-lg focus:text-sm">
        {t("aria.skipToContent")}
      </a>
      {/* Close-tab warning modal */}
      {showCloseWarning && (
        <div className="fixed inset-0 z-95 bg-black/50 backdrop-blur-sm flex items-center justify-center animate-fadeIn">
          <div className="bg-bg-secondary border border-border-subtle rounded-2xl p-8 flex flex-col items-center gap-5 max-w-md mx-4 shadow-2xl">
            <div className="w-14 h-14 rounded-full bg-amber-500/15 flex items-center justify-center">
              <AlertTriangle className="w-7 h-7 text-amber-500" />
            </div>
            <div className="text-center space-y-1.5">
              <p className="text-lg font-semibold text-text-primary">{t("app.closeWarning")}</p>
              <p className="text-sm text-text-muted">{t("app.closeWarningDesc")}</p>
            </div>
            <div className="flex gap-3 w-full">
              <button
                onClick={() => setShowCloseWarning(false)}
                className="flex-1 px-4 py-2.5 rounded-xl bg-accent-blue hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
              >
                {t("app.closeWarningStay")}
              </button>
              <button
                onClick={quitApp}
                className="flex-1 px-4 py-2.5 rounded-xl border border-border-subtle text-text-muted hover:bg-bg-hover text-sm font-medium transition-colors"
              >
                {t("app.closeWarningQuit")}
              </button>
            </div>
          </div>
        </div>
      )}

      {updateState !== "idle" && updateInfo && (
        <UpdateOverlay
          updateState={updateState}
          version={updateInfo.latest_version}
        />
      )}
      {showUpdateNotification && updateInfo && updateState === "idle" && (
        <UpdateNotification
          version={updateInfo.latest_version}
          manualDownload={globalThis.electronAPI?.platform === "win32" || globalThis.electronAPI?.platform === "darwin"}
          onUpdate={() => {
            setShowUpdateNotification(false);
            applyUpdate();
          }}
          onDismiss={() => {
            setShowUpdateNotification(false);
            sessionStorage.setItem("update_dismissed", "1");
          }}
        />
      )}
      <div className="switch-waves-container">
        <div className="switch-waves" />
      </div>
      {/* ── Horizontal Header + Nav ──────────────────────────── */}
      <header
        className={`flex items-center h-12 2xl:h-14 bg-bg-secondary shrink-0 relative z-10 ${globalThis.electronAPI?.platform === 'darwin' ? 'pl-[78px] pr-4' : 'px-4'}`}
        style={{
          WebkitAppRegion: "drag",
        } as React.CSSProperties}
        role="banner"
        onDoubleClick={() => globalThis.electronAPI?.maximize()}
      >
        {/* Left: Logo + Nav tabs */}
        <div className="flex items-center gap-1 mr-auto" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          {/* Logo — hidden on macOS where traffic light buttons occupy this space */}
          {globalThis.electronAPI?.platform !== 'darwin' && (
            <img
              src="/app-icon.png"
              alt="Encounty Logo"
              className="w-7 h-7 2xl:w-8 2xl:h-8 rounded-md object-contain shrink-0 mr-3 transition-shadow hover:shadow-[0_0_12px_rgba(255,255,255,0.2)]"
              title="Encounty"
            />
          )}

          <NavTab to="/" icon={<LayoutGrid className="w-4 h-4 2xl:w-5 2xl:h-5" />}>
            {t("nav.dashboard")}
          </NavTab>
          <NavTab to="/hotkeys" icon={<Keyboard className="w-4 h-4 2xl:w-5 2xl:h-5" />}>
            {t("nav.hotkeys")}
          </NavTab>
          <NavTab to="/overlay-editor" icon={<Layers className="w-4 h-4 2xl:w-5 2xl:h-5" />}>
            {t("nav.overlayEditor")}
          </NavTab>
          <NavTab to="/settings" icon={<SettingsIcon className="w-4 h-4 2xl:w-5 2xl:h-5" />}>
            {t("nav.settings")}
          </NavTab>

          {isMachineTranslated && (
            <button
              onClick={() => pushToast({ type: "info", title: t("settings.autoTranslated"), message: t("app.machineTranslationDisclaimer"), duration: 8000 })}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] 2xl:text-xs text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 transition-colors"
              title={t("app.machineTranslationDisclaimer")}
            >
              <Bot className="w-3 h-3" />
              {t("settings.autoTranslated")}
            </button>
          )}
        </div>


        {/* Right: Window controls (Windows/Linux) or logo (macOS) */}
        <div className="flex items-center ml-auto h-full">
          {globalThis.electronAPI?.platform === 'darwin' ? (
            <img
              src="/app-icon.png"
              alt="Encounty Logo"
              className="w-7 h-7 2xl:w-8 2xl:h-8 rounded-md object-contain mr-2 transition-shadow hover:shadow-[0_0_12px_rgba(255,255,255,0.2)]"
              title="Encounty"
            />
          ) : (
            <WindowControls />
          )}
        </div>
      </header>
      <div className="glow-line-h shrink-0" />

      {/* ── Main content ─────────────────────────────────────── */}
      {/* Dashboard stays mounted when navigating to overlay editor */}
      <div className={location.pathname === "/" ? "flex-1 overflow-hidden flex flex-col" : "hidden"}>
        <Dashboard />
      </div>
      {location.pathname !== "/" && (
        <div className="flex-1 overflow-hidden flex flex-col">
          <Routes>
            <Route path="/" element={null} />
            <Route path="/hotkeys" element={<HotkeyPage />} />
            <Route path="/overlay-editor" element={<OverlayEditorPage />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/overlay/:pokemonId" element={<Overlay />} />
            <Route path="/overlay" element={<Overlay />} />
          </Routes>
        </div>
      )}

      {/* ── Footer ───────────────────────────────────────────── */}
      <div className="shrink-0">
        <div className="footer-line" />
        <footer className="h-8 2xl:h-10 px-5 grid grid-cols-3 items-center text-xs text-text-faint select-none">
          {/* Left: Build Info + Build Date + Update Badge */}
          <div className="flex items-center justify-start gap-2">
            <span className="font-semibold tracking-wide text-text-muted">
              {buildInfo}
            </span>
            {buildDate && (
              <span className="text-text-faint/50">({buildDate})</span>
            )}
            {updateInfo && updateState === "idle" && (
              <button
                onClick={applyUpdate}
                title={`${t("update.tooltip")} (${updateInfo.latest_version})`}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25 transition-colors font-semibold"
              >
                <ArrowUpCircle className="w-3 h-3" />
                <span>{updateInfo.latest_version}</span>
              </button>
            )}
          </div>

          {/* Center */}
          <p className="text-center text-text-faint italic tracking-wide">And be not afraid of the dark</p>

          {/* Right: Brand Links */}
          <div className="flex items-center justify-end gap-3">
            <a
              href="https://github.com/ZSleyer/Encounty"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:text-text-muted transition-colors font-medium"
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" /><path d="M9 18c-4.51 2-5-2-7-2" /></svg>
              <span>GitHub</span>
            </a>
            <span className="text-text-faint/30">|</span>
            <a
              href="https://youtube.com/@ZSleyer"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-full hover:bg-accent-red/10 text-text-faint hover:text-accent-red transition-all"
            >
              <svg
                viewBox="0 0 24 24"
                className="w-3 h-3 fill-current"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
              </svg>
              <span className="font-semibold tracking-wide">@ZSleyer</span>
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}

/* ── Nav Tab ──────────────────────────────────────────────────── */

interface NavTabProps {
  to: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

function NavTab({ to, icon, children }: Readonly<NavTabProps>) {
  const location = useLocation();
  const isActive = location.pathname === to;

  return (
    <Link
      to={to}
      aria-current={isActive ? "page" : undefined}
      className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs 2xl:text-sm font-medium transition-colors outline-none focus-visible:ring-1 focus-visible:ring-accent-blue ${
        isActive
          ? "text-accent-blue"
          : "text-text-muted hover:text-text-primary hover:bg-bg-hover"
      }`}
    >
      {icon}
      {children}
      {isActive && (
        <span className="absolute bottom-0 left-2 right-2 h-px bg-accent-blue rounded-full" />
      )}
    </Link>
  );
}

/* ── Root App — wraps providers ──────────────────────────────── */

/** Shape returned by GET /api/status/ready. */
interface ReadyStatus {
  ready: boolean;
  dev_mode: boolean;
  setup_pending: boolean;
}

/** Payload shape for `sync_progress` WebSocket events. */
interface SyncProgress {
  phase: string;
  step: string;
  message: string;
  error: string;
}

/** Map sync phase to i18n key. */
function phaseKey(phase: string): string {
  if (phase === "pokedex") return "app.syncPhasePokedex";
  return "app.syncPhaseGames";
}

/** Map sync step to i18n key. */
function stepKey(step: string): string {
  switch (step) {
    case "species":
      return "app.syncStepSpecies";
    case "forms":
      return "app.syncStepForms";
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
function PreparingScreen({ onReady, setupPending, devMode }: Readonly<PreparingScreenProps>) {
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
        // Server may not be up yet — retry after a short delay
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
        // onclose will fire after onerror — reconnect handled there
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
      <div className="fixed inset-0 bg-bg-primary flex flex-col items-center justify-center z-50">
        <div className="flex flex-col items-center gap-6 max-w-lg text-center">
          <img
            src="/app-icon.png"
            alt="Encounty"
            className="w-16 h-16 rounded-xl object-contain"
          />
          <h1 className="text-xl font-bold text-text-primary">{t("app.setupChoiceTitle")}</h1>
          <p className="text-sm text-text-muted">{t("app.setupChoiceDesc")}</p>
          <div className="flex gap-4 mt-2">
            <button
              onClick={handleOnlineSetup}
              className="flex flex-col items-center gap-3 p-6 rounded-2xl border border-border-subtle bg-bg-secondary hover:bg-bg-hover transition-colors w-52"
            >
              <div className="w-12 h-12 rounded-full bg-accent-blue/15 flex items-center justify-center">
                <Globe className="w-6 h-6 text-accent-blue" />
              </div>
              <span className="text-sm font-semibold text-text-primary">{t("app.setupOnline")}</span>
              <span className="text-xs text-text-muted">{t("app.setupOnlineDesc")}</span>
            </button>
            <button
              onClick={handleOfflineSetup}
              className="flex flex-col items-center gap-3 p-6 rounded-2xl border border-border-subtle bg-bg-secondary hover:bg-bg-hover transition-colors w-52"
            >
              <div className="w-12 h-12 rounded-full bg-accent-blue/15 flex items-center justify-center">
                <HardDrive className="w-6 h-6 text-accent-blue" />
              </div>
              <span className="text-sm font-semibold text-text-primary">{t("app.setupOffline")}</span>
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
    <div className="fixed inset-0 bg-bg-primary flex flex-col items-center justify-center z-50">
      <div className="flex flex-col items-center gap-4 max-w-sm text-center">
        <img
          src="/app-icon.png"
          alt="Encounty"
          className="w-16 h-16 rounded-xl object-contain mb-2"
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
                className="px-4 py-2 rounded-xl border border-border-subtle text-text-muted hover:bg-bg-hover text-sm font-medium transition-colors"
              >
                {t("app.syncRetry")}
              </button>
              <button
                onClick={handleOfflineFallback}
                className="px-4 py-2 rounded-xl bg-accent-blue hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
              >
                {t("app.syncErrorFallback")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-text-muted">{phaseText}</p>
            {stepText && (
              <p className="text-xs text-text-faint animate-pulse">{stepText}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Gated shell that shows the license dialog on first launch. */
function LicenseGate() {
  const location = useLocation();
  const isOverlay = location.pathname === "/overlay" || location.pathname.startsWith("/overlay/");
  const [readyStatus, setReadyStatus] = useState<ReadyStatus | null>(null);
  const [status, setStatus] = useState<"loading" | "pending" | "accepted">("loading");

  // Check backend readiness on mount
  useEffect(() => {
    fetch(apiUrl("/api/status/ready"))
      .then((r) => r.json())
      .then((data: ReadyStatus) => setReadyStatus(data))
      .catch(() => setReadyStatus({ ready: true, dev_mode: false, setup_pending: false }));
  }, []);

  // No polling needed — PreparingScreen's WebSocket connection handles readiness via onReady callback

  // Check license status once the server is ready (and no setup pending)
  useEffect(() => {
    if (!readyStatus || (!readyStatus.ready && !readyStatus.setup_pending)) return;
    if (readyStatus.setup_pending) return; // setup choice screen will handle transition
    fetch(apiUrl("/api/state"))
      .then((r) => r.json())
      .then((s: AppState) => setStatus(s.license_accepted ? "accepted" : "pending"))
      .catch(() => setStatus("pending"));
  }, [readyStatus]);

  // Overlay routes skip the entire gate flow (license, setup, sync) — they
  // only need the WebSocket state stream which AppShell already provides.
  if (isOverlay) {
    return <AppShell />;
  }

  // Server readiness unknown yet — show loading spinner
  if (readyStatus === null) {
    return (
      <div className="flex items-center justify-center h-screen bg-transparent">
        <div className="w-10 h-10 border-3 border-accent-blue border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Setup pending (dev mode) — show setup choice screen
  if (readyStatus.setup_pending) {
    return (
      <PreparingScreen
        onReady={() => setReadyStatus({ ready: true, dev_mode: readyStatus.dev_mode, setup_pending: false })}
        setupPending
        devMode={readyStatus.dev_mode}
      />
    );
  }

  // Server not ready — show preparing screen with progress
  if (!readyStatus.ready) {
    return (
      <PreparingScreen
        onReady={() => setReadyStatus({ ...readyStatus, ready: true })}
      />
    );
  }

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center h-screen bg-transparent">
        <div className="w-10 h-10 border-3 border-accent-blue border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (status === "pending") {
    return <LicenseDialog onAccept={() => setStatus("accepted")} />;
  }

  return (
    <CaptureServiceProvider>
      <AppShell />
      <ToastContainer />
    </CaptureServiceProvider>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <ToastProvider>
          <LicenseGate />
        </ToastProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
