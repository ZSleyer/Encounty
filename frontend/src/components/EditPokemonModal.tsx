import { useState, useEffect, useRef } from "react";
import { X, Search, Globe } from "lucide-react";
import { GameEntry, Language } from "../types";
import { getSpriteUrl, SpriteType } from "../utils/sprites";
import { getGameName } from "../utils/games";

interface Props {
  readonly pokemon: {
    id: string;
    name: string;
    canonical_name: string;
    sprite_url: string;
    sprite_type: SpriteType;
    language: Language;
    game: string;
  };
  readonly onSave: (id: string, data: NewPokemonData) => void;
  readonly onClose: () => void;
  readonly activeLanguages?: string[];
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
  names?: Record<string, string>;
  sprite_id: number;
}

interface PokemonData {
  id: number;
  canonical: string;
  names?: Record<string, string>;
  forms?: PokemonForm[];
}

interface SearchResult {
  id: number;
  canonical: string;
  names?: Record<string, string>;
  isForm: boolean;
  spriteId: number;
}

function getPkmnName(
  p: SearchResult | PokemonData | PokemonForm,
  lang: string,
): string {
  if (p.names && p.names[lang]) return p.names[lang];
  if (p.names && p.names["en"]) return p.names["en"];
  return p.canonical;
}

export function EditPokemonModal({
  pokemon,
  onSave,
  onClose,
  activeLanguages = ["de", "en"],
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [language, setLanguage] = useState<Language>(pokemon.language || "de");
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [allPokemon, setAllPokemon] = useState<PokemonData[]>([]);

  const [selected, setSelected] = useState<{
    id: number;
    canonical: string;
    name: string;
    sprite: string;
    spriteId: number;
  } | null>(null);
  const [customSprite, setCustomSprite] = useState(pokemon.sprite_url);
  const [spriteType, setSpriteType] = useState<SpriteType>(
    pokemon.sprite_type || "shiny",
  );

  const [games, setGames] = useState<GameEntry[]>([]);
  const [selectedGame, setSelectedGame] = useState(pokemon.game || "");

  // Open dialog + load data on mount
  useEffect(() => {
    dialogRef.current?.showModal();
    inputRef.current?.focus();

    fetch("/api/pokedex")
      .then((r) => r.json())
      .then((data: PokemonData[]) => {
        setAllPokemon(data);
        // Pre-select the current Pokemon based on canonical name
        const matchBase = data.find(
          (p) => p.canonical === pokemon.canonical_name,
        );
        if (matchBase) {
          const sprite = getSpriteUrl(
            matchBase.id.toString(),
            selectedGame,
            spriteType,
          );
          setSelected({
            id: matchBase.id,
            canonical: matchBase.canonical,
            name: getPkmnName(matchBase, pokemon.language),
            sprite,
            spriteId: matchBase.id,
          });
          setQuery(getPkmnName(matchBase, pokemon.language));
          return;
        }
        // Check forms
        for (const p of data) {
          const form = p.forms?.find(
            (f) => f.canonical === pokemon.canonical_name,
          );
          if (form) {
            const sprite = getSpriteUrl(
              form.sprite_id.toString(),
              selectedGame,
              spriteType,
            );
            setSelected({
              id: p.id,
              canonical: form.canonical,
              name: getPkmnName(form, pokemon.language),
              sprite,
              spriteId: form.sprite_id,
            });
            setQuery(getPkmnName(form, pokemon.language));
            return;
          }
        }
      })
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
      results.push({
        id: p.id,
        canonical: p.canonical,
        names: p.names,
        isForm: false,
        spriteId: p.id,
      });
      if (p.forms) {
        for (const f of p.forms) {
          results.push({
            id: p.id,
            canonical: f.canonical,
            names: f.names,
            isForm: true,
            spriteId: f.sprite_id,
          });
        }
      }
    }
    return results;
  };

  // Autocomplete
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      setSuggestions([]);
      return;
    }

    const searchList = buildSearchList(allPokemon);
    const results = searchList
      .filter((p) => {
        if (p.canonical.includes(q)) return true;
        const nameValues = p.names ? Object.values(p.names) : [];
        const matchesName = nameValues.some((name) =>
          name?.toLowerCase().includes(q),
        );
        if (matchesName) return true;
        return false;
      })
      .slice(0, 12);

    setSuggestions(results);
  }, [query, allPokemon]);

  const selectPokemon = (p: SearchResult) => {
    setSuggestions([]);
    setQuery(getPkmnName(p, language));

    const sprite = getSpriteUrl(
      p.spriteId.toString(),
      selectedGame,
      spriteType,
    );

    setSelected({
      id: p.id,
      canonical: p.canonical,
      name: getPkmnName(p, language),
      sprite,
      spriteId: p.spriteId,
    });
    setCustomSprite(sprite);
  };

  // Update sprite when game or spriteType changes
  useEffect(() => {
    if (selected) {
      const newSprite = getSpriteUrl(
        selected.spriteId.toString(),
        selectedGame,
        spriteType,
      );
      setSelected((prev) => (prev ? { ...prev, sprite: newSprite } : null));
      // Only auto-update customSprite if it was matching the auto-sprite originally.
      // But for simplicity, we keep the original logic here.
      setCustomSprite(newSprite);
    }
  }, [selectedGame, spriteType, selected?.spriteId]);

  const handleSave = () => {
    if (!selected) return;
    onSave(pokemon.id, {
      name: selected.name,
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

  const activeName = selected ? selected.name : "";

  // Available language buttons for Pokemon names
  const availableLangs = activeLanguages.length > 0 ? activeLanguages : ["en"];

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
        <h2 className="text-lg font-bold text-white">Pokémon bearbeiten</h2>
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
        <span className="text-xs text-gray-500">Lokalisierung:</span>
        {availableLangs.map((lang) => (
          <button
            key={lang}
            onClick={() => {
              setLanguage(lang as Language);
              if (selected) {
                const searchList = buildSearchList(allPokemon);
                const fullP = searchList.find(
                  (p) =>
                    p.spriteId === selected.spriteId &&
                    p.canonical === selected.canonical,
                );
                if (fullP) {
                  setQuery(getPkmnName(fullP, lang));
                  setSelected({
                    ...selected,
                    name: getPkmnName(fullP, lang),
                  });
                }
              }
            }}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors border ${
              language === lang
                ? "bg-accent-blue/10 text-accent-blue border-accent-blue/30"
                : "bg-bg-dark text-gray-500 border-border-subtle hover:text-gray-300"
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
                <span
                  className={`capitalize ${s.isForm ? "text-gray-300 pl-3 border-l border-border-subtle" : "text-white"}`}
                >
                  {getPkmnName(s, language)}
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
                alt={activeName}
                className="w-full h-full object-contain"
                style={{ imageRendering: "pixelated" }}
              />
            ) : (
              <span className="text-3xl">?</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-white text-lg">{activeName}</p>
            <p className="text-xs text-gray-500 capitalize">
              {selected.canonical}
            </p>
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
                name="sprite-type-edit"
                value={t}
                checked={spriteType === t}
                onChange={() => setSpriteType(t)}
                className="accent-accent-blue"
              />
              <span
                className={`text-sm capitalize ${spriteType === t ? "text-white" : "text-gray-400"}`}
              >
                {t === "shiny" ? "✨ Shiny" : "Normal"}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Custom sprite */}
      <div className="mb-4">
        <label
          htmlFor="custom-sprite-edit"
          className="block text-xs text-gray-500 mb-1"
        >
          Eigene Sprite-URL (optional)
        </label>
        <input
          id="custom-sprite-edit"
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
          htmlFor="game-select-edit"
          className="block text-xs text-gray-500 mb-1"
        >
          Spiel
        </label>
        <select
          id="game-select-edit"
          value={selectedGame}
          onChange={(e) => setSelectedGame(e.target.value)}
          className="w-full bg-bg-secondary border border-border-subtle rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent-blue/50 transition-colors"
        >
          <option value="">— Kein Spiel —</option>
          {Object.entries(genGroups).map(([gen, entries]) => (
            <optgroup key={gen} label={`Generation ${gen}`}>
              {entries.map((g) => (
                <option key={g.key} value={g.key}>
                  {getGameName(g, [language, ...activeLanguages, "en"])}
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
          onClick={handleSave}
          disabled={!selected}
          className="flex-1 py-2 rounded-lg bg-accent-blue hover:bg-blue-500 text-white font-semibold text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Speichern
        </button>
      </div>
    </dialog>
  );
}
