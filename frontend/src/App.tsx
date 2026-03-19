/**
 * App.tsx — Root component tree.
 *
 * App wraps the application in ThemeProvider, I18nProvider, and ToastProvider,
 * then renders AppShell which owns the navigation header, route outlets, and
 * the global WebSocket connection. The /overlay route renders the bare Overlay
 * page without any chrome so it can be used as an OBS Browser Source.
 */
import { useState, useEffect, useCallback } from "react";
import { Routes, Route, Link, useLocation } from "react-router";
import {
  LayoutGrid,
  Settings as SettingsIcon,
  Power,
  Keyboard,
  Layers,
  GithubIcon,
  ArrowUpCircle,
  AlertTriangle,
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
import { CaptureServiceProvider } from "./contexts/CaptureServiceContext";
import { LicenseDialog } from "./components/settings/LicenseDialog";

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
    <div className="fixed inset-0 z-90 bg-black/50 backdrop-blur-sm flex items-center justify-center animate-fadeIn">
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
            href={`https://github.com/ZSleyer/Encounty/releases/tag/v${version}`}
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
  const isOverlay = location.pathname === "/overlay" || location.pathname.startsWith("/overlay/");
  const { setAppState, setConnected, flashPokemon, isConnected, appState, setDetectorStatus, clearDetectorStatus } =
    useCounterStore();
  const { t } = useI18n();
  const { push: pushToast } = useToast();

  const [restarting, setRestarting] = useState(false);
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
    fetch("/api/version")
      .then((r) => r.json())
      .then((d: { display: string; build_date: string }) => {
        setBuildInfo(`Encounty ${d.display}`);
        setBuildDate(d.build_date);
      })
      .catch(() => setBuildInfo("Encounty"));
  }, []);

  useEffect(() => {
    // In Electron on Linux, updates are handled via IPC from electron-updater.
    // On Windows the Electron build is portable, so electron-updater cannot
    // apply updates — fall through to the REST API path instead.
    if (globalThis.electronAPI && globalThis.electronAPI.platform !== "win32") {
      const cleanupAvailable = globalThis.electronAPI.onUpdateAvailable((info) => {
        setUpdateInfo({
          available: true,
          latest_version: info.version,
          download_url: `https://github.com/ZSleyer/Encounty/releases/tag/v${info.version}`,
        });
        setShowUpdateNotification(true);
      });

      const cleanupProgress = globalThis.electronAPI.onUpdateProgress(() => {
        // Progress updates received but not currently displayed
      });

      const cleanupDownloaded = globalThis.electronAPI.onUpdateDownloaded(() => {
        // Auto-install once download completes
        globalThis.electronAPI!.installUpdate();
        setUpdateState("restarting");
      });

      const cleanupError = globalThis.electronAPI.onUpdateError((message) => {
        console.error('[Update] Error:', message);
        setUpdateState("idle");
      });

      return () => {
        cleanupAvailable();
        cleanupProgress();
        cleanupDownloaded();
        cleanupError();
      };
    }

    // Non-Electron (or Windows Electron portable): check via Go backend REST API
    const timer = setTimeout(() => {
      fetch("/api/update/check")
        .then((r) => r.json())
        .then((d: { available: boolean; latest_version: string; download_url: string }) => {
          if (d.available) {
            setUpdateInfo(d);
            setShowUpdateNotification(true);
          }
        })
        .catch(() => {});
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  const applyUpdate = async () => {
    if (!updateInfo) return;

    // Windows Electron (portable): open the GitHub release page so the
    // user can download the new version manually.
    if (globalThis.electronAPI?.platform === "win32") {
      globalThis.open(
        `https://github.com/ZSleyer/Encounty/releases/tag/${updateInfo.latest_version}`,
        "_blank",
      );
      setShowUpdateNotification(false);
      return;
    }

    setUpdateState("installing");

    if (globalThis.electronAPI) {
      // Electron Linux: download via electron-updater IPC
      try {
        await globalThis.electronAPI.downloadUpdate();
      } catch {
        setUpdateState("idle");
      }
      return;
    }

    // Non-Electron: REST-based update
    try {
      await fetch("/api/update/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ download_url: updateInfo.download_url }),
      });
      setUpdateState("restarting");
      const pollBackend = () => {
        fetch("/api/version", { cache: "no-store" })
          .then(() => globalThis.location.reload())
          .catch(() => setTimeout(pollBackend, 1000));
      };
      setTimeout(pollBackend, 2000);
    } catch {
      setUpdateState("idle");
    }
  };

  // Warn user when closing the tab while backend is still running.
  // Shows the browser's native "Leave page?" dialog as a last resort.
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isConnected && !quitting && !restarting && updateState === "idle" && !globalThis.electronAPI) {
        e.preventDefault();
      }
    };
    globalThis.addEventListener("beforeunload", handleBeforeUnload);
    return () => globalThis.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isConnected, quitting, restarting, updateState]);

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

  // Sync crisp-sprites attribute from backend settings whenever state arrives
  useEffect(() => {
    if (appState?.settings.crisp_sprites) {
      document.documentElement.dataset.crispSprites = "";
    } else if (appState) {
      delete document.documentElement.dataset.crispSprites;
    }
  }, [appState?.settings.crisp_sprites]);

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
    await fetch("/api/quit", { method: "POST" }).catch(() => {});
    // Try to close the tab (works if opened via globalThis.open)
    globalThis.close();
  }, [t]);

  useWebSocket(
    (msg: WSMessage) => {
      if (msg.type === "state_update") {
        const newState = msg.payload as AppState;
        setAppState(newState);
        setConnected(true);
        // Clear detector status entries for pokémon whose detector is disabled,
        // so the UI correctly shows them as stopped.
        for (const p of newState.pokemon ?? []) {
          if (!p.detector_config?.enabled) {
            clearDetectorStatus(p.id);
          }
        }
      } else if (msg.type === "encounter_added") {
        const p = msg.payload as { pokemon_id: string; count: number };
        flashPokemon(p.pokemon_id);
        const pokemon = appState?.pokemon.find((x) => x.id === p.pokemon_id);
        if (pokemon) {
          pushToast({
            type: "encounter",
            title: pokemon.name,
            message: `${p.count} ${t("settings.encounterToast")}`,
            spriteUrl: pokemon.sprite_url || undefined,
          });
        }
      } else if (msg.type === "encounter_removed") {
        const p = msg.payload as { pokemon_id: string; count: number };
        const pokemon = appState?.pokemon.find((x) => x.id === p.pokemon_id);
        if (pokemon) {
          pushToast({
            type: "encounter",
            badge: "-1",
            spriteUrl: pokemon.sprite_url || undefined,
            title: pokemon.name,
            message: `${p.count} ${t("settings.encounterToast")}`,
          });
        }
      } else if (msg.type === "encounter_reset") {
        const p = msg.payload as { pokemon_id: string };
        const pokemon = appState?.pokemon.find((x) => x.id === p.pokemon_id);
        if (pokemon) {
          pushToast({
            type: "encounter",
            badge: "0",
            spriteUrl: pokemon.sprite_url || undefined,
            title: pokemon.name,
            message: t("app.counterReset") || "Zähler zurückgesetzt",
          });
        }
      } else if (msg.type === "pokemon_completed") {
        const p = msg.payload as { pokemon_id: string };
        const pokemon = appState?.pokemon.find((x) => x.id === p.pokemon_id);
        if (pokemon) {
          pushToast({
            type: "encounter",
            badge: "✔",
            spriteUrl: pokemon.sprite_url || undefined,
            title: pokemon.name,
            message:
              t("app.pokemonCompleted") || "Jagd erfolgreich abgeschlossen!",
          });
        }
      } else if (msg.type === "pokemon_deleted") {
        const p = msg.payload as { pokemon_id: string };
        const pokemon = appState?.pokemon.find((x) => x.id === p.pokemon_id);
        if (pokemon) {
          pushToast({
            type: "encounter",
            badge: "🗑",
            spriteUrl: pokemon.sprite_url || undefined,
            title: pokemon.name,
            message: t("app.pokemonDeleted") || "Pokémon entfernt",
          });
        }
      } else if (msg.type === "detector_status") {
        const p = msg.payload as { pokemon_id: string; state: string; confidence: number; poll_ms: number };
        setDetectorStatus(p.pokemon_id, {
          state: p.state,
          confidence: p.confidence,
          poll_ms: p.poll_ms,
        } as DetectorStatusEntry);
      } else if (msg.type === "detector_match") {
        // counter already incremented by backend; encounter_added fires separately
      }
    },
    () => setConnected(true),
    () => setConnected(false),
  );

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
      {/* Close-tab warning modal */}
      {showCloseWarning && (
        <div className="fixed inset-0 z-[95] bg-black/50 backdrop-blur-sm flex items-center justify-center animate-fadeIn">
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
          updateState={updateState as "installing" | "restarting"}
          version={updateInfo.latest_version}
        />
      )}
      {showUpdateNotification && updateInfo && updateState === "idle" && (
        <UpdateNotification
          version={updateInfo.latest_version}
          manualDownload={globalThis.electronAPI?.platform === "win32"}
          onUpdate={() => {
            setShowUpdateNotification(false);
            applyUpdate();
          }}
          onDismiss={() => setShowUpdateNotification(false)}
        />
      )}
      <div className="switch-waves-container">
        <div className="switch-waves" />
      </div>
      {/* ── Horizontal Header + Nav ──────────────────────────── */}
      <header
        className="flex items-center h-12 2xl:h-14 px-4 bg-bg-secondary shrink-0 relative z-10"
        style={{
          WebkitAppRegion: "drag",
        } as React.CSSProperties}
        onDoubleClick={() => globalThis.electronAPI?.maximize()}
      >
        {/* Left: Logo + Nav tabs */}
        <div className="flex items-center gap-1 mr-auto" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          {/* Logo */}
          <img
            src="/app-icon.png"
            alt="Encounty Logo"
            className="w-7 h-7 2xl:w-8 2xl:h-8 rounded-md object-contain shrink-0 mr-3 transition-shadow hover:shadow-[0_0_12px_rgba(255,255,255,0.2)]"
            title="Encounty"
          />

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
        </div>


        {/* Right: Window controls (Electron only) */}
        <div className="flex items-center ml-auto h-full">
          <WindowControls />
        </div>
      </header>
      <div className="glow-line-h shrink-0" />

      {/* ── Main content ─────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/hotkeys" element={<HotkeyPage />} />
          <Route path="/overlay-editor" element={<OverlayEditorPage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/overlay/:pokemonId" element={<Overlay />} />
          <Route path="/overlay" element={<Overlay />} />
        </Routes>
      </div>

      {/* ── Footer ───────────────────────────────────────────── */}
      <div className="shrink-0">
        <div className="footer-line" />
        <footer className="h-8 2xl:h-10 px-5 grid grid-cols-3 items-center text-[10px] 2xl:text-xs text-text-faint select-none">
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

          {/* Center: WS connection + Stats */}
          <div className="flex items-center justify-center gap-3">
            <div
              className={`flex items-center gap-1.5 transition-colors duration-300 ${
                isConnected
                  ? "text-text-faint"
                  : !isConnected && appState === null
                    ? "text-amber-400/70"
                    : "text-accent-red/70"
              }`}
              title={
                isConnected
                  ? t("nav.connected")
                  : appState === null
                    ? t("nav.connecting")
                    : t("nav.disconnected")
              }
            >
              <div
                className={`w-1.5 h-1.5 2xl:w-2 2xl:h-2 rounded-full shrink-0 ${
                  isConnected
                    ? "bg-accent-green/60"
                    : appState === null
                      ? "bg-amber-400/70"
                      : "bg-accent-red/70"
                }`}
              />
              <span className="font-medium tracking-wide">
                {isConnected
                  ? t("nav.connected")
                  : appState === null
                    ? t("nav.connecting")
                    : t("nav.disconnected")}
              </span>
            </div>
            {appState && appState.pokemon.length > 0 && (
              <>
                <span className="text-text-faint/30">|</span>
                <span className="font-medium tracking-wide">
                  {appState.pokemon.filter((p) => !p.completed_at).length} {t("footer.hunts")} · {appState.pokemon.reduce((s, p) => s + p.encounters, 0)} {t("footer.encounters")}
                </span>
              </>
            )}
          </div>

          {/* Right: Brand Links */}
          <div className="flex items-center justify-end gap-3">
            <a
              href="https://github.com/ZSleyer/Encounty"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:text-text-muted transition-colors font-medium"
            >
              <GithubIcon className="w-3 h-3" />
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

/** Gated shell that shows the license dialog on first launch. */
function LicenseGate() {
  const [status, setStatus] = useState<"loading" | "pending" | "accepted">("loading");

  useEffect(() => {
    fetch("/api/state")
      .then((r) => r.json())
      .then((s: AppState) => setStatus(s.license_accepted ? "accepted" : "pending"))
      .catch(() => setStatus("pending"));
  }, []);

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
    <>
      <AppShell />
      <ToastContainer />
    </>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <ToastProvider>
          <CaptureServiceProvider>
            <LicenseGate />
          </CaptureServiceProvider>
        </ToastProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
