import { useState, useEffect, useRef } from "react";
import {
  Search,
  Globe,
  AlertTriangle,
  X,
  ChevronDown,
  Check,
} from "lucide-react";
import { GameEntry, Language, Pokemon } from "../types";
import {
  getSpriteUrl,
  SpriteType,
  SpriteStyle,
  SPRITE_STYLES,
  isSpriteStyleAvailable,
  bestAvailableStyle,
} from "../utils/sprites";
import { getGameName } from "../utils/games";

interface Props {
  readonly pokemon: Pokemon;
  readonly onSave: (id: string, data: UpdateData) => void;
  readonly onCancel: () => void;
  readonly activeLanguages?: string[];
}

export interface UpdateData {
  name: string;
  canonical_name: string;
  sprite_url: string;
  sprite_type: SpriteType;
  sprite_style: SpriteStyle;
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

/**
 * Inline edit panel that shows in the main content area.
 * Replaces the heavy full-screen modal with a focused panel.
 */
export function EditPokemonPanel({
  pokemon,
  onSave,
  onCancel,
  activeLanguages = ["de", "en"],
}: Props) {
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [language, setLanguage] = useState<Language>(pokemon.language || "de");
  const [allPokemon, setAllPokemon] = useState<PokemonData[]>([]);
  const [missingNames, setMissingNames] = useState(false);
  const [games, setGames] = useState<GameEntry[]>([]);

  // Pokémon search state — hidden by default
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);

  // Selected Pokémon state
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
  const [spriteStyle, setSpriteStyle] = useState<SpriteStyle>(
    pokemon.sprite_style || "classic",
  );
  const [selectedGame, setSelectedGame] = useState(pokemon.game || "");

  const selectedGameGen: number | null =
    games.find((g) => g.key === selectedGame)?.generation ?? null;

  // Load pokedex + games
  useEffect(() => {
    fetch("/api/pokedex")
      .then((r) => r.json())
      .then((data: PokemonData[]) => {
        setAllPokemon(data);
        setMissingNames(
          !data.some((p) => p.names && Object.keys(p.names).length > 0),
        );

        // Find the current Pokémon in the pokedex
        const matchBase = data.find(
          (p) => p.canonical === pokemon.canonical_name,
        );
        if (matchBase) {
          setSelected({
            id: matchBase.id,
            canonical: matchBase.canonical,
            name: getPkmnName(matchBase, pokemon.language),
            sprite: pokemon.sprite_url,
            spriteId: matchBase.id,
          });
          return;
        }
        for (const p of data) {
          const form = p.forms?.find(
            (f) => f.canonical === pokemon.canonical_name,
          );
          if (form) {
            setSelected({
              id: p.id,
              canonical: form.canonical,
              name: getPkmnName(form, pokemon.language),
              sprite: pokemon.sprite_url,
              spriteId: form.sprite_id,
            });
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

  // Auto-switch style when game generation changes
  useEffect(() => {
    if (selectedGameGen != null) {
      const best = bestAvailableStyle(spriteStyle, selectedGameGen);
      if (best !== spriteStyle) setSpriteStyle(best);
    }
  }, [selectedGameGen]);

  // Update sprite when settings change
  useEffect(() => {
    if (selected) {
      const newSprite = getSpriteUrl(
        selected.spriteId.toString(),
        selectedGame,
        spriteType,
        spriteStyle,
        selected.canonical,
      );
      setSelected((prev) => (prev ? { ...prev, sprite: newSprite } : null));
      setCustomSprite(newSprite);
    }
  }, [selectedGame, spriteType, spriteStyle, selected?.spriteId]);

  // Search logic
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

  useEffect(() => {
    if (!showSearch) {
      setSuggestions([]);
      return;
    }
    const q = query.trim().toLowerCase();
    if (!q) {
      setSuggestions([]);
      return;
    }
    const searchList = buildSearchList(allPokemon);
    setSuggestions(
      searchList
        .filter((p) => {
          if (p.canonical.includes(q)) return true;
          if (p.names)
            for (const name of Object.values(p.names))
              if (name?.toLowerCase().includes(q)) return true;
          if (q.match(/^\d+$/) && p.spriteId === parseInt(q, 10)) return true;
          return false;
        })
        .slice(0, 10),
    );
  }, [query, allPokemon, showSearch]);

  const selectPokemon = (p: SearchResult) => {
    const sprite = getSpriteUrl(
      p.spriteId.toString(),
      selectedGame,
      spriteType,
      spriteStyle,
      p.canonical,
    );
    setSelected({
      id: p.id,
      canonical: p.canonical,
      name: getPkmnName(p, language),
      sprite,
      spriteId: p.spriteId,
    });
    setCustomSprite(sprite);
    setShowSearch(false);
    setQuery("");
    setSuggestions([]);
  };

  const handleSave = () => {
    if (!selected) return;
    onSave(pokemon.id, {
      name: selected.name,
      canonical_name: selected.canonical,
      sprite_url: customSprite || selected.sprite,
      sprite_type: spriteType,
      sprite_style: spriteStyle,
      language,
      game: selectedGame,
    });
  };

  const availableLangs = activeLanguages.length > 0 ? activeLanguages : ["en"];
  const genGroups = games.reduce<Record<number, GameEntry[]>>((acc, g) => {
    if (!acc[g.generation]) acc[g.generation] = [];
    acc[g.generation].push(g);
    return acc;
  }, {});

  return (
    <div className="bg-bg-card border border-border-subtle rounded-2xl p-5 animate-slide-in w-full max-w-md">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider">
          Pokémon bearbeiten
        </h3>
        <button
          onClick={onCancel}
          className="text-gray-500 hover:text-white transition-colors p-1"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {missingNames && (
        <div className="flex items-start gap-2 p-2 mb-3 rounded-lg bg-amber-900/20 border border-amber-700/30 text-amber-300 text-[11px]">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>
            Pokédex nicht synchronisiert — nur englische Namen verfügbar.
          </span>
        </div>
      )}

      {/* Current Pokémon display + change button */}
      <div className="flex items-center gap-3 bg-bg-secondary rounded-lg p-3 mb-4">
        <div className="w-14 h-14 bg-bg-primary rounded-lg flex items-center justify-center flex-shrink-0">
          {selected?.sprite && (
            <img
              src={customSprite || selected.sprite}
              alt={selected.name}
              className="w-full h-full object-contain"
              style={
                spriteStyle === "classic"
                  ? { imageRendering: "pixelated" }
                  : undefined
              }
            />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-white capitalize truncate">
            {selected?.name || pokemon.name}
          </p>
          <p className="text-[11px] text-gray-500">
            {selected?.canonical || pokemon.canonical_name}
          </p>
        </div>
        <button
          onClick={() => {
            setShowSearch(!showSearch);
            setTimeout(() => searchInputRef.current?.focus(), 50);
          }}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-bg-dark border border-border-subtle text-gray-400 hover:text-white hover:border-accent-blue/30 transition-colors flex items-center gap-1"
        >
          <ChevronDown className="w-3 h-3" />
          Wechseln
        </button>
      </div>

      {/* Search dropdown — only when user clicks "Wechseln" */}
      {showSearch && (
        <div className="relative mb-4">
          <div className="flex items-center gap-2 bg-bg-secondary border border-accent-blue/30 rounded-lg px-3 py-2">
            <Search className="w-4 h-4 text-accent-blue flex-shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Pokémon suchen…"
              className="flex-1 bg-transparent text-white placeholder-gray-600 outline-none text-sm"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setShowSearch(false);
                  setQuery("");
                }
              }}
            />
            <button
              onClick={() => {
                setShowSearch(false);
                setQuery("");
              }}
              className="text-gray-500 hover:text-white"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
          {suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-bg-secondary border border-border-subtle rounded-lg overflow-hidden z-10 shadow-xl max-h-48 overflow-y-auto">
              {suggestions.map((s) => (
                <button
                  key={s.canonical}
                  onClick={() => selectPokemon(s)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-bg-hover transition-colors flex items-center justify-between"
                >
                  <span
                    className={`capitalize ${s.isForm ? "text-gray-300 pl-2 border-l border-border-subtle" : "text-white"}`}
                  >
                    {getPkmnName(s, language)}
                  </span>
                  <span className="text-gray-600 text-xs italic">
                    {s.canonical}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Compact settings grid */}
      <div className="space-y-3">
        {/* Sprite style */}
        <div>
          <span className="block text-[11px] text-gray-500 mb-1.5">
            Sprite-Stil
          </span>
          <div className="grid grid-cols-4 gap-1.5">
            {SPRITE_STYLES.map((s) => {
              const available = isSpriteStyleAvailable(s.key, selectedGameGen);
              return (
                <button
                  key={s.key}
                  onClick={() => available && setSpriteStyle(s.key)}
                  disabled={!available}
                  title={
                    available
                      ? s.desc
                      : `Gen ${selectedGameGen}: nicht verfügbar`
                  }
                  className={`flex flex-col items-center gap-0.5 px-1.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors border ${
                    !available
                      ? "opacity-30 cursor-not-allowed bg-bg-dark/50 text-gray-700 border-border-subtle/50"
                      : spriteStyle === s.key
                        ? "bg-accent-blue/10 text-accent-blue border-accent-blue/30"
                        : "bg-bg-dark text-gray-500 border-border-subtle hover:text-gray-300"
                  }`}
                >
                  <span>{s.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Sprite type + Language in one row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="block text-[11px] text-gray-500 mb-1.5">
              Variante
            </span>
            <div className="flex gap-2">
              {(["shiny", "normal"] as SpriteType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setSpriteType(t)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                    spriteType === t
                      ? "bg-accent-blue/10 text-accent-blue border-accent-blue/30"
                      : "bg-bg-dark text-gray-500 border-border-subtle hover:text-gray-300"
                  }`}
                >
                  {t === "shiny" ? "✨ Shiny" : "Normal"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="block text-[11px] text-gray-500 mb-1.5">
              Sprache
            </span>
            <div className="flex gap-1.5">
              {availableLangs.map((lang) => (
                <button
                  key={lang}
                  onClick={() => {
                    setLanguage(lang as Language);
                    if (selected) {
                      const sl = buildSearchList(allPokemon);
                      const fullP = sl.find(
                        (p) =>
                          p.spriteId === selected.spriteId &&
                          p.canonical === selected.canonical,
                      );
                      if (fullP)
                        setSelected({
                          ...selected,
                          name: getPkmnName(fullP, lang),
                        });
                    }
                  }}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                    language === lang
                      ? "bg-accent-blue/10 text-accent-blue border-accent-blue/30"
                      : "bg-bg-dark text-gray-500 border-border-subtle hover:text-gray-300"
                  }`}
                >
                  {lang.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Game selector */}
        <div>
          <span className="block text-[11px] text-gray-500 mb-1.5">Spiel</span>
          <select
            value={selectedGame}
            onChange={(e) => setSelectedGame(e.target.value)}
            className="w-full bg-bg-secondary border border-border-subtle rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-accent-blue/50 transition-colors"
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

        {/* Custom sprite URL */}
        <div>
          <span className="block text-[11px] text-gray-500 mb-1.5">
            Eigene Sprite-URL
          </span>
          <input
            type="url"
            value={customSprite}
            onChange={(e) => setCustomSprite(e.target.value)}
            placeholder="https://…"
            className="w-full bg-bg-secondary border border-border-subtle rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-600 outline-none focus:border-accent-blue/50 transition-colors"
          />
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 mt-4 pt-4 border-t border-border-subtle">
        <button
          onClick={onCancel}
          className="flex-1 py-2 rounded-lg border border-border-subtle text-gray-400 hover:text-white hover:border-gray-500 transition-colors text-xs"
        >
          Abbrechen
        </button>
        <button
          onClick={handleSave}
          disabled={!selected}
          className="flex-1 py-2 rounded-lg bg-accent-blue hover:bg-blue-500 text-white font-semibold text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
        >
          <Check className="w-3.5 h-3.5" />
          Speichern
        </button>
      </div>
    </div>
  );
}
