/**
 * App.tsx: Root component tree.
 *
 * App wraps the application in ThemeProvider, I18nProvider, and ToastProvider,
 * then renders AppShell which owns the navigation header, route outlets, and
 * the global WebSocket connection. The /overlay route renders the bare Overlay
 * page without any chrome so it can be used as an OBS Browser Source.
 */
import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { Routes, Route, useLocation } from "react-router";
import {
  BookOpen,
  LayoutGrid,
  Settings as SettingsIcon,
  Power,
  Keyboard,
  Layers,
  ArrowUpCircle,
  Bot,
  Star,
} from "lucide-react";
import { Dashboard } from "./pages/Dashboard";
import { Overlay } from "./pages/Overlay";
import { useWebSocket, WebSocketProvider } from "./hooks/useWebSocket";
import { useCounterStore } from "./hooks/useCounterState";
import { AppState, ACCENT_COLORS } from "./types";
import { I18nProvider, useI18n } from "./contexts/I18nContext";
import { ThemeProvider, useMotion } from "./contexts/ThemeContext";
import { ToastProvider, useToast } from "./contexts/ToastContext";
import { ToastContainer } from "./components/shared/ToastContainer";
import { WindowControls } from "./components/settings/WindowControls";
import { LicenseDialog } from "./components/settings/LicenseDialog";
import { apiUrl } from "./utils/api";
import { CaptureServiceProvider } from "./contexts/CaptureServiceContext";
import { ErrorBoundary } from "./components/shared/ErrorBoundary";
import { SupportPrompt } from "./components/shared/SupportPrompt";
import {
  takePendingPrompt,
  clearPendingPrompt,
  REPO_URL,
  type PromptVariant,
} from "./utils/supportPrompt";
import { PAGES_UPDATE_URL } from "./utils/links";
import { LEGACY_ACCENTS } from "./app/accents";
import { CloseTabWarning } from "./app/CloseTabWarning";
import { NavTab } from "./app/NavTab";
import { PreparingScreen } from "./app/PreparingScreen";
import { UpdateNotification } from "./app/UpdateNotification";
import { UpdateOverlay } from "./app/UpdateOverlay";
import { useWSMessageHandler } from "./app/useWSMessageHandler";

/**
 * Secondary routes are split off the entry chunk. Dashboard and Overlay stay
 * static: Dashboard is always mounted so it would never benefit, and Overlay
 * is the OBS browser source, which should not depend on a second request.
 */
const DexPage = lazy(async () => ({ default: (await import("./pages/DexPage")).DexPage }));
const HotkeyPage = lazy(async () => ({
  default: (await import("./pages/HotkeyPage")).HotkeyPage,
}));
const OverlayEditorPage = lazy(async () => ({
  default: (await import("./pages/OverlayEditorPage")).OverlayEditorPage,
}));
const Settings = lazy(async () => ({ default: (await import("./pages/Settings")).Settings }));

function AppShell() {
  const location = useLocation();
  const isOverlay = location.pathname === "/overlay" || location.pathname.startsWith("/overlay/");
  // Narrow selectors: subscribe only to the fields this shell actually reads.
  // A bare useCounterStore() would re-render the whole tree on every
  // detectorStatus / flashingIds change (several times per second per hunt).
  const setConnected = useCounterStore((s) => s.setConnected);
  const isConnected = useCounterStore((s) => s.isConnected);
  const appState = useCounterStore((s) => s.appState);
  const { t, isMachineTranslated } = useI18n();
  const { push: pushToast } = useToast();
  const { motion } = useMotion();

  // Direction-aware route reveal. Nav order defines the wipe direction:
  // moving to a tab further right wipes in from the right, further left
  // from the left. Computed at render time so the keyed wrapper below
  // carries the correct class on its first paint.
  const revealDirRef = useRef<"ltr" | "rtl">("rtl");
  const prevPathRef = useRef(location.pathname);
  // The always-mounted Dashboard cannot be keyed (remount would drop hunt UI
  // state), so its reveal class is toggled when navigating back here. Set the
  // flag during render (not in an effect): an effect fires after the first
  // paint, so the Dashboard would paint fully visible for one frame and then
  // jump back to the clipped animation start, that backward jump is the
  // flicker. Setting it here means the reveal class is on the first paint.
  const [dashboardReveal, setDashboardReveal] = useState(location.pathname === "/");
  if (prevPathRef.current !== location.pathname) {
    const order = ["/", "/dex", "/hotkeys", "/overlay-editor", "/settings"];
    const from = order.indexOf(prevPathRef.current);
    const to = order.indexOf(location.pathname);
    revealDirRef.current = to >= from ? "rtl" : "ltr";
    if (location.pathname === "/") setDashboardReveal(true);
    prevPathRef.current = location.pathname;
  }
  const revealClass = revealDirRef.current === "rtl" ? "anim-t-reveal-rtl" : "anim-t-reveal";

  // Mark non-overlay documents as "app" and mirror the motion preference as a
  // DOM attribute so index.css can gate animations. Overlay routes get neither
  // attribute, which exempts the OBS browser source by construction.
  useEffect(() => {
    const root = document.documentElement;
    if (isOverlay) {
      delete root.dataset.route;
      delete root.dataset.motion;
      return;
    }
    root.dataset.route = "app";
    if (motion === "off") {
      root.dataset.motion = "off";
    } else {
      delete root.dataset.motion;
    }
  }, [isOverlay, motion]);

  const [quitting, setQuitting] = useState(false);
  const [buildInfo, setBuildInfo] = useState("Encounty");
  const [updateInfo, setUpdateInfo] = useState<{
    available: boolean;
    latest_version: string;
    download_url: string;
  } | null>(null);
  const [updateState, setUpdateState] = useState<
    "idle" | "downloading" | "installing" | "restarting"
  >("idle");
  const [updatePercent, setUpdatePercent] = useState<number | null>(null);
  const [showUpdateNotification, setShowUpdateNotification] = useState(false);
  const [showCloseWarning, setShowCloseWarning] = useState(false);
  const [supportVariant, setSupportVariant] = useState<PromptVariant | null>(null);
  const supportEvaluatedRef = useRef(false);

  const [buildDate, setBuildDate] = useState("");

  // Give each route a distinct document title (WCAG 2.4.2 Page Titled).
  // The /overlay route is an OBS browser-source page, not app chrome, so its
  // title is left untouched.
  useEffect(() => {
    if (isOverlay) return;
    const routeTitles: Record<string, string> = {
      "/": t("nav.dashboard"),
      "/dex": t("nav.dex"),
      "/hotkeys": t("nav.hotkeys"),
      "/overlay-editor": t("nav.overlayEditor"),
      "/settings": t("nav.settings"),
    };
    const label = routeTitles[location.pathname];
    document.title = label ? `${label} · ${t("app.name")}` : t("app.name");
  }, [location.pathname, isOverlay, t]);

  useEffect(() => {
    fetch(apiUrl("/api/version"))
      .then((r) => r.json())
      .then((d: { display: string; build_date: string }) => {
        setBuildInfo(`Encounty ${d.display}`);
        setBuildDate(d.build_date);
      })
      .catch(() => setBuildInfo("Encounty"));
  }, []);

  // --- Update check ---
  // Auto-update builds (Linux AppImage, Windows NSIS install): electron-updater IPC.
  // Portable Windows / macOS DMG / browser: check via Go backend REST API.
  useEffect(() => {
    if (globalThis.electronAPI?.autoUpdate) {
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

      const cleanupProgress = globalThis.electronAPI.onUpdateProgress((progress) => {
        setUpdatePercent(progress.percent);
      });

      const cleanupDownloaded = globalThis.electronAPI.onUpdateDownloaded(() => {
        setUpdateState("installing");
        globalThis.electronAPI!.installUpdate();
        setUpdateState("restarting");
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
    }

    // Windows/macOS Electron or browser: check via backend REST API
    const timer = setTimeout(() => {
      fetch(apiUrl("/api/update/check"))
        .then((r) => r.json())
        .then((d: { available: boolean; latest_version: string }) => {
          if (d.available) {
            setUpdateInfo({
              available: true,
              latest_version: d.latest_version,
              download_url: `https://github.com/ZSleyer/Encounty/releases/tag/${d.latest_version}`,
            });
            if (!sessionStorage.getItem("update_dismissed")) {
              setShowUpdateNotification(true);
            }
          }
        })
        .catch(() => {});
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  const applyUpdate = async () => {
    if (!updateInfo) return;

    // Builds without in-app auto-update (portable Windows, macOS DMG, browser):
    // open the GitHub Pages download page with per-OS instructions. An OS
    // anchor jumps straight to the matching section when the platform is known.
    if (!globalThis.electronAPI?.autoUpdate) {
      const platform = globalThis.electronAPI?.platform;
      let anchor = "";
      if (platform === "darwin") {
        anchor = "#macos";
      } else if (platform === "win32") {
        anchor = "#windows";
      }
      globalThis.open(`${PAGES_UPDATE_URL}${anchor}`, "_blank");
      setShowUpdateNotification(false);
      return;
    }

    // Auto-update builds: download via electron-updater IPC (auto-installs on
    // completion). The download is its own step, so the overlay can report
    // progress instead of claiming an install that has not started.
    setUpdatePercent(null);
    setUpdateState("downloading");
    if (globalThis.electronAPI) {
      try {
        await globalThis.electronAPI.downloadUpdate();
      } catch {
        setUpdateState("idle");
      }
    }
  };

  // Reload/close warning disabled, Electron handles window lifecycle,
  // and in dev mode the native dialog interferes with HMR and testing.

  // Intercept Ctrl+W / Cmd+W to show custom warning modal instead of closing
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "w") {
        if (isConnected && !quitting && updateState === "idle" && !globalThis.electronAPI) {
          e.preventDefault();
          setShowCloseWarning(true);
        }
      }
    };
    globalThis.addEventListener("keydown", handleKeyDown);
    return () => globalThis.removeEventListener("keydown", handleKeyDown);
  }, [isConnected, quitting, updateState]);

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

  // Apply the user's accent color preset by setting `data-accent` on <html>.
  // CSS in index.css matches `[data-accent="..."]` selectors and overrides
  // --accent-blue accordingly. Legacy keys from old backups are mapped to the
  // Tempest presets. The overlay routes use the same accent so the streaming
  // view stays consistent with the rest of the app.
  useEffect(() => {
    const raw = appState?.settings.accent_color ?? "violet";
    const accent = (ACCENT_COLORS as readonly string[]).includes(raw)
      ? raw
      : (LEGACY_ACCENTS[raw] ?? "violet");
    document.documentElement.dataset.accent = accent;
  }, [appState?.settings.accent_color]);

  // --- Support nudge (startup only) ---
  // Evaluate once, when the first app state arrives. A deferred prompt is shown
  // only right after a clean start; if a hunt is already running we skip it for
  // this session so the nudge never interrupts an ongoing hunt.
  useEffect(() => {
    if (supportEvaluatedRef.current || !appState) return;
    supportEvaluatedRef.current = true;
    const huntRunning = appState.pokemon.some((p) => p.timer_started_at && !p.completed_at);
    if (huntRunning) return;
    const pending = takePendingPrompt();
    if (pending) {
      clearPendingPrompt();
      setSupportVariant(pending);
    }
  }, [appState]);

  const quitApp = useCallback(async () => {
    if (!confirm(t("app.confirmQuit"))) return;
    setQuitting(true);
    setShowCloseWarning(false);
    await fetch(apiUrl("/api/quit"), { method: "POST" }).catch(() => {});
    // Try to close the tab (works if opened via globalThis.open)
    globalThis.close();
  }, [t]);

  // --- WebSocket message handler ---
  const handleWSMessage = useWSMessageHandler();

  useWebSocket(
    handleWSMessage,
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
    <div
      className={`flex flex-col h-screen text-text-primary overflow-hidden relative ${isOverlay ? "bg-transparent" : "bg-bg-primary"}`}
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-100 focus:px-4 focus:py-2 focus:bg-accent-blue focus:text-white focus:rounded-none focus:text-sm"
      >
        {t("aria.skipToContent")}
      </a>
      {/* Close-tab warning modal */}
      {showCloseWarning && (
        <CloseTabWarning onStay={() => setShowCloseWarning(false)} onQuit={quitApp} />
      )}

      {updateState !== "idle" && updateInfo && (
        <UpdateOverlay
          updateState={updateState}
          percent={updatePercent}
          version={updateInfo.latest_version}
        />
      )}
      {showUpdateNotification && updateInfo && updateState === "idle" && (
        <UpdateNotification
          version={updateInfo.latest_version}
          manualDownload={!globalThis.electronAPI?.autoUpdate}
          packageManaged={globalThis.electronAPI?.packageManaged}
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
      {supportVariant && (
        <SupportPrompt variant={supportVariant} onClose={() => setSupportVariant(null)} />
      )}
      {/* ── Horizontal Header + Nav ──────────────────────────── */}
      <header
        className={`flex items-center h-12 2xl:h-14 bg-bg-secondary shrink-0 relative z-10 ${globalThis.electronAPI?.platform === "darwin" ? "pl-19.5 pr-4" : "px-4"}`}
        style={
          {
            WebkitAppRegion: "drag",
          } as React.CSSProperties
        }
        role="banner"
        onDoubleClick={() => {
          // Same reason the maximize button is hidden under Hyprland: the
          // compositor owns the geometry, so the request goes nowhere.
          if (!globalThis.electronAPI?.isHyprland) globalThis.electronAPI?.maximize();
        }}
      >
        {/* Left: Logo + Nav tabs */}
        {/* min-w-0 plus horizontal scrolling so the tabs never push past the
            window controls. They are no-drag while the bar is drag, so an
            overflowing tab would sit on top of the close button and swallow the
            click. Locales with longer labels than German reach that point on a
            1080p screen at high display scaling. */}
        <div
          className="flex items-center gap-1 mr-auto min-w-0 overflow-x-auto"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {/* Logo — hidden on macOS where traffic light buttons occupy this space */}
          {globalThis.electronAPI?.platform !== "darwin" && (
            <img
              src="/app-icon.png"
              alt="Encounty Logo"
              className="w-7 h-7 2xl:w-8 2xl:h-8 rounded-none object-contain shrink-0 mr-3 transition-shadow hover:shadow-[0_0_12px_rgba(255,255,255,0.2)]"
              title="Encounty"
            />
          )}

          <NavTab to="/" icon={<LayoutGrid className="w-4 h-4 2xl:w-5 2xl:h-5" />}>
            {t("nav.dashboard")}
          </NavTab>
          <NavTab to="/dex" icon={<BookOpen className="w-4 h-4 2xl:w-5 2xl:h-5" />}>
            {t("nav.dex")}
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
              onClick={() =>
                pushToast({
                  type: "info",
                  title: t("settings.autoTranslated"),
                  message: t("app.machineTranslationDisclaimer"),
                  duration: 8000,
                })
              }
              className="shrink-0 whitespace-nowrap flex items-center gap-1 px-2 py-1 rounded-none text-[10px] 2xl:text-xs text-accent-yellow bg-accent-yellow/10 hover:bg-accent-yellow/20 transition-colors"
              title={t("app.machineTranslationDisclaimer")}
            >
              <Bot className="w-3 h-3" />
              {t("settings.autoTranslated")}
            </button>
          )}
        </div>

        {/* Right: Window controls (Windows/Linux) or logo (macOS) */}
        <div className="flex items-center ml-auto h-full shrink-0">
          {globalThis.electronAPI?.platform === "darwin" ? (
            <img
              src="/app-icon.png"
              alt="Encounty Logo"
              className="w-7 h-7 2xl:w-8 2xl:h-8 rounded-none object-contain mr-2 transition-shadow hover:shadow-[0_0_12px_rgba(255,255,255,0.2)]"
              title="Encounty"
            />
          ) : (
            <WindowControls />
          )}
        </div>
      </header>
      <div className="h-px shrink-0 bg-border-subtle" />

      {/* ── Main content ─────────────────────────────────────── */}
      {/* Dashboard stays mounted when navigating to overlay editor. It cannot
          be keyed for the route reveal (a remount would drop hunt UI state),
          so the reveal class is toggled instead when navigating back here. */}
      <div
        className={
          location.pathname === "/"
            ? `flex-1 overflow-hidden flex flex-col${dashboardReveal ? ` ${revealClass}` : ""}`
            : "hidden"
        }
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget && e.animationName.startsWith("t-reveal")) {
            setDashboardReveal(false);
          }
        }}
      >
        <Dashboard isActiveRoute={location.pathname === "/"} />
      </div>
      {location.pathname !== "/" && (
        <div
          key={location.pathname}
          className={`flex-1 overflow-hidden flex flex-col ${revealClass}`}
          onAnimationEnd={(e) => {
            // Drop the reveal class once done: a lingering clip-path would
            // clip fixed-position dialogs rendered inside routed pages and
            // create a stacking context that paints below the z-10 header.
            if (e.target === e.currentTarget && e.animationName.startsWith("t-reveal")) {
              e.currentTarget.classList.remove("anim-t-reveal", "anim-t-reveal-rtl");
            }
          }}
        >
          <ErrorBoundary>
            <Suspense fallback={null}>
              <Routes>
                <Route path="/" element={null} />
                <Route path="/dex" element={<DexPage />} />
                <Route path="/hotkeys" element={<HotkeyPage />} />
                <Route path="/overlay-editor" element={<OverlayEditorPage />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/overlay/:pokemonId" element={<Overlay />} />
                <Route path="/overlay" element={<Overlay />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </div>
      )}

      {/* ── Footer ───────────────────────────────────────────── */}
      <div className="shrink-0">
        <div className="h-px bg-border-subtle" />
        <footer className="h-8 2xl:h-10 px-5 grid grid-cols-3 items-center text-xs text-text-muted select-none bg-bg-secondary">
          {/* Left: Build Info + Build Date + Update Badge */}
          <div className="flex items-center justify-start gap-2">
            <a
              href="https://github.com/ZSleyer/Encounty"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold tracking-wide text-text-muted hover:text-text-primary transition-colors"
            >
              {buildInfo}
            </a>
            {buildDate && <span className="text-text-muted">({buildDate})</span>}
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("aria.supportStar")}
              title={t("support.star")}
              className="flex items-center text-text-muted hover:text-accent-blue transition-colors"
            >
              <Star className="w-3 h-3" />
            </a>
            {updateInfo && updateState === "idle" && (
              <button
                onClick={applyUpdate}
                title={`${t("update.tooltip")} (${updateInfo.latest_version})`}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded-none bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25 transition-colors font-semibold"
              >
                <ArrowUpCircle className="w-3 h-3" />
                <span>{updateInfo.latest_version}</span>
              </button>
            )}
          </div>

          {/* Center */}
          <p className="text-center">
            <a
              href="https://www.youtube.com/watch?v=SiTi3WCmzfc"
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-faint tracking-wide hover:text-text-muted transition-colors"
            >
              「Foreshadow」
            </a>
          </p>

          {/* Right: Copyright */}
          <span className="text-end">
            {"\u00A9 " +
              (new Date().getFullYear() === 2026
                ? "2026"
                : "2026\u2013" + new Date().getFullYear()) +
              " "}
            <a
              href="https://youtube.com/@ZSleyer"
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-muted hover:text-text-primary transition-colors"
            >
              ZSleyer
            </a>
          </span>
        </footer>
      </div>
    </div>
  );
}

/* ── Root App, wraps providers ──────────────────────────────── */

/** Shape returned by GET /api/status/ready. */
interface ReadyStatus {
  ready: boolean;
  dev_mode: boolean;
  setup_pending: boolean;
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

  // No polling needed, PreparingScreen's WebSocket connection handles readiness via onReady callback

  // Check license status once the server is ready (and no setup pending)
  useEffect(() => {
    if (!readyStatus || (!readyStatus.ready && !readyStatus.setup_pending)) return;
    if (readyStatus.setup_pending) return; // setup choice screen will handle transition
    fetch(apiUrl("/api/state"))
      .then((r) => r.json())
      .then((s: AppState) => setStatus(s.license_accepted ? "accepted" : "pending"))
      .catch(() => setStatus("pending"));
  }, [readyStatus]);

  // Overlay routes skip the entire gate flow (license, setup, sync), they
  // only need the WebSocket state stream which AppShell already provides.
  // AppShell still requires CaptureServiceProvider because it calls
  // useCaptureService() for the hunt_start_requested hotkey handler.
  if (isOverlay) {
    return (
      <CaptureServiceProvider>
        <WebSocketProvider>
          <AppShell />
        </WebSocketProvider>
      </CaptureServiceProvider>
    );
  }

  // Server readiness unknown yet, show loading spinner
  if (readyStatus === null) {
    return (
      <div className="flex items-center justify-center h-screen bg-transparent">
        <div className="w-10 h-10 border-3 border-accent-blue border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Setup pending (dev mode), show setup choice screen
  if (readyStatus.setup_pending) {
    return (
      <PreparingScreen
        onReady={() =>
          setReadyStatus({ ready: true, dev_mode: readyStatus.dev_mode, setup_pending: false })
        }
        setupPending
        devMode={readyStatus.dev_mode}
      />
    );
  }

  // Server not ready, show preparing screen with progress
  if (!readyStatus.ready) {
    return <PreparingScreen onReady={() => setReadyStatus({ ...readyStatus, ready: true })} />;
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
      <WebSocketProvider>
        <AppShell />
        <ToastContainer />
      </WebSocketProvider>
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
