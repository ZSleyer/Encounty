import { useState, useEffect } from "react";
import {
  Plus,
  Wifi,
  WifiOff,
  Star,
  Minus,
  RotateCcw,
  Clock,
  Zap,
  Edit2,
  Gamepad2,
} from "lucide-react";
import { AddPokemonModal, NewPokemonData } from "../components/AddPokemonModal";
import { EditPokemonModal } from "../components/EditPokemonModal";
import { ConfirmModal } from "../components/ConfirmModal";
import { useCounterStore } from "../hooks/useCounterState";
import { useWebSocket } from "../hooks/useWebSocket";
import { AppState, WSMessage, Pokemon } from "../types";

const API = "/api";

function useDuration(start: Date) {
  const [elapsed, setElapsed] = useState("");
  useEffect(() => {
    const update = () => {
      const diff = Date.now() - start.getTime();
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setElapsed(
        `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`,
      );
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [start]);
  return elapsed;
}

export function Dashboard() {
  const { appState, isConnected, flashPokemon } = useCounterStore();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingPokemon, setEditingPokemon] = useState<Pokemon | null>(null);
  const [imgError, setImgError] = useState<Record<string, boolean>>({});
  const [sessionStart] = useState(new Date());
  const elapsed = useDuration(sessionStart);

  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    isDestructive: boolean;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: "",
    message: "",
    isDestructive: false,
    onConfirm: () => {},
  });

  const { send } = useWebSocket(() => {});

  const handleIncrement = (id: string) => {
    send("increment", { pokemon_id: id });
    flashPokemon(id);
  };
  const handleDecrement = (id: string) => send("decrement", { pokemon_id: id });
  const handleReset = (id: string) => {
    setConfirmConfig({
      isOpen: true,
      title: "Zähler zurücksetzen",
      message:
        "Bist du sicher, dass du die Encounter für dieses Pokémon auf 0 setzen möchtest?",
      isDestructive: true,
      onConfirm: () => send("reset", { pokemon_id: id }),
    });
  };
  const handleActivate = (id: string) => send("set_active", { pokemon_id: id });
  const handleDelete = (id: string) => {
    setConfirmConfig({
      isOpen: true,
      title: "Pokémon löschen",
      message:
        "Willst du dieses Pokémon wirklich löschen? Alle Daten gehen unwiderruflich verloren!",
      isDestructive: true,
      onConfirm: async () => {
        await fetch(`${API}/pokemon/${id}`, { method: "DELETE" });
      },
    });
  };
  const handleAddPokemon = async (data: NewPokemonData) => {
    await fetch(`${API}/pokemon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setShowAddModal(false);
  };
  const handleSavePokemon = async (id: string, data: NewPokemonData) => {
    const p = appState!.pokemon.find((x) => x.id === id);
    const payload = { ...data, overlay: p?.overlay };
    await fetch(`${API}/pokemon/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setEditingPokemon(null);
  };

  if (!appState) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-accent-blue border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Verbinde…</p>
        </div>
      </div>
    );
  }

  const activePokemon =
    appState.pokemon.find((p) => p.id === appState.active_id) ?? null;
  const totalEncounters = appState.pokemon.reduce(
    (s, p) => s + p.encounters,
    0,
  );

  const formatGame = (game: string) =>
    game
      ? game.replace("pokemon-", "").replace("letsgo", "L.G. ").toUpperCase()
      : "—";

  const FALLBACK = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='40' fill='%23333'/><text y='.9em' font-size='60' x='50%' text-anchor='middle' dominant-baseline='middle'>?</text></svg>`;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-border-subtle bg-bg-secondary flex-shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-bold text-white">Encounty</h1>
          <div
            className={`flex items-center gap-1.5 text-xs ${isConnected ? "text-accent-green" : "text-accent-red"}`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${isConnected ? "bg-accent-green" : "bg-accent-red"}`}
            />
            {isConnected ? "Verbunden" : "Getrennt"}
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            <span className="tabular-nums">{elapsed}</span>
          </div>
          <div className="w-px h-4 bg-border-subtle" />
          <div className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-accent-yellow" />
            <span className="tabular-nums">{totalEncounters}</span>
            <span>gesamt</span>
          </div>
        </div>
      </header>

      {/* Body: split layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* LEFT: Pokemon list */}
        <aside className="w-72 flex-shrink-0 border-r border-border-subtle bg-bg-secondary flex flex-col">
          <div className="p-4 border-b border-border-subtle flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Pokémon
            </span>
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-accent-blue hover:bg-blue-500 text-white rounded-lg text-xs font-semibold transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Hinzufügen
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {appState.pokemon.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                <div className="text-4xl mb-3">🎮</div>
                <p className="text-sm text-gray-500">Noch kein Pokémon</p>
                <button
                  onClick={() => setShowAddModal(true)}
                  className="mt-4 text-xs text-accent-blue hover:underline"
                >
                  Erstes Pokémon hinzufügen →
                </button>
              </div>
            ) : (
              <ul className="py-2">
                {appState.pokemon.map((p) => {
                  const isActive = p.id === appState.active_id;
                  const src =
                    imgError[p.id] || !p.sprite_url ? FALLBACK : p.sprite_url;
                  return (
                    <li
                      key={p.id}
                      onClick={() => handleActivate(p.id)}
                      className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors group ${
                        isActive
                          ? "bg-accent-blue/10 border-r-2 border-accent-blue"
                          : "hover:bg-bg-hover"
                      }`}
                    >
                      <div className="w-9 h-9 flex-shrink-0 relative">
                        <img
                          src={src}
                          alt={p.name}
                          onError={() =>
                            setImgError((prev) => ({ ...prev, [p.id]: true }))
                          }
                          className="w-full h-full object-contain"
                          style={
                            p.sprite_style && p.sprite_style !== "classic"
                              ? undefined
                              : { imageRendering: "pixelated" }
                          }
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          {isActive && (
                            <Star className="w-3 h-3 text-accent-blue fill-accent-blue flex-shrink-0" />
                          )}
                          <span className="text-sm font-semibold text-white truncate capitalize">
                            {p.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-xs text-gray-500 tabular-nums">
                            {p.encounters} enc.
                          </span>
                          {p.game && (
                            <span className="text-[10px] text-gray-600 uppercase">
                              {formatGame(p.game)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingPokemon(p);
                          }}
                          className="p-1 rounded hover:bg-bg-secondary text-gray-500 hover:text-white transition-colors"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* RIGHT: Active Pokemon detail */}
        <main className="flex-1 flex flex-col overflow-hidden bg-bg-primary">
          {!activePokemon ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="text-6xl mb-4">✨</div>
              <h2 className="text-xl font-semibold text-white mb-2">
                Kein aktives Pokémon
              </h2>
              <p className="text-gray-500 text-sm">
                Wähle ein Pokémon aus der Liste oder füge ein neues hinzu.
              </p>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 gap-8">
              {/* Sprite */}
              <div className="relative flex items-center justify-center">
                <div className="absolute inset-0 bg-accent-blue/5 rounded-full blur-3xl scale-150" />
                <img
                  src={
                    imgError[activePokemon.id] || !activePokemon.sprite_url
                      ? FALLBACK
                      : activePokemon.sprite_url
                  }
                  alt={activePokemon.name}
                  onError={() =>
                    setImgError((prev) => ({
                      ...prev,
                      [activePokemon.id]: true,
                    }))
                  }
                  className="w-40 h-40 object-contain relative z-10 drop-shadow-2xl"
                  style={
                    activePokemon.sprite_style &&
                    activePokemon.sprite_style !== "classic"
                      ? undefined
                      : { imageRendering: "pixelated" }
                  }
                />
              </div>

              {/* Name + Game */}
              <div className="text-center">
                <h2 className="text-3xl font-black text-white capitalize tracking-wide">
                  {activePokemon.name}
                </h2>
                {activePokemon.game && (
                  <div className="flex items-center gap-1.5 justify-center mt-2">
                    <Gamepad2 className="w-3.5 h-3.5 text-gray-500" />
                    <span className="text-sm text-gray-500 uppercase tracking-wider">
                      {formatGame(activePokemon.game)}
                    </span>
                  </div>
                )}
              </div>

              {/* Counter */}
              <div className="bg-bg-card border border-border-subtle rounded-2xl px-12 py-6 text-center">
                <div className="text-7xl font-black text-white tabular-nums leading-none">
                  {activePokemon.encounters}
                </div>
                <div className="text-xs text-gray-500 uppercase tracking-widest font-semibold mt-2">
                  Begegnungen
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center gap-4">
                <button
                  onClick={() => handleDecrement(activePokemon.id)}
                  className="flex items-center justify-center w-14 h-14 rounded-2xl bg-bg-card border border-border-subtle hover:border-accent-blue/30 hover:bg-bg-hover text-gray-400 hover:text-white transition-all"
                  title="−1"
                >
                  <Minus className="w-6 h-6" />
                </button>
                <button
                  onClick={() => handleIncrement(activePokemon.id)}
                  className="flex items-center justify-center w-20 h-20 rounded-2xl bg-accent-blue hover:bg-blue-500 text-white shadow-lg shadow-accent-blue/20 transition-all hover:scale-105 active:scale-95"
                  title="+1"
                >
                  <Plus className="w-8 h-8" />
                </button>
                <button
                  onClick={() => handleReset(activePokemon.id)}
                  className="flex items-center justify-center w-14 h-14 rounded-2xl bg-bg-card border border-border-subtle hover:border-red-500/30 hover:bg-red-500/10 text-gray-400 hover:text-red-400 transition-all"
                  title="Reset"
                >
                  <RotateCcw className="w-5 h-5" />
                </button>
              </div>

              {/* Action row */}
              <div className="flex gap-3">
                <button
                  onClick={() => setEditingPokemon(activePokemon)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-bg-card border border-border-subtle hover:border-accent-blue/30 text-gray-400 hover:text-white text-sm transition-colors"
                >
                  <Edit2 className="w-4 h-4" />
                  Bearbeiten
                </button>
                <button
                  onClick={() => handleDelete(activePokemon.id)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-bg-card border border-border-subtle hover:border-red-500/30 hover:bg-red-500/10 text-gray-400 hover:text-red-400 text-sm transition-colors"
                >
                  Löschen
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Modals */}
      {showAddModal && (
        <AddPokemonModal
          onAdd={handleAddPokemon}
          onClose={() => setShowAddModal(false)}
          activeLanguages={appState.settings.languages ?? ["de", "en"]}
        />
      )}
      {editingPokemon && (
        <EditPokemonModal
          pokemon={editingPokemon}
          onSave={handleSavePokemon}
          onClose={() => setEditingPokemon(null)}
          activeLanguages={appState.settings.languages ?? ["de", "en"]}
        />
      )}
      {confirmConfig.isOpen && (
        <ConfirmModal
          title={confirmConfig.title}
          message={confirmConfig.message}
          isDestructive={confirmConfig.isDestructive}
          onConfirm={confirmConfig.onConfirm}
          onClose={() => setConfirmConfig({ ...confirmConfig, isOpen: false })}
        />
      )}
    </div>
  );
}
