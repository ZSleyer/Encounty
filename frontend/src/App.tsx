import { Routes, Route, Link, useLocation } from "react-router-dom";
import {
  LayoutGrid,
  Settings as SettingsIcon,
  Sun,
  Moon,
  Globe,
} from "lucide-react";
import { Dashboard } from "./pages/Dashboard";
import { Settings } from "./pages/Settings";
import { Overlay } from "./pages/Overlay";
import { useWebSocket } from "./hooks/useWebSocket";
import { useCounterStore } from "./hooks/useCounterState";
import { WSMessage, AppState } from "./types";
import { I18nProvider, useI18n } from "./contexts/I18nContext";
import { ThemeProvider, useTheme } from "./contexts/ThemeContext";
import { LOCALES, Locale } from "./utils/i18n";

function AppShell() {
  const location = useLocation();
  const isOverlay = location.pathname === "/overlay";
  const { setAppState, setConnected, flashPokemon, isConnected } =
    useCounterStore();
  const { t, locale, setLocale } = useI18n();
  const { theme, toggleTheme } = useTheme();

  useWebSocket(
    (msg: WSMessage) => {
      if (msg.type === "state_update") {
        setAppState(msg.payload as AppState);
        setConnected(true);
      } else if (msg.type === "encounter_added") {
        const p = msg.payload as { pokemon_id: string; count: number };
        flashPokemon(p.pokemon_id);
      }
    },
    () => setConnected(true),
    () => setConnected(false),
  );

  if (isOverlay) {
    return <Overlay />;
  }

  return (
    <div className="flex flex-col h-screen bg-bg-primary text-text-primary overflow-hidden">
      {/* ── Horizontal Header + Nav ──────────────────────────── */}
      <header className="flex items-center h-12 px-4 bg-bg-secondary border-b border-border-subtle flex-shrink-0">
        {/* Left: Logo + Nav tabs */}
        <div className="flex items-center gap-1 mr-auto">
          {/* Logo */}
          <div
            className="w-7 h-7 bg-accent-red rounded-lg flex items-center justify-center flex-shrink-0 mr-3"
            title="Encounty"
          >
            <span className="text-white font-black text-xs">E</span>
          </div>

          <NavTab to="/" icon={<LayoutGrid className="w-4 h-4" />}>
            {t("nav.dashboard")}
          </NavTab>
          <NavTab to="/settings" icon={<SettingsIcon className="w-4 h-4" />}>
            {t("nav.settings")}
          </NavTab>
        </div>

        {/* Center: Connection */}
        <div className="flex items-center gap-4 text-xs text-text-muted">
          <div
            className={`flex items-center gap-1.5 ${isConnected ? "text-accent-green" : "text-accent-red"}`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${isConnected ? "bg-accent-green" : "bg-accent-red"}`}
            />
            {isConnected ? t("nav.connected") : t("nav.disconnected")}
          </div>
        </div>

        {/* Right: Theme + Locale */}
        <div className="flex items-center gap-1 ml-auto">
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

      {/* ── Main content ─────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/overlay" element={<Overlay />} />
        </Routes>
      </div>

      {/* ── Footer ───────────────────────────────────────────── */}
      <div className="flex-shrink-0">
        <div className="footer-line" />
        <footer className="h-8 px-5 flex items-center justify-between text-[10px] text-text-faint select-none">
          <div className="flex items-center gap-2">
            <span className="font-bold tracking-widest uppercase text-text-muted">
              Encounty
            </span>
            <span className="text-text-faint/30">|</span>
            <span className="tracking-wide">
              &copy; {new Date().getFullYear()} ZSleyer
            </span>
          </div>
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
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
        isActive
          ? "bg-accent-blue/15 text-accent-blue"
          : "text-text-muted hover:text-text-primary hover:bg-bg-hover"
      }`}
    >
      {icon}
      {children}
    </Link>
  );
}

/* ── Root App — wraps providers ──────────────────────────────── */

export function App() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <AppShell />
      </I18nProvider>
    </ThemeProvider>
  );
}
