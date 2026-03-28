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
  Gamepad2,
} from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import { GameEntry } from "../../types";
import {
  getSpriteUrl,
  getDefaultSpriteUrl,
  SpriteType,
  SpriteStyle,
  SPRITE_STYLES,
  SPRITE_FALLBACK,
  isSpriteStyleAvailable,
  bestAvailableStyle,
  getPokemonGeneration,
} from "../../utils/sprites";
import { TrimmedBoxSprite } from "../shared/TrimmedBoxSprite";
import { getGameName, ALL_LANGUAGES } from "../../utils/games";
import { getAvailableHuntMethods } from "../../utils/huntTypes";
import { CountryFlag } from "../shared/CountryFlag";
import { apiUrl } from "../../utils/api";

// --- Exported types ---

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

export interface ExistingPokemonData {
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
}

export type PokemonFormModalProps =
  | {
      mode: "add";
      onSubmit: (data: NewPokemonData) => void;
      onClose: () => void;
      activeLanguages?: string[];
    }
  | {
      mode: "edit";
      pokemon: ExistingPokemonData;
      onSubmit: (id: string, data: NewPokemonData) => void;
      onClose: () => void;
      activeLanguages?: string[];
    };

// --- Internal types ---

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

// --- Helpers ---

function getPkmnName(
  p: SearchResult | PokemonData | PokemonForm,
  lang: string,
): string {
  return p.names?.[lang] || p.names?.["en"] || p.canonical;
}

/**
 * Unified modal for adding a new Pokemon or editing an existing one.
 * Operates in "add" or "edit" mode via a discriminated union prop type.
 */
export function PokemonFormModal(props: Readonly<PokemonFormModalProps>) {
  const isEdit = props.mode === "edit";
  const activeLanguages = props.activeLanguages ?? ["de", "en"];

  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();

  // --- State initialization (differs by mode) ---
  const [language, setLanguage] = useState<string>(
    isEdit
      ? props.pokemon.language || "de"
      : activeLanguages.includes("de")
        ? "de"
        : activeLanguages[0] ?? "en",
  );
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [allPokemon, setAllPokemon] = useState<PokemonData[]>([]);
  const [missingNames, setMissingNames] = useState(false);
  const [showSearch, setShowSearch] = useState(!isEdit);
  const [showCustomSprite, setShowCustomSprite] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);

  const [selected, setSelected] = useState<{
    id: number;
    canonical: string;
    name: string;
    sprite: string;
    spriteId: number;
  } | null>(null);
  const [customSprite, setCustomSprite] = useState(
    isEdit ? props.pokemon.sprite_url : "",
  );
  const [spriteType, setSpriteType] = useState<SpriteType>(
    isEdit ? props.pokemon.sprite_type || "shiny" : "shiny",
  );
  const [spriteStyle, setSpriteStyle] = useState<SpriteStyle>(
    isEdit ? props.pokemon.sprite_style || "box" : "box",
  );

  const [title, setTitle] = useState(isEdit ? props.pokemon.title || "" : "");
  const [step, setStep] = useState(isEdit ? props.pokemon.step || 1 : 1);

  const [games, setGames] = useState<GameEntry[]>([]);
  const [selectedGame, setSelectedGame] = useState(
    isEdit ? props.pokemon.game || "" : "",
  );
  const [huntType, setHuntType] = useState(
    isEdit ? props.pokemon.hunt_type || "encounter" : "encounter",
  );

  // Get the generation for the currently selected game
  const selectedGameGen: number | null =
    games.find((g) => g.key === selectedGame)?.generation ?? null;

  // Get the generation in which the selected Pokemon was introduced
  const pokemonGen: number | null = selected
    ? getPokemonGeneration(selected.id)
    : null;

  // --- Build search list from pokedex data ---
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

  // --- Open dialog + load pokedex and games on mount ---
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

        // In edit mode, match the pokemon's canonical name against loaded data
        if (isEdit) {
          const pokemon = props.pokemon;
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
        }
      })
      .catch(() => {});

    fetch(apiUrl("/api/games"))
      .then((r) => r.json())
      .then((data: GameEntry[]) => setGames(data))
      .catch(() => {});
  }, []);

  // --- Auto-switch style when game changes and current style is unavailable ---
  useEffect(() => {
    if (selectedGameGen != null) {
      const best = bestAvailableStyle(spriteStyle, selectedGameGen);
      if (best !== spriteStyle) {
        setSpriteStyle(best);
      }
    }
  }, [selectedGameGen]);

  // --- Clear game selection if it predates the selected Pokemon's generation ---
  useEffect(() => {
    if (selected && selectedGame) {
      const gameGen = games.find((g) => g.key === selectedGame)?.generation;
      const pkGen = getPokemonGeneration(selected.id);
      if (gameGen != null && gameGen < pkGen) {
        setSelectedGame("");
      }
    }
  }, [selected?.id, games]);

  // --- Search filtering ---
  // When query is empty but input focused, show dex-ordered base Pokemon (browse mode).
  // When query has text, filter by name/canonical/ID as before.
  const isBrowseMode = inputFocused && !query.trim();

  useEffect(() => {
    if (isEdit && !showSearch) {
      setSuggestions([]);
      return;
    }
    const q = query.trim().toLowerCase();
    if (!q) {
      if (inputFocused && allPokemon.length > 0) {
        // Browse mode: show base forms sorted by dex number
        const browselist = allPokemon
          .map((p) => ({
            id: p.id,
            canonical: p.canonical,
            names: p.names,
            isForm: false,
            spriteId: p.id,
          }))
          .slice(0, 30);
        setSuggestions(browselist);
      } else {
        setSuggestions([]);
      }
      return;
    }
    // Search: match base Pokemon and forms, grouping forms under their base.
    // When a base matches, include its forms. When only a form matches, include
    // the base first then the matching form.
    const matchesQuery = (entry: { canonical: string; names?: Record<string, string>; spriteId: number }) => {
      if (entry.canonical.includes(q)) return true;
      if (entry.names) {
        for (const name of Object.values(entry.names)) {
          if (name?.toLowerCase().includes(q)) return true;
        }
      }
      if (/^\d+$/.test(q) && entry.spriteId === Number.parseInt(q, 10)) return true;
      return false;
    };

    const results: SearchResult[] = [];
    for (const p of allPokemon) {
      const baseEntry: SearchResult = { id: p.id, canonical: p.canonical, names: p.names, isForm: false, spriteId: p.id };
      const baseMatches = matchesQuery(baseEntry);
      const formEntries: SearchResult[] = (p.forms || []).map((f) => ({
        id: p.id, canonical: f.canonical, names: f.names, isForm: true, spriteId: f.sprite_id,
      }));
      const matchingForms = formEntries.filter(matchesQuery);

      if (baseMatches) {
        results.push(baseEntry, ...formEntries);
      } else if (matchingForms.length > 0) {
        results.push(baseEntry, ...matchingForms);
      }
      if (results.length >= 20) break;
    }
    setSuggestions(results.slice(0, 20));
  }, [query, allPokemon, showSearch, inputFocused]);

  // --- Select a pokemon from search results ---
  const selectPokemon = (p: SearchResult) => {
    setSuggestions([]);
    setInputFocused(false);
    setQuery(getPkmnName(p, language));

    // Auto-switch sprite style if current style is unavailable for this Pokemon's generation
    const pkGen = getPokemonGeneration(p.id);
    let effectiveStyle = spriteStyle;
    if (!isSpriteStyleAvailable(spriteStyle, pkGen)) {
      effectiveStyle = bestAvailableStyle(spriteStyle, pkGen);
      setSpriteStyle(effectiveStyle);
    }

    const sprite = getSpriteUrl(
      p.spriteId.toString(),
      selectedGame,
      spriteType,
      effectiveStyle,
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
    if (isEdit) {
      setShowSearch(false);
    }
  };

  // --- Recalculate sprite URL when dependencies change ---
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

  // --- Language change handler (updates selected name to match new language) ---
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

  // --- Submit handler ---
  const handleSubmit = () => {
    if (!selected) return;
    const data: NewPokemonData = {
      name: selected.name,
      title: title || undefined,
      canonical_name: selected.canonical,
      sprite_url: customSprite || selected.sprite,
      sprite_type: spriteType,
      sprite_style: spriteStyle,
      language,
      game: selectedGame,
      hunt_type: huntType,
      step: isEdit && step > 1 ? step : undefined,
    };
    if (isEdit) {
      props.onSubmit(props.pokemon.id, data);
    } else {
      props.onSubmit(data);
      props.onClose();
    }
  };

  const handleCancel = () => {
    dialogRef.current?.close();
    props.onClose();
  };

  const activeName = selected ? selected.name : "";
  const availableLangs =
    activeLanguages.length > 0 ? activeLanguages : ["en"];

  const genGroups = games
    .filter((g) => pokemonGen === null || g.generation >= pokemonGen)
    .reduce<Record<number, GameEntry[]>>((acc, g) => {
      if (!acc[g.generation]) acc[g.generation] = [];
      acc[g.generation].push(g);
      return acc;
    }, {});

  // --- Input class reused across form fields ---
  const inputClass =
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
          {isEdit ? t("modal.editTitle") : t("modal.addTitle")}
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
          {/* Sprite area */}
          <div className="flex flex-col items-center gap-2 w-full">
            {selected ? (
              <>
                <TrimmedBoxSprite
                  canonicalName={selected.canonical}
                  spriteType={spriteType}
                  alt={activeName}
                  className="h-28 w-auto mx-auto"
                  hideOnFail
                />
                <img
                  src={customSprite || selected.sprite}
                  alt={activeName}
                  className="h-16 w-auto mx-auto pokemon-sprite"
                  style={
                    spriteStyle === "box" || spriteStyle === "classic"
                      ? { imageRendering: "pixelated" }
                      : undefined
                  }
                  onError={(e) => {
                    const img = e.currentTarget;
                    if (!img.src.endsWith("/0.png")) {
                      img.src = SPRITE_FALLBACK;
                    }
                  }}
                />
              </>
            ) : (
              <div className="h-28 flex items-center justify-center">
                <span className="text-5xl text-text-faint select-none">?</span>
              </div>
            )}
          </div>

          {/* Pokemon name + canonical */}
          {selected ? (
            <div className="text-center">
              <p className="font-bold text-text-primary">{activeName}</p>
              <p className="text-xs text-text-muted">#{selected.canonical}</p>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-sm text-text-faint">
                {t("modal.searchPokemon")}
              </p>
            </div>
          )}

          {/* Sprite style — 2-column grid with preview images */}
          <div className="w-full">
            <span className="block text-xs text-text-muted mb-2">
              {t("modal.spriteStyle")}:
            </span>
            <div className="grid grid-cols-2 gap-2">
              {SPRITE_STYLES.filter((s) =>
                isSpriteStyleAvailable(s.key, selectedGameGen ?? pokemonGen),
              ).map((s, index, filtered) => {
                const previewUrl = selected
                  ? getSpriteUrl(
                      selected.spriteId.toString(),
                      selectedGame,
                      spriteType,
                      s.key,
                      selected.canonical,
                    )
                  : "";
                // Last item in an odd-length list spans full width
                const isLastOdd =
                  index === filtered.length - 1 &&
                  filtered.length % 2 === 1;
                return (
                  <button
                    key={s.key}
                    onClick={() => setSpriteStyle(s.key)}
                    title={s.desc}
                    className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg text-xs font-medium transition-colors border ${isLastOdd ? "col-span-2" : ""} ${
                      spriteStyle === s.key
                        ? "bg-accent-blue/10 text-accent-blue border-accent-blue/30 ring-1 ring-accent-blue/30"
                        : "bg-bg-primary text-text-muted border-border-subtle hover:text-text-secondary"
                    }`}
                  >
                    {previewUrl ? (
                      <img
                        src={previewUrl}
                        alt={s.label}
                        className="h-10 w-10 object-contain pokemon-sprite"
                        style={
                          s.key === "box" || s.key === "classic"
                            ? { imageRendering: "pixelated" }
                            : undefined
                        }
                        onError={(e) => {
                          const img = e.currentTarget;
                          if (!img.src.endsWith("/0.png")) {
                            img.src = SPRITE_FALLBACK;
                          }
                        }}
                      />
                    ) : (
                      <span className="flex items-center justify-center h-10 w-10 text-lg text-text-faint">
                        ?
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      {s.key === "box" && <Package className="w-3 h-3" />}
                      {s.key === "animated" && <Film className="w-3 h-3" />}
                      {s.key === "3d" && <Box className="w-3 h-3" />}
                      {s.key === "artwork" && <Palette className="w-3 h-3" />}
                      {s.key === "classic" && <Gamepad2 className="w-3 h-3" />}
                      {t(
                        `modal.sprite${s.key === "3d" ? "3d" : s.key.charAt(0).toUpperCase() + s.key.slice(1)}`,
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Shiny / Normal toggle */}
          <div className="w-full">
            <span className="block text-xs text-text-muted mb-2">
              {t("modal.variant")}:
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
                  <span>{tp === "shiny" ? "Shiny" : "Normal"}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Language selector */}
          <div className="w-full">
            <label
              className="flex items-center gap-2 mb-2"
              htmlFor="lang-select-form"
            >
              <Globe className="w-3.5 h-3.5 text-text-muted" />
              <span className="text-xs text-text-muted">
                {t("modal.language")}
              </span>
            </label>
            <div className="flex items-center gap-2 bg-bg-primary border border-border-subtle rounded-lg px-3 py-2">
              <CountryFlag code={language} />
              <select
                id="lang-select-form"
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
          {/* Section: Pokemon search / selected card */}
          {isEdit && selected && !showSearch ? (
            <div className="flex items-center gap-3 bg-bg-secondary rounded-lg px-4 py-3">
              <TrimmedBoxSprite
                canonicalName={selected.canonical}
                spriteType={spriteType}
                alt={activeName}
                className="h-8 w-auto shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-text-primary text-sm">
                  {activeName}
                </p>
                <p className="text-xs text-text-muted">
                  {selected.canonical}
                </p>
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
              <div className="flex items-center gap-2 bg-bg-secondary border border-border-subtle focus-within:border-accent-blue/50 transition-colors rounded-lg px-3 py-2">
                <Search className="w-4 h-4 text-text-muted shrink-0" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSelected(null);
                  }}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => {
                    // Delay to allow click on suggestion before closing
                    setTimeout(() => setInputFocused(false), 200);
                  }}
                  placeholder={t("modal.searchPokemon")}
                  className="flex-1 bg-transparent text-text-primary placeholder-text-faint outline-none focus:outline-none text-sm"
                />
                {isEdit && showSearch && (
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
                  {isBrowseMode && (
                    <div className="px-4 py-1.5 text-xs text-text-faint border-b border-border-subtle bg-bg-primary/50">
                      {t("modal.browseDex")}
                    </div>
                  )}
                  {suggestions.map((s) => (
                    <button
                      key={s.canonical}
                      onClick={() => selectPokemon(s)}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-bg-hover transition-colors flex items-center gap-2.5 ${s.isForm ? "pl-6" : ""}`}
                    >
                      <img
                        src={getDefaultSpriteUrl(s.spriteId)}
                        alt={getPkmnName(s, language)}
                        className="h-7 w-7 object-contain shrink-0"
                        style={{ imageRendering: "pixelated" }}
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                      {!s.isForm && (
                        <span className="w-10 text-xs text-text-faint tabular-nums shrink-0">
                          #{s.id}
                        </span>
                      )}
                      <span
                        className={`capitalize flex-1 min-w-0 truncate ${s.isForm ? "text-text-secondary" : "text-text-primary"}`}
                      >
                        {getPkmnName(s, language)}
                      </span>
                      <span className="text-xs text-text-muted shrink-0">
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
          <div className="flex flex-col gap-3">
            <div>
              <label
                htmlFor="game-select-form"
                className="block text-xs text-text-muted mb-1"
              >
                {t("modal.game")}
              </label>
              <select
                id="game-select-form"
                value={selectedGame}
                onChange={(e) => setSelectedGame(e.target.value)}
                className={inputClass}
              >
                <option value="">{t("modal.noGame")}</option>
                {Object.entries(genGroups).map(([gen, entries]) => (
                  <optgroup
                    key={gen}
                    label={`${t("modal.generation")} ${gen}`}
                  >
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
                htmlFor="title-form"
                className="block text-xs text-text-muted mb-1"
              >
                {t("modal.titleLabel")}
              </label>
              <input
                id="title-form"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("modal.titlePlaceholder")}
                className={inputClass}
              />
            </div>
          </div>

          {/* Section: Hunt Type (+ Step in edit mode) */}
          {isEdit ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="hunt-type-select-form"
                  className="block text-xs text-text-muted mb-1"
                >
                  {t("huntType.label")}
                </label>
                <select
                  id="hunt-type-select-form"
                  value={huntType}
                  onChange={(e) => setHuntType(e.target.value)}
                  className={inputClass}
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
                  htmlFor="step-form"
                  className="block text-xs text-text-muted mb-1"
                >
                  {t("modal.stepLabel")}
                </label>
                <input
                  id="step-form"
                  type="number"
                  min={1}
                  value={step}
                  onChange={(e) =>
                    setStep(
                      Math.max(1, Number.parseInt(e.target.value) || 1),
                    )
                  }
                  className={inputClass}
                />
              </div>
            </div>
          ) : (
            <div>
              <label
                htmlFor="hunt-type-select-form"
                className="block text-xs text-text-muted mb-1"
              >
                {t("huntType.label")}
              </label>
              <select
                id="hunt-type-select-form"
                value={huntType}
                onChange={(e) => setHuntType(e.target.value)}
                className={inputClass}
              >
                {getAvailableHuntMethods(selectedGameGen).map((m) => (
                  <option key={m.key} value={m.key}>
                    {t(`huntType.${m.key}`)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Divider */}
          <div className="border-b border-border-subtle" />

          {/* Section: Custom Sprite URL — collapsible */}
          <div>
            <button
              onClick={() => setShowCustomSprite((prev) => !prev)}
              className="flex items-center gap-2 text-xs text-text-muted hover:text-text-secondary transition-colors p-1.5"
              aria-label={t("modal.customSprite")}
              aria-expanded={showCustomSprite}
            >
              <ChevronDown
                className={`w-4 h-4 transition-transform ${showCustomSprite ? "rotate-0" : "-rotate-90"}`}
              />
              <span>{t("modal.customSprite")}</span>
            </button>
            {showCustomSprite && (
              <div className="mt-2">
                <input
                  id="custom-sprite-form"
                  type="url"
                  value={customSprite}
                  onChange={(e) => setCustomSprite(e.target.value)}
                  placeholder="https://..."
                  className={inputClass}
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
          onClick={handleSubmit}
          disabled={!selected}
          className="flex-1 py-2 rounded-lg bg-accent-blue hover:bg-accent-blue/80 text-white font-semibold text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isEdit ? t("modal.save") : t("modal.add")}
        </button>
      </div>
    </dialog>
  );
}
