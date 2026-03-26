import { useState, useEffect, useRef } from "react";
import {
  X,
  Search,
  Globe,
  AlertTriangle,
  ArrowRightLeft,
  Sparkles,
  ChevronDown,
  Package,
  Film,
  Box,
  Palette,
} from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import { apiUrl } from "../../utils/api";
import { GameEntry } from "../../types";
import {
  getSpriteUrl,
  SpriteType,
  SpriteStyle,
  SPRITE_STYLES,
  isSpriteStyleAvailable,
  bestAvailableStyle,
  getPokemonGeneration,
} from "../../utils/sprites";
import { getGameName, ALL_LANGUAGES } from "../../utils/games";
import { getAvailableHuntMethods } from "../../utils/huntTypes";
import { TrimmedBoxSprite } from "../shared/TrimmedBoxSprite";
import { CountryFlag } from "../shared/CountryFlag";

type Props = Readonly<{
  pokemon: {
    id: string;
    name: string;
    title?: string;
    canonical_name: string;
    sprite_url: string;
    sprite_type: SpriteType;
    sprite_style?: SpriteStyle;
    language: string;
    game: string;
    hunt_type?: string;
    step?: number;
  };
  onSave: (id: string, data: NewPokemonData) => void;
  onClose: () => void;
  activeLanguages?: string[];
}>;

export interface NewPokemonData {
  name: string;
  title?: string;
  canonical_name: string;
  sprite_url: string;
  sprite_type: SpriteType;
  sprite_style: SpriteStyle;
  language: string;
  game: string;
  hunt_type: string;
  step?: number;
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
  return p.names?.[lang] || p.names?.["en"] || p.canonical;
}

/** Modal dialog for editing an existing Pokemon's properties. */
export function EditPokemonModal({
  pokemon,
  onSave,
  onClose,
  activeLanguages = ["de", "en"],
}: Readonly<Props>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();

  const [language, setLanguage] = useState<string>(pokemon.language || "de");
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [allPokemon, setAllPokemon] = useState<PokemonData[]>([]);
  const [missingNames, setMissingNames] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showCustomSprite, setShowCustomSprite] = useState(false);

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
    ((pokemon.sprite_style as string) === "classic" ? "box" : pokemon.sprite_style) || "box",
  );

  const [title, setTitle] = useState(pokemon.title || "");
  const [step, setStep] = useState(pokemon.step || 1);

  const [games, setGames] = useState<GameEntry[]>([]);
  const [selectedGame, setSelectedGame] = useState(pokemon.game || "");
  const [huntType, setHuntType] = useState(pokemon.hunt_type || "encounter");

  // Get the generation for the currently selected game
  const selectedGameGen: number | null =
    games.find((g) => g.key === selectedGame)?.generation ?? null;

  // Get the generation in which the selected Pokemon was introduced
  const pokemonGen: number | null = selected ? getPokemonGeneration(selected.id) : null;

  // Open dialog + load data on mount
  useEffect(() => {
    dialogRef.current?.showModal();
    inputRef.current?.focus();

    fetch(apiUrl("/api/pokedex"))
      .then((r) => r.json())
      .then((data: PokemonData[]) => {
        setAllPokemon(data);
        const hasNames = data.some(
          (p) => (p.names && Object.keys(p.names).length > 0) ?? false,
        );
        setMissingNames(!hasNames);

        const matchBase = data.find(
          (p) => p.canonical === pokemon.canonical_name,
        );
        if (matchBase) {
          const sprite = getSpriteUrl(
            matchBase.id.toString(),
            selectedGame,
            spriteType,
            spriteStyle,
            matchBase.canonical,
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
        for (const p of data) {
          const form = p.forms?.find(
            (f) => f.canonical === pokemon.canonical_name,
          );
          if (form) {
            const sprite = getSpriteUrl(
              form.sprite_id.toString(),
              selectedGame,
              spriteType,
              spriteStyle,
              form.canonical,
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

    fetch(apiUrl("/api/games"))
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

  // Clear game selection if it predates the selected Pokemon's generation
  useEffect(() => {
    if (selected && selectedGame) {
      const gameGen = games.find((g) => g.key === selectedGame)?.generation;
      const pkGen = getPokemonGeneration(selected.id);
      if (gameGen != null && gameGen < pkGen) {
        setSelectedGame("");
      }
    }
  }, [selected?.id, games]);

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
    const results = searchList
      .filter((p) => {
        if (p.canonical.includes(q)) return true;
        if (p.names) {
          for (const name of Object.values(p.names)) {
            if (name?.toLowerCase().includes(q)) return true;
          }
        }
        if (/^\d+$/.test(q) && p.spriteId === Number.parseInt(q, 10)) return true;
        return false;
      })
      .slice(0, 12);
    setSuggestions(results);
  }, [query, allPokemon, showSearch]);

  const selectPokemon = (p: SearchResult) => {
    setSuggestions([]);
    setShowSearch(false);
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

  const handleSave = () => {
    if (!selected) return;
    onSave(pokemon.id, {
      name: selected.name,
      title,
      canonical_name: selected.canonical,
      sprite_url: customSprite || selected.sprite,
      sprite_type: spriteType,
      sprite_style: spriteStyle,
      language,
      game: selectedGame,
      hunt_type: huntType,
      step: step > 1 ? step : undefined,
    });
  };

  const handleCancel = () => {
    dialogRef.current?.close();
    onClose();
  };

  const handleLanguageChange = (lang: string) => {
    setLanguage(lang);
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
  };

  const activeName = selected ? selected.name : "";
  const availableLangs = activeLanguages.length > 0 ? activeLanguages : ["en"];

  const genGroups = games
    .filter((g) => pokemonGen === null || g.generation >= pokemonGen)
    .reduce<Record<number, GameEntry[]>>((acc, g) => {
      if (!acc[g.generation]) acc[g.generation] = [];
      acc[g.generation].push(g);
      return acc;
    }, {});

  // --- Input field classes (shared) ---
  const inputClasses =
    "w-full bg-bg-secondary border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-faint outline-none focus:border-accent-blue/50 transition-colors";

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleCancel}
      aria-modal="true"
      className="m-auto bg-bg-card border border-border-subtle rounded-2xl p-6 w-full max-w-2xl animate-slide-in backdrop:bg-black/70"
    >
      {/* --- Header --- */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-bold text-text-primary">
          {t("modal.editTitle")}
        </h2>
        <button
          onClick={handleCancel}
          className="text-text-muted hover:text-text-primary transition-colors p-1.5"
          aria-label={t("aria.close")}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {missingNames && (
        <div className="flex items-start gap-2 p-3 mb-4 rounded-lg bg-amber-900/20 border border-amber-700/30 text-amber-300 text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{t("modal.missingNames")}</span>
        </div>
      )}

      {/* --- Two-column layout --- */}
      <div className="grid grid-cols-[260px_1fr] gap-6">
        {/* --- Left Column: Pokemon Identity --- */}
        <div className="bg-bg-secondary rounded-xl p-4 flex flex-col items-center gap-3">
          {/* Large sprite area */}
          <div className="flex flex-col items-center gap-2 w-full">
            {selected ? (
              <>
                <TrimmedBoxSprite
                  canonicalName={selected.canonical}
                  spriteType={spriteType}
                  alt={activeName}
                  className="h-28 w-auto mx-auto"
                />
                <img
                  src={customSprite || selected.sprite}
                  alt={activeName}
                  className="h-16 w-auto mx-auto pokemon-sprite"
                  style={
                    spriteStyle === "box"
                      ? { imageRendering: "pixelated" }
                      : undefined
                  }
                />
              </>
            ) : (
              <div className="h-28 flex items-center justify-center">
                <span className="text-4xl text-text-faint">?</span>
              </div>
            )}
          </div>

          {/* Pokemon name + canonical */}
          {selected && (
            <div className="text-center">
              <p className="font-bold text-text-primary">{activeName}</p>
              <p className="text-xs text-text-muted">#{selected.canonical}</p>
            </div>
          )}

          {/* Sprite style buttons — 2x2 grid */}
          <div className="w-full">
            <span className="block text-xs text-text-muted mb-2">
              {t("modal.spriteStyle")}
            </span>
            <div className="grid grid-cols-2 gap-2">
              {SPRITE_STYLES.map((s) => {
                const available = isSpriteStyleAvailable(s.key, selectedGameGen);
                const previewUrl = selected
                  ? getSpriteUrl(selected.spriteId.toString(), selectedGame, spriteType, s.key, selected.canonical)
                  : "";
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
                      (() => {
                        if (!available) return "bg-bg-primary/50 text-text-faint border-border-subtle/50 cursor-not-allowed opacity-40";
                        if (spriteStyle === s.key) return "bg-accent-blue/10 text-accent-blue border-accent-blue/30 ring-1 ring-accent-blue/40";
                        return "bg-bg-primary text-text-muted border-border-subtle hover:text-text-secondary";
                      })()
                    }`}
                  >
                    {previewUrl ? (
                      <img
                        src={previewUrl}
                        className="h-10 w-10 object-contain pokemon-sprite"
                        alt={s.label}
                        style={
                          s.key === "box"
                            ? { imageRendering: "pixelated" }
                            : undefined
                        }
                      />
                    ) : (
                      <span className="flex items-center justify-center h-10 w-10 text-lg text-text-faint">?</span>
                    )}
                    <span className="flex items-center gap-1">
                      {s.key === "box" && <Package className="w-3 h-3" />}
                      {s.key === "animated" && <Film className="w-3 h-3" />}
                      {s.key === "3d" && <Box className="w-3 h-3" />}
                      {s.key === "artwork" && <Palette className="w-3 h-3" />}
                      {t(`modal.sprite${s.key === "3d" ? "3d" : s.key.charAt(0).toUpperCase() + s.key.slice(1)}`)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Shiny/Normal toggle */}
          <div className="w-full">
            <span className="block text-xs text-text-muted mb-2">
              {t("modal.variant")}
            </span>
            <div className="grid grid-cols-2 gap-2">
              {(["shiny", "normal"] as SpriteType[]).map((tp) => (
                <button
                  key={tp}
                  onClick={() => setSpriteType(tp)}
                  className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors border ${
                    spriteType === tp
                      ? "bg-accent-blue/10 text-accent-blue border-accent-blue/30"
                      : "bg-bg-primary text-text-muted border-border-subtle hover:text-text-secondary"
                  }`}
                >
                  {tp === "shiny" && <Sparkles className="w-3.5 h-3.5" />}
                  {tp === "shiny" ? "Shiny" : "Normal"}
                </button>
              ))}
            </div>
          </div>

          {/* Language selector */}
          <div className="w-full">
            <label className="flex items-center gap-2 mb-2" htmlFor="lang-select-edit">
              <Globe className="w-3.5 h-3.5 text-text-muted" />
              <span className="text-xs text-text-muted">{t("modal.language")}</span>
            </label>
            <div className="flex items-center gap-2 bg-bg-primary border border-border-subtle rounded-lg px-3 py-2">
              <CountryFlag code={language} />
              <select
                id="lang-select-edit"
                value={language}
                onChange={(e) => handleLanguageChange(e.target.value)}
                className="flex-1 bg-transparent text-sm text-text-primary outline-none"
              >
                {availableLangs.map((lang) => {
                  const info = ALL_LANGUAGES.find((l) => l.code === lang);
                  return (
                    <option key={lang} value={lang}>
                      {info?.label ?? lang.toUpperCase()}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>
        </div>

        {/* --- Right Column: Form Fields --- */}
        <div className="flex flex-col gap-4">
          {/* Section: Pokemon search */}
          {selected && !showSearch ? (
            <div className="flex items-center gap-3 bg-bg-secondary rounded-lg px-4 py-3">
              <TrimmedBoxSprite
                canonicalName={selected.canonical}
                spriteType={spriteType}
                alt={activeName}
                className="h-8 w-auto shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-text-primary text-sm">{activeName}</p>
                <p className="text-xs text-text-muted">{selected.canonical}</p>
              </div>
              <button
                onClick={() => {
                  setShowSearch(true);
                  setQuery("");
                  setTimeout(() => inputRef.current?.focus(), 50);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-primary border border-border-subtle text-text-muted hover:text-text-primary text-xs font-medium transition-colors"
              >
                <ArrowRightLeft className="w-3.5 h-3.5" />
                {t("modal.change")}
              </button>
            </div>
          ) : (
            <div className="relative">
              <div className="flex items-center gap-2 bg-bg-secondary border border-border-subtle rounded-lg px-3 py-2">
                <Search className="w-4 h-4 text-text-muted shrink-0" />
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
                {showSearch && (
                  <button
                    onClick={() => setShowSearch(false)}
                    className="text-text-muted hover:text-text-primary p-1"
                    aria-label={t("aria.close")}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {suggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-bg-secondary border border-border-subtle rounded-lg overflow-hidden z-10 shadow-xl max-h-52 overflow-y-auto">
                  {suggestions.map((s) => (
                    <button
                      key={s.canonical}
                      onClick={() => selectPokemon(s)}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-bg-hover transition-colors flex items-center gap-3"
                    >
                      <TrimmedBoxSprite
                        canonicalName={s.canonical}
                        alt={getPkmnName(s, language)}
                        className="h-7 w-auto shrink-0"
                      />
                      <span
                        className={`capitalize ${s.isForm ? "text-text-secondary pl-3 border-l border-border-subtle" : "text-text-primary"}`}
                      >
                        {getPkmnName(s, language)}
                      </span>
                      <span className="ml-auto text-xs text-text-muted">
                        {s.canonical}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Divider */}
          <div className="border-b border-border-subtle" />

          {/* Section: Game + Title */}
          <div>
            <label
              htmlFor="game-select-edit"
              className="block text-xs text-text-muted mb-1"
            >
              {t("modal.game")}
            </label>
            <select
              id="game-select-edit"
              value={selectedGame}
              onChange={(e) => setSelectedGame(e.target.value)}
              className={inputClasses}
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

          <div>
            <label
              htmlFor="title-edit"
              className="block text-xs text-text-muted mb-1"
            >
              {t("modal.titleLabel")}
            </label>
            <input
              id="title-edit"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("modal.titlePlaceholder")}
              className={inputClasses}
            />
          </div>

          {/* Section: Hunt Type + Step */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="hunt-type-select-edit"
                className="block text-xs text-text-muted mb-1"
              >
                {t("huntType.label")}
              </label>
              <select
                id="hunt-type-select-edit"
                value={huntType}
                onChange={(e) => setHuntType(e.target.value)}
                className={inputClasses}
              >
                {getAvailableHuntMethods(selectedGameGen).map((m) => (
                  <option key={m.key} value={m.key}>
                    {t(`huntType.${m.key}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="step-edit"
                className="block text-xs text-text-muted mb-1"
              >
                {t("modal.stepLabel")}
              </label>
              <input
                id="step-edit"
                type="number"
                min={1}
                value={step}
                onChange={(e) => setStep(Math.max(1, Number.parseInt(e.target.value) || 1))}
                className={inputClasses}
              />
            </div>
          </div>

          {/* Divider */}
          <div className="border-b border-border-subtle" />

          {/* Section: Custom Sprite URL (collapsible) */}
          <div>
            <button
              onClick={() => setShowCustomSprite(!showCustomSprite)}
              className="flex items-center gap-2 text-xs text-text-muted hover:text-text-secondary transition-colors"
              aria-expanded={showCustomSprite}
            >
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform ${showCustomSprite ? "rotate-0" : "-rotate-90"}`}
              />
              {t("modal.customSprite")}
            </button>
            {showCustomSprite && (
              <div className="mt-2">
                <input
                  id="custom-sprite-edit"
                  type="url"
                  value={customSprite}
                  onChange={(e) => setCustomSprite(e.target.value)}
                  placeholder="https://..."
                  className={inputClasses}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* --- Footer --- */}
      <div className="flex gap-3 mt-6">
        <button
          onClick={handleCancel}
          className="flex-1 py-2 rounded-lg border border-border-subtle text-text-muted hover:text-text-primary hover:border-text-muted transition-colors text-sm"
        >
          {t("modal.cancel")}
        </button>
        <button
          onClick={handleSave}
          disabled={!selected}
          className="flex-1 py-2 rounded-lg bg-accent-blue hover:bg-accent-blue/80 text-white font-semibold text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t("modal.save")}
        </button>
      </div>
    </dialog>
  );
}
