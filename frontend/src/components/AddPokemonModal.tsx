import { useState, useEffect, useRef } from "react";
import { X, Search, Globe } from "lucide-react";
import { GameEntry, Language } from "../types";
import { getSpriteUrl, SpriteType } from "../utils/sprites";

interface Props {
  readonly onAdd: (data: NewPokemonData) => void;
  readonly onClose: () => void;
}

export interface NewPokemonData {
  name: string;
  canonical_name: string;
  sprite_url: string;
  sprite_type: SpriteType;
  language: Language;
  game: string;
}

interface PokemonForm {
  canonical: string;
  de: string;
  en: string;
  sprite_id: number;
}

interface PokemonData {
  id: number;
  canonical: string;
  de: string;
  en: string;
  forms?: PokemonForm[];
}

interface SearchResult {
  id: number;
  canonical: string;
  de: string;
  en: string;
  isForm: boolean;
  spriteId: number; // numeric ID used for sprite URL
}

export function AddPokemonModal({ onAdd, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [language, setLanguage] = useState<Language>("de");
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [allPokemon, setAllPokemon] = useState<PokemonData[]>([]);

  const [selected, setSelected] = useState<{
    id: number;
    canonical: string;
    nameDE: string;
    nameEN: string;
    sprite: string;
    spriteId: number;
  } | null>(null);
  const [customSprite, setCustomSprite] = useState("");
  const [spriteType, setSpriteType] = useState<SpriteType>("shiny");

  const [games, setGames] = useState<GameEntry[]>([]);
  const [selectedGame, setSelectedGame] = useState("");

  // Open dialog + load data on mount
  useEffect(() => {
    dialogRef.current?.showModal();
    inputRef.current?.focus();

    fetch("/api/pokedex")
      .then((r) => r.json())
      .then((data) => setAllPokemon(data))
      .catch(() => {});

    fetch("/api/games")
      .then((r) => r.json())
      .then((data: GameEntry[]) => setGames(data))
      .catch(() => {});
  }, []);

  // Build flat search list including forms
  const buildSearchList = (data: PokemonData[]): SearchResult[] => {
    const results: SearchResult[] = [];
    for (const p of data) {
      results.push({ id: p.id, canonical: p.canonical, de: p.de, en: p.en, isForm: false, spriteId: p.id });
      if (p.forms) {
        for (const f of p.forms) {
          results.push({ id: p.id, canonical: f.canonical, de: f.de, en: f.en, isForm: true, spriteId: f.sprite_id });
        }
      }
    }
    return results;
  };

  // Autocomplete: match DE or EN or canonical slug (including forms)
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      setSuggestions([]);
      return;
    }

    const searchList = buildSearchList(allPokemon);
    const results = searchList
      .filter((p) => {
        return (
          p.canonical.includes(q) ||
          p.de.toLowerCase().includes(q) ||
          p.en.toLowerCase().includes(q)
        );
      })
      .slice(0, 12);

    setSuggestions(results);
  }, [query, allPokemon]);

  const selectPokemon = (p: SearchResult) => {
    setSuggestions([]);
    setQuery(language === "de" ? p.de : p.en);

    const sprite = getSpriteUrl(p.spriteId, selectedGame, spriteType);

    setSelected({
      id: p.id,
      canonical: p.canonical,
      nameDE: p.de,
      nameEN: p.en,
      sprite,
      spriteId: p.spriteId,
    });
    setCustomSprite(sprite);
  };

  // Update sprite when game or spriteType changes
  useEffect(() => {
    if (selected) {
      const newSprite = getSpriteUrl(selected.spriteId, selectedGame, spriteType);
      setSelected((prev) => (prev ? { ...prev, sprite: newSprite } : null));
      setCustomSprite(newSprite);
    }
  }, [selectedGame, spriteType]);

  const handleAdd = () => {
    if (!selected) return;
    const displayName = language === "de" ? selected.nameDE : selected.nameEN;
    onAdd({
      name: displayName,
      canonical_name: selected.canonical,
      sprite_url: customSprite || selected.sprite,
      sprite_type: spriteType,
      language,
      game: selectedGame,
    });
  };

  const handleCancel = () => {
    dialogRef.current?.close();
    onClose();
  };

  const displayName = selected
    ? language === "de"
      ? selected.nameDE
      : selected.nameEN
    : "";

  const genGroups = games.reduce<Record<number, GameEntry[]>>((acc, g) => {
    if (!acc[g.generation]) acc[g.generation] = [];
    acc[g.generation].push(g);
    return acc;
  }, {});

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleCancel}
      className="m-auto bg-bg-card border border-border-subtle rounded-2xl p-6 w-full max-w-lg animate-slide-in backdrop:bg-black/70"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-bold text-white">Pokémon hinzufügen</h2>
        <button
          onClick={handleCancel}
          className="text-gray-500 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Language toggle */}
      <div className="flex items-center gap-2 mb-4">
        <Globe className="w-4 h-4 text-gray-500" />
        <span className="text-xs text-gray-500">Namenssprache:</span>
        {(["de", "en"] as Language[]).map((lang) => (
          <button
            key={lang}
            onClick={() => {
              setLanguage(lang);
              if (selected)
                setQuery(lang === "de" ? selected.nameDE : selected.nameEN);
            }}
            className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
              language === lang
                ? "bg-accent-blue text-white"
                : "bg-bg-secondary text-gray-400 hover:text-white"
            }`}
          >
            {lang.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <div className="flex items-center gap-2 bg-bg-secondary border border-border-subtle rounded-lg px-3 py-2">
          <Search className="w-4 h-4 text-gray-500 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(null);
            }}
            placeholder={
              language === "de"
                ? "z.B. Bisasam, Glumanda…"
                : "e.g. Bulbasaur, Charmander…"
            }
            className="flex-1 bg-transparent text-white placeholder-gray-600 outline-none text-sm"
          />
        </div>

        {suggestions.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-bg-secondary border border-border-subtle rounded-lg overflow-hidden z-10 shadow-xl max-h-52 overflow-y-auto">
            {suggestions.map((s) => (
              <button
                key={s.canonical}
                onClick={() => selectPokemon(s)}
                className="w-full text-left px-4 py-2 text-sm hover:bg-bg-hover transition-colors flex items-center justify-between"
              >
                <span className={`capitalize ${s.isForm ? "text-gray-300 pl-3 border-l border-border-subtle" : "text-white"}`}>
                  {language === "de" ? s.de : s.en}
                </span>
                <span className="text-gray-500 text-xs italic">
                  {s.canonical}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Preview */}
      {selected && (
        <div className="flex items-center gap-4 bg-bg-secondary rounded-lg p-4 mb-4">
          <div className="w-20 h-20 bg-bg-primary rounded-lg flex items-center justify-center flex-shrink-0">
            {selected.sprite ? (
              <img
                src={customSprite || selected.sprite}
                alt={displayName}
                className="w-full h-full object-contain"
                style={{ imageRendering: "pixelated" }}
              />
            ) : (
              <span className="text-3xl">?</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-white text-lg">{displayName}</p>
            <p className="text-xs text-gray-500 capitalize">
              {selected.canonical}
            </p>
            <div className="flex gap-2 mt-1">
              <span className="text-xs bg-bg-hover px-2 py-0.5 rounded text-gray-400">
                DE: {selected.nameDE}
              </span>
              <span className="text-xs bg-bg-hover px-2 py-0.5 rounded text-gray-400">
                EN: {selected.nameEN}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Sprite type */}
      <div className="mb-4">
        <span className="block text-xs text-gray-500 mb-2">Sprite-Typ:</span>
        <div className="flex gap-3">
          {(["shiny", "normal"] as SpriteType[]).map((t) => (
            <label key={t} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="sprite-type"
                value={t}
                checked={spriteType === t}
                onChange={() => setSpriteType(t)}
                className="accent-accent-blue"
              />
              <span className={`text-sm capitalize ${spriteType === t ? "text-white" : "text-gray-400"}`}>
                {t === "shiny" ? "✨ Shiny" : "Normal"}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Custom sprite */}
      <div className="mb-4">
        <label
          htmlFor="custom-sprite-add"
          className="block text-xs text-gray-500 mb-1"
        >
          Eigene Sprite-URL (optional)
        </label>
        <input
          id="custom-sprite-add"
          type="url"
          value={customSprite}
          onChange={(e) => setCustomSprite(e.target.value)}
          placeholder="https://…"
          className="w-full bg-bg-secondary border border-border-subtle rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-accent-blue/50 transition-colors"
        />
      </div>

      {/* Game Selection */}
      <div className="mb-5">
        <label
          htmlFor="game-select-add"
          className="block text-xs text-gray-500 mb-1"
        >
          Spiel
        </label>
        <select
          id="game-select-add"
          value={selectedGame}
          onChange={(e) => setSelectedGame(e.target.value)}
          className="w-full bg-bg-secondary border border-border-subtle rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent-blue/50 transition-colors"
        >
          <option value="">— Kein Spiel —</option>
          {Object.entries(genGroups).map(([gen, entries]) => (
            <optgroup key={gen} label={`Generation ${gen}`}>
              {entries.map((g) => (
                <option key={g.key} value={g.key}>
                  {language === "de" ? g.name_de : g.name_en}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={handleCancel}
          className="flex-1 py-2 rounded-lg border border-border-subtle text-gray-400 hover:text-white hover:border-gray-500 transition-colors text-sm"
        >
          Abbrechen
        </button>
        <button
          onClick={handleAdd}
          disabled={!selected}
          className="flex-1 py-2 rounded-lg bg-accent-blue hover:bg-blue-500 text-white font-semibold text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Hinzufügen
        </button>
      </div>
    </dialog>
  );
}
