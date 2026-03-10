import { useState, useEffect, useRef } from "react";
import { X, Search, Globe, AlertTriangle, Sparkles } from "lucide-react";
import { useI18n } from "../contexts/I18nContext";
import { GameEntry, Language } from "../types";
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
  readonly onAdd: (data: NewPokemonData) => void;
  readonly onClose: () => void;
  readonly activeLanguages?: string[];
}

export interface NewPokemonData {
  name: string;
  canonical_name: string;
  sprite_url: string;
  sprite_type: SpriteType;
  sprite_style: SpriteStyle;
  language: Language;
  game: string;
  hunt_type: string;
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

export function AddPokemonModal({
  onAdd,
  onClose,
  activeLanguages = ["de", "en"],
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();

  const [language, setLanguage] = useState<Language>(
    (activeLanguages.includes("de")
      ? "de"
      : (activeLanguages[0] ?? "en")) as Language,
  );
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [allPokemon, setAllPokemon] = useState<PokemonData[]>([]);
  const [missingNames, setMissingNames] = useState(false);

  const [selected, setSelected] = useState<{
    id: number;
    canonical: string;
    name: string;
    sprite: string;
    spriteId: number;
  } | null>(null);
  const [customSprite, setCustomSprite] = useState("");
  const [spriteType, setSpriteType] = useState<SpriteType>("shiny");
  const [spriteStyle, setSpriteStyle] = useState<SpriteStyle>("classic");

  const [games, setGames] = useState<GameEntry[]>([]);
  const [selectedGame, setSelectedGame] = useState("");
  const [huntType, setHuntType] = useState("encounter");

  // Get the generation for the currently selected game
  const selectedGameGen: number | null =
    games.find((g) => g.key === selectedGame)?.generation ?? null;

  useEffect(() => {
    dialogRef.current?.showModal();
    inputRef.current?.focus();

    fetch("/api/pokedex")
      .then((r) => r.json())
      .then((data: PokemonData[]) => {
        setAllPokemon(data);
        const hasNames = data.some(
          (p) => p.names && Object.keys(p.names).length > 0,
        );
        setMissingNames(!hasNames);
      })
      .catch(() => {});

    fetch("/api/games")
      .then((r) => r.json())
      .then((data: GameEntry[]) => setGames(data))
      .catch(() => {});
  }, []);

  // Auto-switch style when game changes and current style is unavailable
  useEffect(() => {
    if (selectedGameGen != null) {
      const best = bestAvailableStyle(spriteStyle, selectedGameGen);
      if (best !== spriteStyle) {
        setSpriteStyle(best);
      }
    }
  }, [selectedGameGen]);

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
    const q = query.trim().toLowerCase();
    if (!q) {
      setSuggestions([]);
      return;
    }
    const searchList = buildSearchList(allPokemon);
    const results = searchList
      .filter((p) => {
        if (p.canonical.includes(q)) return true;
        if (p.names) {
          for (const name of Object.values(p.names)) {
            if (name?.toLowerCase().includes(q)) return true;
          }
        }
        if (q.match(/^\d+$/) && p.spriteId === parseInt(q, 10)) return true;
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
  };

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

  const handleAdd = () => {
    if (!selected || !selectedGame) return;
    onAdd({
      name: selected.name,
      canonical_name: selected.canonical,
      sprite_url: customSprite || selected.sprite,
      sprite_type: spriteType,
      sprite_style: spriteStyle,
      language,
      game: selectedGame,
      hunt_type: huntType,
    });
    onClose();
  };

  const handleCancel = () => {
    dialogRef.current?.close();
    onClose();
  };

  const activeName = selected ? selected.name : "";
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
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-bold text-text-primary">
          {t("modal.addTitle")}
        </h2>
        <button
          onClick={handleCancel}
          className="text-text-muted hover:text-text-primary transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {missingNames && (
        <div className="flex items-start gap-2 p-3 mb-4 rounded-lg bg-amber-900/20 border border-amber-700/30 text-amber-300 text-xs">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{t("modal.missingNames")}</span>
        </div>
      )}

      <div className="flex items-center gap-2 mb-4">
        <Globe className="w-4 h-4 text-text-muted" />
        <span className="text-xs text-text-muted">{t("modal.language")}:</span>
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
                  setSelected({ ...selected, name: getPkmnName(fullP, lang) });
                }
              }
            }}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors border ${
              language === lang
                ? "bg-accent-blue/10 text-accent-blue border-accent-blue/30"
                : "bg-bg-primary text-text-muted border-border-subtle hover:text-text-secondary"
            }`}
          >
            {lang.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="relative mb-4">
        <div className="flex items-center gap-2 bg-bg-secondary border border-border-subtle rounded-lg px-3 py-2">
          <Search className="w-4 h-4 text-text-muted flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(null);
            }}
            placeholder={t("modal.searchPokemon")}
            className="flex-1 bg-transparent text-text-primary placeholder-text-faint outline-none text-sm"
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
                  className={`capitalize ${s.isForm ? "text-text-secondary pl-3 border-l border-border-subtle" : "text-text-primary"}`}
                >
                  {getPkmnName(s, language)}
                </span>
                <span className="text-text-muted text-xs italic">
                  {s.canonical}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div className="flex items-center gap-4 bg-bg-secondary rounded-lg p-4 mb-4">
          <div className="w-20 h-20 bg-bg-primary rounded-lg flex items-center justify-center flex-shrink-0">
            {selected.sprite ? (
              <img
                src={customSprite || selected.sprite}
                alt={activeName}
                className="w-full h-full object-contain"
                style={
                  spriteStyle === "classic"
                    ? { imageRendering: "pixelated" }
                    : undefined
                }
              />
            ) : (
              <span className="text-3xl text-text-faint">?</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-text-primary text-lg">{activeName}</p>
            <p className="text-xs text-text-muted capitalize">
              {selected.canonical}
            </p>
          </div>
        </div>
      )}

      {/* Sprite style — with generation-aware availability */}
      <div className="mb-4">
        <span className="block text-xs text-text-muted mb-2">
          {t("modal.spriteStyle")}:
        </span>
        <div className="grid grid-cols-4 gap-2">
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
                    : `${t("modal.notAvailable")} ${selectedGameGen}`
                }
                className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg text-xs font-medium transition-colors border ${
                  !available
                    ? "bg-bg-primary/50 text-text-faint border-border-subtle/50 cursor-not-allowed opacity-40"
                    : spriteStyle === s.key
                      ? "bg-accent-blue/10 text-accent-blue border-accent-blue/30"
                      : "bg-bg-primary text-text-muted border-border-subtle hover:text-text-secondary"
                }`}
              >
                <span className="text-sm">{s.label}</span>
                <span className="text-[10px] text-text-faint leading-tight text-center">
                  {s.desc}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mb-4">
        <span className="block text-xs text-text-muted mb-2">
          {t("modal.variant")}:
        </span>
        <div className="flex gap-3">
          {(["shiny", "normal"] as SpriteType[]).map((tp) => (
            <label key={tp} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="sprite-type"
                value={tp}
                checked={spriteType === tp}
                onChange={() => setSpriteType(tp)}
                className="accent-accent-blue"
              />
              <span
                className={`text-sm capitalize flex items-center gap-1 ${spriteType === tp ? "text-text-primary" : "text-text-muted"}`}
              >
                {tp === "shiny" && <Sparkles className="w-3.5 h-3.5" />}
                {tp === "shiny" ? "Shiny" : "Normal"}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="mb-4">
        <label
          htmlFor="custom-sprite-add"
          className="block text-xs text-text-muted mb-1"
        >
          {t("modal.customSprite")}
        </label>
        <input
          id="custom-sprite-add"
          type="url"
          value={customSprite}
          onChange={(e) => setCustomSprite(e.target.value)}
          placeholder="https://…"
          className="w-full bg-bg-secondary border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-faint outline-none focus:border-accent-blue/50 transition-colors"
        />
      </div>

      <div className="mb-4">
        <label
          htmlFor="game-select-add"
          className="block text-xs text-text-muted mb-1"
        >
          {t("modal.game")}
        </label>
        <select
          id="game-select-add"
          value={selectedGame}
          onChange={(e) => setSelectedGame(e.target.value)}
          className="w-full bg-bg-secondary border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-blue/50 transition-colors"
        >
          <option value="">{t("modal.noGame")}</option>
          {Object.entries(genGroups).map(([gen, entries]) => (
            <optgroup key={gen} label={`${t("modal.generation")} ${gen}`}>
              {entries.map((g) => (
                <option key={g.key} value={g.key}>
                  {getGameName(g, [language, ...activeLanguages, "en"])}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="mb-5">
        <label
          htmlFor="hunt-type-select-add"
          className="block text-xs text-text-muted mb-1"
        >
          {t("huntType.label")}
        </label>
        <select
          id="hunt-type-select-add"
          value={huntType}
          onChange={(e) => setHuntType(e.target.value)}
          className="w-full bg-bg-secondary border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-blue/50 transition-colors"
        >
          {(["encounter", "soft_reset", "masuda", "fossil", "gift", "radar", "horde", "sos", "outbreak", "sandwich"] as const).map((key) => (
            <option key={key} value={key}>
              {t(`huntType.${key}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-3">
        <button
          onClick={handleCancel}
          className="flex-1 py-2 rounded-lg border border-border-subtle text-text-muted hover:text-text-primary hover:border-text-muted transition-colors text-sm"
        >
          {t("modal.cancel")}
        </button>
        <button
          onClick={handleAdd}
          disabled={!selected}
          className="flex-1 py-2 rounded-lg bg-accent-blue hover:bg-accent-blue/80 text-white font-semibold text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t("modal.add")}
        </button>
      </div>
    </dialog>
  );
}
