import { Routes, Route, Link, useLocation } from "react-router-dom";
import { LayoutGrid, Settings as SettingsIcon } from "lucide-react";
import { Dashboard } from "./pages/Dashboard";
import { Settings } from "./pages/Settings";
import { Overlay } from "./pages/Overlay";
import { useWebSocket } from "./hooks/useWebSocket";
import { useCounterStore } from "./hooks/useCounterState";
import { WSMessage, AppState } from "./types";

export function App() {
  const location = useLocation();
  const isOverlay = location.pathname === "/overlay";
  const { setAppState, setConnected, flashPokemon, isConnected } =
    useCounterStore();

  useWebSocket((msg: WSMessage) => {
    if (msg.type === "state_update") {
      setAppState(msg.payload as AppState);
      setConnected(true);
    } else if (msg.type === "encounter_added") {
      const p = msg.payload as { pokemon_id: string; count: number };
      flashPokemon(p.pokemon_id);
    }
  });

  if (isOverlay) {
    return <Overlay />;
  }

  return (
    <div className="flex h-screen bg-bg-primary text-white overflow-hidden">
      {/* Sidebar */}
      <nav className="w-14 flex flex-col items-center py-4 bg-bg-secondary border-r border-border-subtle gap-1 flex-shrink-0">
        {/* Logo */}
        <div
          className="mb-4 w-8 h-8 bg-accent-red rounded-lg flex items-center justify-center flex-shrink-0"
          title="Encounty"
        >
          <span className="text-white font-black text-sm">E</span>
        </div>

        <NavIcon
          to="/"
          icon={<LayoutGrid className="w-5 h-5" />}
          label="Dashboard"
        />
        <NavIcon
          to="/settings"
          icon={<SettingsIcon className="w-5 h-5" />}
          label="Einstellungen"
        />

        {/* Connection indicator at bottom */}
        <div
          className="mt-auto mb-1 flex flex-col items-center gap-1"
          title={isConnected ? "Verbunden" : "Getrennt"}
        >
          <div
            className={`w-2 h-2 rounded-full ${isConnected ? "bg-accent-green" : "bg-accent-red"}`}
          />
        </div>
      </nav>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/overlay" element={<Overlay />} />
          </Routes>
        </div>

        {/* Footer */}
        <footer className="h-10 px-6 flex items-center justify-between bg-bg-secondary/30 border-t border-border-subtle/30 text-xs text-gray-500">
          <span className="font-bold tracking-wider">
            ENCONTY - &copy; {new Date().getFullYear()} ZSleyer
          </span>
          <a
            href="https://youtube.com/@ZSleyer"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 hover:text-gray-300 transition-colors"
          >
            <svg
              viewBox="0 0 24 24"
              className="w-3.5 h-3.5 fill-red-500"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
            </svg>
            <span className="font-semibold">@ZSleyer</span>
          </a>
        </footer>
      </div>
    </div>
  );
}

interface NavIconProps {
  readonly to: string;
  readonly icon: React.ReactNode;
  readonly label: string;
}

function NavIcon({ to, icon, label }: NavIconProps) {
  const location = useLocation();
  const isActive = location.pathname === to;

  return (
    <Link
      to={to}
      title={label}
      className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all duration-150 ${
        isActive
          ? "bg-accent-blue text-white"
          : "text-gray-600 hover:text-gray-300 hover:bg-bg-hover"
      }`}
    >
      {icon}
    </Link>
  );
}
