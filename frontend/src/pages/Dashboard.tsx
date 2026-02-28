import { useState } from "react";
import { Plus, Wifi, WifiOff } from "lucide-react";
import { PokemonCard } from "../components/PokemonCard";
import { AddPokemonModal, NewPokemonData } from "../components/AddPokemonModal";
import { EditPokemonModal } from "../components/EditPokemonModal";
import { SessionStats } from "../components/SessionStats";

import { ConfirmModal } from "../components/ConfirmModal";
import { useCounterStore } from "../hooks/useCounterState";
import { useWebSocket } from "../hooks/useWebSocket";
import { AppState, WSMessage, Pokemon } from "../types";

const API = "/api";

export function Dashboard() {
  const { appState, setAppState, isConnected, setConnected, flashPokemon } =
    useCounterStore();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingPokemon, setEditingPokemon] = useState<Pokemon | null>(null);

  // Confirmation Modal States
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

  const [sessionStart] = useState(new Date());

  const { send } = useWebSocket(() => {});

  const handleIncrement = (id: string) => {
    send("increment", { pokemon_id: id });
    flashPokemon(id);
  };

  const handleDecrement = (id: string) => {
    send("decrement", { pokemon_id: id });
  };

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

  const handleActivate = (id: string) => {
    send("set_active", { pokemon_id: id });
  };

  const handleDelete = (id: string) => {
    setConfirmConfig({
      isOpen: true,
      title: "Pokémon löschen",
      message:
        "Willst du dieses Pokémon wirklich löschen? Alle Daten und Encounter-Zahlen gehen unwiderruflich verloren!",
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
    await fetch(`${API}/pokemon/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setEditingPokemon(null);
  };

  if (!appState) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-accent-blue border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Verbinde...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border-subtle bg-bg-secondary">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-white">Encounty</h1>
          <div
            className={`flex items-center gap-1.5 text-xs ${isConnected ? "text-accent-green" : "text-accent-red"}`}
          >
            {isConnected ? (
              <Wifi className="w-3.5 h-3.5" />
            ) : (
              <WifiOff className="w-3.5 h-3.5" />
            )}
            {isConnected ? "Verbunden" : "Getrennt"}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <SessionStats appState={appState} sessionStart={sessionStart} />
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto p-6">
        {appState.pokemon.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-6xl mb-4">🎮</div>
            <h2 className="text-xl font-semibold text-white mb-2">
              Noch kein Pokémon
            </h2>
            <p className="text-gray-500 mb-6">
              Füge dein erstes Pokémon hinzu und starte deinen Shiny Hunt!
            </p>
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-6 py-3 bg-accent-blue hover:bg-blue-500 text-white rounded-xl font-semibold transition-colors"
            >
              <Plus className="w-5 h-5" />
              Pokémon hinzufügen
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {appState.pokemon.map((p) => (
              <PokemonCard
                key={p.id}
                pokemon={p}
                onIncrement={handleIncrement}
                onDecrement={handleDecrement}
                onReset={handleReset}
                onActivate={handleActivate}
                onDelete={handleDelete}
                onEdit={setEditingPokemon}
              />
            ))}
            <button
              onClick={() => setShowAddModal(true)}
              className="rounded-xl border border-dashed border-border-subtle hover:border-accent-blue/50 bg-transparent hover:bg-bg-card transition-all duration-200 p-8 flex flex-col items-center gap-3 text-gray-600 hover:text-gray-400 group"
            >
              <div className="w-12 h-12 rounded-full border-2 border-dashed border-current flex items-center justify-center group-hover:border-accent-blue/50 group-hover:text-accent-blue transition-colors">
                <Plus className="w-6 h-6" />
              </div>
              <span className="text-sm">Pokémon hinzufügen</span>
            </button>
          </div>
        )}
      </main>

      {showAddModal && (
        <AddPokemonModal
          onAdd={handleAddPokemon}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {editingPokemon && (
        <EditPokemonModal
          pokemon={editingPokemon}
          onSave={handleSavePokemon}
          onClose={() => setEditingPokemon(null)}
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
