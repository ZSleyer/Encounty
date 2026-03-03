import { useState, useEffect, useRef } from "react";
import {
  Plus,
  Star,
  Minus,
  RotateCcw,
  Clock,
  Zap,
  Edit2,
  Gamepad2,
  Search,
  Trophy,
  Undo2,
  Sparkles,
  X,
  PartyPopper,
  Trash2,
} from "lucide-react";
import { AddPokemonModal, NewPokemonData } from "../components/AddPokemonModal";
import { EditPokemonModal } from "../components/EditPokemonModal";
import { ConfirmModal } from "../components/ConfirmModal";
import { useCounterStore } from "../hooks/useCounterState";
import { useWebSocket } from "../hooks/useWebSocket";
import { Pokemon } from "../types";
import { useI18n } from "../contexts/I18nContext";

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

type SidebarTab = "active" | "archived";

export function Dashboard() {
  const { appState, isConnected, flashPokemon } = useCounterStore();
  const { t } = useI18n();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingPokemon, setEditingPokemon] = useState<Pokemon | null>(null);
  const [imgError, setImgError] = useState<Record<string, boolean>>({});
  const [sessionStart] = useState(new Date());
  const elapsed = useDuration(sessionStart);

  // Sidebar state
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("active");
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

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

  const { send } = useWebSocket((msg) => {
    if (msg.type === "request_reset_confirm") {
      const payload = msg.payload as { pokemon_id: string };
      const pokemon = appState?.pokemon.find(
        (p) => p.id === payload.pokemon_id,
      );
      setConfirmConfig({
        isOpen: true,
        title: t("confirm.resetTitle"),
        message: `${t("confirm.resetMsg")}${pokemon ? ` (${pokemon.name})` : ""}`,
        isDestructive: true,
        onConfirm: () => send("reset", { pokemon_id: payload.pokemon_id }),
      });
    }
  });

  // Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleIncrement = (id: string) => {
    send("increment", { pokemon_id: id });
    flashPokemon(id);
  };
  const handleDecrement = (id: string) => send("decrement", { pokemon_id: id });
  const handleReset = (id: string) => {
    setConfirmConfig({
      isOpen: true,
      title: t("confirm.resetTitle"),
      message: t("confirm.resetMsg"),
      isDestructive: true,
      onConfirm: () => send("reset", { pokemon_id: id }),
    });
  };
  const handleActivate = (id: string) => send("set_active", { pokemon_id: id });
  const handleDelete = (id: string) => {
    setConfirmConfig({
      isOpen: true,
      title: t("confirm.deleteTitle"),
      message: t("confirm.deleteMsg"),
      isDestructive: true,
      onConfirm: async () => {
        await fetch(`${API}/pokemon/${id}`, { method: "DELETE" });
      },
    });
  };
  const handleComplete = async (id: string) => {
    await fetch(`${API}/pokemon/${id}/complete`, { method: "POST" });
  };
  const handleUncomplete = async (id: string) => {
    await fetch(`${API}/pokemon/${id}/uncomplete`, { method: "POST" });
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
          <p className="text-text-muted">{t("nav.connected")}…</p>
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

  // Split Pokémon into active hunts and archived
  const activeHunts = appState.pokemon.filter((p) => !p.completed_at);
  const archivedHunts = appState.pokemon.filter((p) => !!p.completed_at);

  // Filter by search query
  const q = searchQuery.trim().toLowerCase();
  const filterPokemon = (list: Pokemon[]) =>
    q
      ? list.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.canonical_name.toLowerCase().includes(q) ||
            (p.game && p.game.toLowerCase().includes(q)),
        )
      : list;

  const displayList = filterPokemon(
    sidebarTab === "active" ? activeHunts : archivedHunts,
  );

  const formatGame = (game: string) =>
    game
      ? game.replace("pokemon-", "").replace("letsgo", "L.G. ").toUpperCase()
      : "—";

  const FALLBACK = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='40' fill='%23333'/><text y='.9em' font-size='60' x='50%' text-anchor='middle' dominant-baseline='middle'>?</text></svg>`;

  return (
    <div className="flex h-full">
      {/* LEFT: Pokemon sidebar */}
      <aside className="w-72 flex-shrink-0 border-r border-border-subtle bg-bg-secondary flex flex-col">
        {/* Stats bar */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border-subtle text-[11px] text-text-muted">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3 h-3" />
            <span className="tabular-nums">{elapsed}</span>
          </div>
          <div className="w-px h-3 bg-border-subtle" />
          <div className="flex items-center gap-1.5">
            <Zap className="w-3 h-3 text-accent-yellow" />
            <span className="tabular-nums">{totalEncounters}</span>
            <span>{t("dash.total")}</span>
          </div>
        </div>

        {/* Search bar */}
        <div className="p-3 border-b border-border-subtle">
          <div className="flex items-center gap-2 bg-bg-primary border border-border-subtle rounded-lg px-3 py-1.5">
            <Search className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("dash.searchShortcut")}
              className="flex-1 bg-transparent text-text-primary placeholder-text-faint outline-none text-xs"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="text-text-muted hover:text-text-primary"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Tabs: Active | Archive */}
        <div className="flex border-b border-border-subtle">
          <button
            onClick={() => setSidebarTab("active")}
            className={`flex-1 py-2 text-xs font-semibold transition-colors relative ${
              sidebarTab === "active"
                ? "text-accent-blue"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            <span className="flex items-center justify-center gap-1.5">
              <Sparkles className="w-3 h-3" />
              {t("dash.tabActive")}
              {activeHunts.length > 0 && (
                <span className="bg-accent-blue/20 text-accent-blue text-[10px] px-1.5 py-0.5 rounded-full tabular-nums">
                  {activeHunts.length}
                </span>
              )}
            </span>
            {sidebarTab === "active" && (
              <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-accent-blue rounded-full" />
            )}
          </button>
          <button
            onClick={() => setSidebarTab("archived")}
            className={`flex-1 py-2 text-xs font-semibold transition-colors relative ${
              sidebarTab === "archived"
                ? "text-accent-green"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            <span className="flex items-center justify-center gap-1.5">
              <Trophy className="w-3 h-3" />
              {t("dash.tabArchive")}
              {archivedHunts.length > 0 && (
                <span className="bg-accent-green/20 text-accent-green text-[10px] px-1.5 py-0.5 rounded-full tabular-nums">
                  {archivedHunts.length}
                </span>
              )}
            </span>
            {sidebarTab === "archived" && (
              <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-accent-green rounded-full" />
            )}
          </button>
        </div>

        {/* Pokémon list */}
        <div className="flex-1 overflow-y-auto">
          {displayList.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-6 text-center">
              {q ? (
                <>
                  <Search className="w-8 h-8 text-text-faint mb-3" />
                  <p className="text-sm text-text-muted">
                    {t("dash.noMatch")} „{q}"
                  </p>
                  <button
                    onClick={() => {
                      setSearchQuery("");
                      setShowAddModal(true);
                    }}
                    className="mt-3 text-xs text-accent-blue hover:underline flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    {t("dash.addNew")}
                  </button>
                </>
              ) : sidebarTab === "active" ? (
                <>
                  <Gamepad2 className="w-10 h-10 text-text-faint mb-3" />
                  <p className="text-sm text-text-muted">
                    {t("dash.noPokemon")}
                  </p>
                  <button
                    onClick={() => setShowAddModal(true)}
                    className="mt-4 text-xs text-accent-blue hover:underline"
                  >
                    {t("dash.addFirst")}
                  </button>
                </>
              ) : (
                <>
                  <Trophy className="w-10 h-10 text-text-faint mb-3" />
                  <p className="text-sm text-text-muted">
                    {t("dash.noArchive")}
                  </p>
                  <p className="text-xs text-text-faint mt-1">
                    {t("dash.noArchiveHint")}
                  </p>
                </>
              )}
            </div>
          ) : (
            <ul className="py-1">
              {displayList.map((p) => {
                const isActive = p.id === appState.active_id;
                const isArchived = !!p.completed_at;
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
                    } ${isArchived ? "opacity-70" : ""}`}
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
                      {isArchived && (
                        <div className="absolute -bottom-0.5 -right-0.5 bg-accent-green rounded-full p-0.5">
                          <Trophy className="w-2.5 h-2.5 text-white" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {isActive && !isArchived && (
                          <Star className="w-3 h-3 text-accent-blue fill-accent-blue flex-shrink-0" />
                        )}
                        <span className="text-sm font-semibold text-text-primary truncate capitalize">
                          {p.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-xs text-text-muted tabular-nums">
                          {p.encounters} {t("dash.enc")}
                        </span>
                        {p.game && (
                          <span className="text-[10px] text-text-faint uppercase">
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
                        className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
                        title={t("dash.edit")}
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

        {/* Add button */}
        {sidebarTab === "active" && (
          <div className="p-3 border-t border-border-subtle">
            <button
              onClick={() => setShowAddModal(true)}
              className="w-full flex items-center justify-center gap-1.5 py-2 bg-accent-blue hover:bg-accent-blue/80 text-white rounded-lg text-xs font-semibold transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              {t("dash.addPokemon")}
            </button>
          </div>
        )}
      </aside>

      {/* RIGHT: Active Pokemon detail */}
      <main className="flex-1 flex flex-col overflow-hidden bg-bg-primary dash-bg">
        {/* Animated orbs */}
        <div className="dash-orb dash-orb-1" />
        <div className="dash-orb dash-orb-2" />
        <div className="dash-orb dash-orb-3" />

        {!activePokemon ? (
          <div className="flex flex-col items-center justify-center h-full text-center relative z-10">
            <div className="w-20 h-20 rounded-full bg-bg-card border border-border-subtle flex items-center justify-center mb-6">
              <Sparkles className="w-8 h-8 text-text-faint" />
            </div>
            <h2 className="text-xl font-semibold text-text-primary mb-2">
              {t("dash.noActive")}
            </h2>
            <p className="text-text-muted text-sm max-w-xs">
              {t("dash.noActiveHint")}
            </p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 gap-6 relative z-10">
            {/* Archived banner */}
            {activePokemon.completed_at && (
              <div className="flex items-center gap-2.5 px-5 py-2.5 rounded-full glass-card text-accent-green text-sm">
                <Trophy className="w-4 h-4" />
                <span className="font-bold">{t("dash.caughtBanner")}</span>
                <span className="w-px h-3 bg-accent-green/20" />
                <span className="text-accent-green/60 text-xs">
                  {new Date(activePokemon.completed_at).toLocaleDateString(
                    "de-DE",
                    { day: "2-digit", month: "short", year: "numeric" },
                  )}
                </span>
              </div>
            )}

            {/* Sprite with glow */}
            <div className="relative flex items-center justify-center group">
              {/* Soft ambient glow instead of hard rings */}
              <div className="absolute inset-0 bg-accent-blue/10 rounded-full blur-3xl scale-125 group-hover:scale-150 group-hover:bg-accent-blue/20 transition-all duration-700" />
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
                className="w-40 h-40 object-contain relative z-10 drop-shadow-2xl transition-transform duration-300 group-hover:scale-110"
                style={
                  activePokemon.sprite_style &&
                  activePokemon.sprite_style !== "classic"
                    ? undefined
                    : { imageRendering: "pixelated" }
                }
              />
            </div>

            {/* Name + Game badge */}
            <div className="text-center">
              <h2 className="text-3xl font-black text-text-primary capitalize tracking-wide">
                {activePokemon.name}
              </h2>
              {activePokemon.game && (
                <div className="inline-flex items-center gap-1.5 mt-2 px-3 py-1 rounded-full bg-bg-card/50 border border-border-subtle">
                  <Gamepad2 className="w-3 h-3 text-text-muted" />
                  <span className="text-[11px] text-text-muted uppercase tracking-wider font-medium">
                    {formatGame(activePokemon.game)}
                  </span>
                </div>
              )}
            </div>

            {/* Counter — glassmorphism */}
            <div className="glass-card rounded-2xl px-14 py-7 text-center">
              <div className="text-7xl font-black text-text-primary tabular-nums leading-none tracking-tight">
                {activePokemon.encounters.toLocaleString()}
              </div>
              <div className="text-[10px] text-text-muted uppercase tracking-[0.2em] font-semibold mt-3">
                {t("dash.encounters")}
              </div>
            </div>

            {/* Control buttons — harmonized */}
            {!activePokemon.completed_at && (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleDecrement(activePokemon.id)}
                  className="flex items-center justify-center w-12 h-12 rounded-xl glass-card hover:border-accent-blue/30 text-text-muted hover:text-text-primary transition-all active:scale-95"
                  title="−1"
                >
                  <Minus className="w-5 h-5" />
                </button>
                <button
                  onClick={() => handleIncrement(activePokemon.id)}
                  className="flex items-center justify-center w-16 h-16 rounded-2xl bg-accent-blue text-white shadow-lg shadow-accent-blue/25 transition-all hover:shadow-accent-blue/40 hover:scale-105 active:scale-95"
                  title="+1"
                >
                  <Plus className="w-7 h-7" />
                </button>
                <button
                  onClick={() => handleReset(activePokemon.id)}
                  className="flex items-center justify-center w-12 h-12 rounded-xl glass-card hover:border-accent-red/30 text-text-muted hover:text-accent-red transition-all active:scale-95"
                  title="Reset"
                >
                  <RotateCcw className="w-4.5 h-4.5" />
                </button>
              </div>
            )}

            {/* Action row — unified pill-shaped buttons */}
            <div className="flex gap-2 flex-wrap justify-center">
              <button
                onClick={() => setEditingPokemon(activePokemon)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full glass-card hover:border-accent-blue/20 text-text-muted hover:text-text-primary text-xs font-medium transition-all"
              >
                <Edit2 className="w-3.5 h-3.5" />
                {t("dash.edit")}
              </button>

              {!activePokemon.completed_at ? (
                <button
                  onClick={() => handleComplete(activePokemon.id)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-accent-green/10 border border-accent-green hover:bg-accent-green/20 text-accent-green text-xs font-bold transition-all"
                >
                  <PartyPopper className="w-3.5 h-3.5" />
                  {t("dash.caught")}
                </button>
              ) : (
                <button
                  onClick={() => handleUncomplete(activePokemon.id)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full glass-card hover:border-accent-yellow/20 text-text-muted hover:text-accent-yellow text-xs font-medium transition-all"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                  {t("dash.reactivate")}
                </button>
              )}

              <button
                onClick={() => handleDelete(activePokemon.id)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full glass-card hover:border-accent-red/20 text-text-muted hover:text-accent-red text-xs font-medium transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t("dash.delete")}
              </button>
            </div>
          </div>
        )}
      </main>

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
