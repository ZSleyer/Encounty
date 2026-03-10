/**
 * App.tsx — Root component tree.
 *
 * App wraps the application in ThemeProvider, I18nProvider, and ToastProvider,
 * then renders AppShell which owns the navigation header, route outlets, and
 * the global WebSocket connection. The /overlay route renders the bare Overlay
 * page without any chrome so it can be used as an OBS Browser Source.
 */
import { useState, useEffect } from "react";
import { Routes, Route, Link, useLocation } from "react-router-dom";
import {
  LayoutGrid,
  Settings as SettingsIcon,
  Sun,
  Moon,
  Globe,
  Power,
  RefreshCcw,
  Keyboard,
  Github,
  ArrowUpCircle,
} from "lucide-react";
import { Dashboard } from "./pages/Dashboard";
import { Settings } from "./pages/Settings";
import { HotkeyPage } from "./pages/HotkeyPage";
import { Overlay } from "./pages/Overlay";
import { useWebSocket } from "./hooks/useWebSocket";
import { useCounterStore, DetectorStatusEntry } from "./hooks/useCounterState";
import { WSMessage, AppState } from "./types";
import { I18nProvider, useI18n } from "./contexts/I18nContext";
import { ThemeProvider, useTheme } from "./contexts/ThemeContext";
import { ToastProvider, useToast } from "./contexts/ToastContext";
import { ToastContainer } from "./components/ToastContainer";
import { LOCALES, Locale } from "./utils/i18n";

/** Full-screen blocking overlay shown while an update is being installed or restarting. */
function UpdateOverlay({
  updateState,
  version,
}: {
  updateState: "installing" | "restarting";
  version: string;
}) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center animate-fadeIn">
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
}: {
  version: string;
  onUpdate: () => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-sm flex items-center justify-center animate-fadeIn">
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
            {t("update.updateNow")}
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
  const { t, locale, setLocale } = useI18n();
  const { theme, toggleTheme } = useTheme();
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

  useEffect(() => {
    fetch("/api/version")
      .then((r) => r.json())
      .then((d: { display: string }) =>
        setBuildInfo(`Encounty ${d.display}`)
      )
      .catch(() => setBuildInfo("Encounty"));
  }, []);

  useEffect(() => {
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
    setUpdateState("installing");
    try {
      await fetch("/api/update/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ download_url: updateInfo.download_url }),
      });
      setUpdateState("restarting");
      setTimeout(() => window.location.reload(), 4000);
    } catch {
      setUpdateState("idle");
    }
  };

  // Sync crisp-sprites attribute from backend settings whenever state arrives
  useEffect(() => {
    if (appState?.settings.crisp_sprites) {
      document.documentElement.setAttribute("data-crisp-sprites", "");
    } else if (appState) {
      document.documentElement.removeAttribute("data-crisp-sprites");
    }
  }, [appState?.settings.crisp_sprites]);

  const quitApp = async () => {
    if (!confirm(t("app.confirmQuit"))) return;
    setQuitting(true);
    await fetch("/api/quit", { method: "POST" }).catch(() => {});
  };

  const restartApp = async () => {
    if (!confirm(t("app.confirmRestart"))) return;
    setRestarting(true);
    await fetch("/api/restart", { method: "POST" }).catch(() => {});
    setTimeout(() => window.location.reload(), 1500);
  };

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

  return (
    <div className="flex flex-col h-screen bg-transparent text-text-primary overflow-hidden relative">
      {updateState !== "idle" && updateInfo && (
        <UpdateOverlay
          updateState={updateState as "installing" | "restarting"}
          version={updateInfo.latest_version}
        />
      )}
      {showUpdateNotification && updateInfo && updateState === "idle" && (
        <UpdateNotification
          version={updateInfo.latest_version}
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
      <header className="flex items-center h-12 px-4 bg-bg-secondary flex-shrink-0 relative z-10">
        {/* Left: Logo + Nav tabs */}
        <div className="flex items-center gap-1 mr-auto">
          {/* Logo */}
          <img
            src="/app-icon.png"
            alt="Encounty Logo"
            className="w-7 h-7 rounded-md object-contain flex-shrink-0 mr-3 transition-shadow hover:shadow-[0_0_12px_rgba(255,255,255,0.2)]"
            title="Encounty"
          />

          <NavTab to="/" icon={<LayoutGrid className="w-4 h-4" />}>
            {t("nav.dashboard")}
          </NavTab>
          <NavTab to="/hotkeys" icon={<Keyboard className="w-4 h-4" />}>
            {t("nav.hotkeys")}
          </NavTab>
<NavTab to="/settings" icon={<SettingsIcon className="w-4 h-4" />}>
            {t("nav.settings")}
          </NavTab>
        </div>


        {/* Right: Theme + Locale */}
        <div className="flex items-center gap-1 ml-auto">
          {/* App Controls */}
          <div className="flex items-center gap-1.5 mr-2 border-r border-border-subtle pr-3">
            <button
              onClick={restartApp}
              disabled={restarting || quitting}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-amber-500 hover:bg-amber-500/10 hover:text-amber-400 transition-colors disabled:opacity-50"
              title={t("app.restart")}
            >
              <RefreshCcw
                className={`w-4 h-4 ${restarting ? "animate-spin" : ""}`}
              />
            </button>
            <button
              onClick={quitApp}
              disabled={quitting || restarting}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-500/10 hover:text-red-400 transition-colors disabled:opacity-50"
              title={t("app.quit")}
            >
              <Power className={`w-4 h-4 ${quitting ? "animate-pulse" : ""}`} />
            </button>
          </div>

          {/* Language toggle */}
          <div className="flex items-center border border-border-subtle rounded-lg overflow-hidden mr-1">
            {LOCALES.map((l) => (
              <button
                key={l.code}
                onClick={() => setLocale(l.code)}
                className={`px-2 py-1 text-[11px] font-medium transition-colors ${
                  locale === l.code
                    ? "bg-accent-blue/15 text-accent-blue"
                    : "text-text-muted hover:text-text-primary"
                }`}
                title={l.label}
              >
                {l.code.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            title={
              theme === "dark"
                ? t("settings.themeLight")
                : t("settings.themeDark")
            }
          >
            {theme === "dark" ? (
              <Sun className="w-4 h-4" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
          </button>
        </div>
      </header>
      <div className="glow-line-h flex-shrink-0" />

      {/* ── Main content ─────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/hotkeys" element={<HotkeyPage />} />
          <Route path="/overlay-editor" element={<Dashboard />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/overlay/:pokemonId" element={<Overlay />} />
          <Route path="/overlay" element={<Overlay />} />
        </Routes>
      </div>

      <ToastContainer />

      {/* ── Footer ───────────────────────────────────────────── */}
      <div className="flex-shrink-0">
        <div className="footer-line" />
        <footer className="h-8 px-5 grid grid-cols-3 items-center text-[10px] text-text-faint select-none">
          {/* Left: Build Info + Update Badge */}
          <div className="flex items-center justify-start gap-2">
            <span className="font-bold tracking-widest uppercase text-text-muted">
              {buildInfo}
            </span>
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

          {/* Center: WS connection */}
          <div className="flex items-center justify-center">
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
                className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
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
          </div>

          {/* Right: Brand Links */}
          <div className="flex items-center justify-end gap-3">
            <a
              href="https://github.com/ZSleyer/Encounty"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:text-text-muted transition-colors font-medium"
            >
              <Github className="w-3 h-3" />
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
  readonly to: string;
  readonly icon: React.ReactNode;
  readonly children: React.ReactNode;
}

function NavTab({ to, icon, children }: NavTabProps) {
  const location = useLocation();
  const isActive = location.pathname === to;

  return (
    <Link
      to={to}
      className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
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

export function App() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <ToastProvider>
          <AppShell />
        </ToastProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
