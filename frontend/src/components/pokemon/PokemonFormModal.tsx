/**
 * PokemonFormModal.tsx: Unified dialog for adding a new Pokemon hunt or editing
 * an existing one.
 *
 * The file keeps the props contract, the form state and the effects that keep
 * that state consistent; the individual blocks it renders and the pure rules
 * they follow live in sibling modules.
 */
import { useState, useEffect, useRef } from "react";
import { AlertTriangle, ArrowRightLeft, Sparkles, ChevronDown, Trash2 } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import { useAnchorName } from "../../utils/anchoredMenu";
import { GameEntry, PhaseTarget, type PokemonGender, type ShinyVariant } from "../../types";
import {
  cachedSpriteSrc,
  getSpriteUrl,
  SpriteType,
  SpriteStyle,
  SPRITE_FALLBACK,
  safeSpriteSrc,
  getPokemonGeneration,
  getGenderSpriteUrl,
} from "../../utils/sprites";
import {
  SearchResult,
  PokemonThumb,
  BROWSE_PAGE,
  getPkmnName,
  buildFormStrip,
  buildSearchList,
  computeSuggestions,
  usePokedex,
} from "./pokemonPicker";
import { PhaseTargetsSection } from "./PhaseTargetsSection";
import { defaultGender, GenderSelector } from "./GenderSelector";
import { TrimmedBoxSprite } from "../shared/TrimmedBoxSprite";
import { getAvailableHuntMethods } from "../../utils/huntTypes";
import {
  gameSupportsCharm,
  gameSupportsShinyVariant,
  methodSupportsSparklingPower,
} from "../../utils/gameGroups";
import { ShinyVariantSelect } from "./ShinyVariantSelect";
import { apiUrl } from "../../utils/api";
import { useToast } from "../../contexts/ToastContext";
import { ModalShell } from "../shared/ModalShell";
import { speciesInPokedex, type UserPokedex } from "../../utils/userPokedex";
import { getGameName } from "../../utils/games";
import {
  addDefaults,
  applyEditModeMatch,
  editDefaults,
  type SelectedState,
} from "./pokemonFormDefaults";
import { submitByMode } from "./pokemonFormSubmit";
import {
  autoSwitchSpriteStyle,
  clearIncompatibleGame,
  pickAvailableStyle,
  resolveEffectiveStyle,
} from "./spriteStyleResolution";
import { handleSpriteDelete, handleSpriteFile, SPRITE_ACCEPT } from "./spriteUpload";
import { GroupAndTagsSection } from "./GroupAndTagsSection";
import { LanguageMenu } from "./LanguageMenu";
import { SpeciesSearchField } from "./SpeciesSearchField";
import { SpriteStylePicker } from "./SpriteStylePicker";

// --- Exported types ---

export interface NewPokemonData {
  name: string;
  base_name?: string;
  form_name?: string;
  title?: string;
  canonical_name: string;
  sprite_url: string;
  sprite_type: SpriteType;
  sprite_style: SpriteStyle;
  gender?: PokemonGender;
  language: string;
  game: string;
  hunt_type: string;
  shiny_charm: boolean;
  sparkling_power: number;
  shiny_variant?: ShinyVariant;
  step?: number;
  encounters?: number;
  timer_accumulated_ms?: number;
  /** Group ID. An empty string means "no group". */
  group_id?: string;
  /** Free-form tags attached to this Pokémon. */
  tags?: string[];
  /** Species that end a phase when they show up shiny. */
  phase_targets?: PhaseTarget[];
  pokedex_ids?: string[];
}

export interface ExistingPokemonData {
  id: string;
  name: string;
  title?: string;
  canonical_name: string;
  sprite_url: string;
  sprite_type: SpriteType;
  sprite_style?: SpriteStyle;
  gender?: PokemonGender;
  language: string;
  game: string;
  hunt_type?: string;
  shiny_charm: boolean;
  sparkling_power?: number;
  shiny_variant?: ShinyVariant;
  step?: number;
  encounters?: number;
  timer_accumulated_ms?: number;
  group_id?: string;
  tags?: string[];
  /** Species that end a phase when they show up shiny. */
  phase_targets?: PhaseTarget[];
  /** ID of the parent hunt when this entry is a finished phase. */
  phase_of?: string;
  pokedex_ids?: string[];
}

/** One group entry as exposed to the Pokémon form (subset of the full Group type). */
export interface GroupOption {
  id: string;
  name: string;
  color: string;
}

export type PokemonFormModalProps =
  | {
      mode: "add";
      onSubmit: (data: NewPokemonData) => void | Promise<void>;
      onClose: () => void;
      activeLanguages?: string[];
      groups?: GroupOption[];
      availableTags?: string[];
      onManageGroups?: () => void;
      enablePokedexes?: boolean;
    }
  | {
      mode: "edit";
      pokemon: ExistingPokemonData;
      onSubmit: (id: string, data: NewPokemonData) => void | Promise<void>;
      onClose: () => void;
      activeLanguages?: string[];
      groups?: GroupOption[];
      availableTags?: string[];
      onManageGroups?: () => void;
      enablePokedexes?: boolean;
    };

/**
 * Unified modal for adding a new Pokemon or editing an existing one.
 * Operates in "add" or "edit" mode via a discriminated union prop type.
 */
export function PokemonFormModal(props: Readonly<PokemonFormModalProps>) {
  const isEdit = props.mode === "edit";
  const activeLanguages = props.activeLanguages ?? ["de", "en"];

  const inputRef = useRef<HTMLInputElement>(null);
  const { t, locale } = useI18n();
  const { push } = useToast();
  const speciesAnchor = useAnchorName("species-search");
  const langAnchor = useAnchorName("lang-menu");

  // --- State initialization (differs by mode) ---
  const defaults = isEdit
    ? editDefaults(props.pokemon, activeLanguages, locale)
    : addDefaults(activeLanguages, locale);

  const [language, setLanguage] = useState<string>(defaults.language);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [browseLimit, setBrowseLimit] = useState(BROWSE_PAGE);
  // Forms of the currently selected base species, shown right after selection
  // so the user can refine to a specific form without reopening the search.
  const [pendingForms, setPendingForms] = useState<SearchResult[]>([]);
  const { allPokemon, games, missingNames } = usePokedex();
  const [showSearch, setShowSearch] = useState(!isEdit);
  const [showCustomSprite, setShowCustomSprite] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);

  const [selected, setSelected] = useState<SelectedState | null>(null);
  const [customSprite, setCustomSprite] = useState(defaults.customSprite);
  // Mirror of customSprite for non-reactive reads inside the recalc effect, so
  // it can detect a user override without re-running on every keystroke.
  const customSpriteRef = useRef(customSprite);
  customSpriteRef.current = customSprite;
  const spriteFileRef = useRef<HTMLInputElement>(null);
  const [spriteUploading, setSpriteUploading] = useState(false);
  const [spriteDeleting, setSpriteDeleting] = useState(false);
  const [spriteType, setSpriteType] = useState<SpriteType>(defaults.spriteType);
  const [spriteStyle, setSpriteStyle] = useState<SpriteStyle>(defaults.spriteStyle);
  const [gender, setGender] = useState<PokemonGender | undefined>(defaults.gender);
  // Sprite styles whose URL failed to load for the currently selected Pokemon.
  // Populated from <img onError> in the previews so we can disable buttons that
  // would otherwise silently fall back to the SPRITE_FALLBACK silhouette.
  const [unavailableStyles, setUnavailableStyles] = useState<Set<SpriteStyle>>(new Set());

  const [title, setTitle] = useState(defaults.title);
  const [step, setStep] = useState(defaults.step);
  const [encounters, setEncounters] = useState(defaults.encounters);
  const [timerH, setTimerH] = useState(defaults.timerH);
  const [timerM, setTimerM] = useState(defaults.timerM);
  const [timerS, setTimerS] = useState(defaults.timerS);

  const [selectedGame, setSelectedGame] = useState(defaults.game);
  const [huntType, setHuntType] = useState(defaults.huntType);
  const [shinyCharm, setShinyCharm] = useState(defaults.shinyCharm);
  const [sparklingPower, setSparklingPower] = useState(defaults.sparklingPower);
  const [shinyVariant, setShinyVariant] = useState<ShinyVariant | "">(defaults.shinyVariant);
  const [groupId, setGroupId] = useState(defaults.groupId);
  const [tags, setTags] = useState<string[]>(defaults.tags);
  const [tagDraft, setTagDraft] = useState("");
  const [phaseTargets, setPhaseTargets] = useState<PhaseTarget[]>(defaults.phaseTargets);
  const [pokedexes, setPokedexes] = useState<UserPokedex[]>([]);
  const [pokedexIDs, setPokedexIDs] = useState<string[]>(
    isEdit ? (props.pokemon.pokedex_ids ?? ["default"]) : ["default"],
  );

  useEffect(() => {
    if (!props.enablePokedexes) return;
    void fetch(apiUrl("/api/pokedexes"))
      .then((response) => (response.ok ? response.json() : []))
      .then(
        (rows) =>
          Array.isArray(rows) &&
          setPokedexes(rows.filter((row) => Array.isArray(row.form_categories))),
      )
      .catch(() => {});
  }, [props.enablePokedexes]);

  // Get the generation for the currently selected game
  const selectedGameGen: number | null =
    games.find((g) => g.key === selectedGame)?.generation ?? null;

  // Get the generation in which the selected Pokemon was introduced
  const pokemonGen: number | null = selected ? getPokemonGeneration(selected.id) : null;
  const selectedSpecies = allPokemon.find((entry) => entry.id === selected?.id);
  const eligiblePokedexes = selectedSpecies
    ? pokedexes.filter(
        (dex) =>
          speciesInPokedex(selectedSpecies, dex, games) &&
          (dex.catch_games.length === 0 || dex.catch_games.includes(selectedGame)),
      )
    : [];

  useEffect(() => {
    if (!props.enablePokedexes || !selectedSpecies || pokedexes.length === 0) return;
    const eligible = new Set(eligiblePokedexes.map((dex) => dex.id));
    setPokedexIDs((ids) => ids.filter((id) => eligible.has(id)));
  }, [props.enablePokedexes, selectedSpecies, selectedGame, pokedexes]);

  // --- Focus search on mount ---
  // The field carries data-autofocus, which useModalDialog applies right after
  // showModal(); a focus() call from here would run before showModal() and be
  // overridden by its own focusing steps.

  // --- Preselect the edited Pokemon once the pokedex has arrived ---
  // Keyed on allPokemon alone so the match runs exactly once per data load,
  // mirroring the previous placement inside the fetch callback; later game or
  // language switches are handled by the form-strip effect below.
  useEffect(() => {
    if (props.mode !== "edit") return;
    applyEditModeMatch(
      allPokemon,
      props.pokemon,
      selectedGame,
      games,
      spriteType,
      spriteStyle,
      setSelected,
      setQuery,
      setPendingForms,
    );
  }, [allPokemon]);

  // --- Auto-switch style when game changes and current style is unavailable ---
  useEffect(
    () => autoSwitchSpriteStyle(selectedGameGen, spriteStyle, setSpriteStyle),
    [selectedGameGen],
  );

  // --- Reset hunt type when game changes if current method is no longer available ---
  useEffect(() => {
    if (!selectedGame) return;
    const available = getAvailableHuntMethods(selectedGame);
    if (!available.some((m) => m.key === huntType)) {
      // Games without wild encounters (Colosseum, XD) do not offer "encounter",
      // so fall back to whatever the game does offer.
      setHuntType(available[0]?.key ?? "encounter");
    }
    if (!gameSupportsCharm(selectedGame)) {
      setShinyCharm(false);
    }
    if (!gameSupportsShinyVariant(selectedGame)) {
      setShinyVariant("");
    }
  }, [selectedGame]);

  // --- Drop the Sparkling Power level when the method cannot use it ---
  useEffect(() => {
    if (!methodSupportsSparklingPower(selectedGame, huntType)) {
      setSparklingPower(0);
    }
  }, [selectedGame, huntType]);

  // --- Clear game selection if it predates the selected Pokemon's generation ---
  useEffect(
    () => clearIncompatibleGame(selected, selectedGame, games, setSelectedGame),
    [selected?.id, games],
  );

  // --- Search filtering ---
  // When query is empty but input focused, show dex-ordered base Pokemon (browse mode).
  // When query has text, filter by name/canonical/ID as before.
  const isBrowseMode = inputFocused && !query.trim();

  useEffect(() => {
    setSuggestions(
      computeSuggestions(
        !isEdit || showSearch,
        query,
        inputFocused,
        allPokemon,
        selectedGame,
        games,
        language,
        browseLimit,
      ),
    );
  }, [query, allPokemon, showSearch, inputFocused, selectedGame, games, language, browseLimit]);

  // Reset the browse window whenever the query changes so a new browse
  // session starts at the top instead of a previously scrolled-down offset.
  useEffect(() => {
    setBrowseLimit(BROWSE_PAGE);
  }, [query]);

  // Rebuild the form strip when its filter inputs arrive or change: the games
  // list loads in parallel with the pokedex (so the edit-mode strip may have
  // been built before game generations were known), and a later game or
  // language switch must re-filter and relabel the strip entries.
  useEffect(() => {
    if (!selected) return;
    const base = allPokemon.find((x) => x.id === selected.id);
    if (base) setPendingForms(buildFormStrip(base, selectedGame, games, language));
  }, [games, selectedGame, language, allPokemon]);

  // --- Select a pokemon from search results ---
  const selectPokemon = (p: SearchResult) => {
    setSuggestions([]);
    setInputFocused(false);
    // The search field always shows the base species name; form entries carry
    // it in baseName, base entries fall back to their own display name.
    setQuery(p.baseName ?? getPkmnName(p, language));

    const effectiveStyle = resolveEffectiveStyle(p.id, spriteStyle, setSpriteStyle);
    const sprite =
      getGenderSpriteUrl(
        {
          canonical_name: p.canonical,
          game: selectedGame,
          sprite_type: spriteType,
          sprite_style: effectiveStyle,
        },
        allPokemon,
        defaultGender(p.genderRate),
      ) ??
      getSpriteUrl(
        p.spriteId.toString(),
        selectedGame,
        spriteType,
        effectiveStyle,
        p.canonical,
        p.spriteSlug,
        p.baseCanonical,
      );
    setSelected({
      id: p.id,
      canonical: p.canonical,
      name: getPkmnName(p, language),
      sprite,
      spriteId: p.spriteId,
      baseCanonical: p.baseCanonical,
      spriteSlug: p.spriteSlug,
      formName: p.formName,
      baseName: p.baseName,
      genderRate: p.genderRate,
    });
    setGender(defaultGender(p.genderRate));
    setCustomSprite(sprite);
    if (isEdit) setShowSearch(false);

    // Surface the picked species' forms so the user can toggle between base
    // and forms. The base itself leads the strip so switching back is possible.
    // Base and form entries share the base `id`, so the strip stays put
    // whichever gets picked; it only clears when the query changes.
    const base = allPokemon.find((x) => x.id === p.id);
    setPendingForms(base ? buildFormStrip(base, selectedGame, games, language) : []);
  };

  // --- Recalculate sprite URL when dependencies change ---
  // selected?.canonical is a dependency because cosmetic forms of the same
  // species all share spriteId 0, so switching between them would otherwise
  // never trigger a recalc.
  useEffect(() => {
    if (!selected) return;
    const newSprite =
      getGenderSpriteUrl(
        {
          canonical_name: selected.canonical,
          game: selectedGame,
          sprite_type: spriteType,
          sprite_style: spriteStyle,
        },
        allPokemon,
        gender,
      ) ??
      getSpriteUrl(
        selected.spriteId.toString(),
        selectedGame,
        spriteType,
        spriteStyle,
        selected.canonical,
        selected.spriteSlug,
        selected.baseCanonical,
      );
    // Preserve a user-set custom sprite (local upload or manual URL): only
    // resync customSprite when it still mirrors the auto-computed sprite.
    const overridden = customSpriteRef.current !== selected.sprite;
    setSelected((prev) => (prev ? { ...prev, sprite: newSprite } : null));
    if (!overridden) setCustomSprite(newSprite);
  }, [
    selectedGame,
    spriteType,
    spriteStyle,
    selected?.spriteId,
    selected?.canonical,
    gender,
    allPokemon,
  ]);

  // --- Reset per-pokemon unavailable-style cache when the relevant inputs change ---
  // Keyed on canonical too: cosmetic forms of one species all share spriteId 0.
  useEffect(() => {
    setUnavailableStyles(new Set());
  }, [selected?.spriteId, selected?.canonical, selectedGame, spriteType]);

  /**
   * Mark a sprite style as unavailable for the current Pokemon. If the active
   * style is the one that just failed, auto-switch to the next available one
   * so the user is never stranded on a silhouette.
   */
  const markStyleUnavailable = (style: SpriteStyle) => {
    setUnavailableStyles((prev) => {
      if (prev.has(style)) return prev;
      const next = new Set(prev);
      next.add(style);
      if (style === spriteStyle) {
        const replacement = pickAvailableStyle(next, selectedGameGen ?? pokemonGen);
        if (replacement) setSpriteStyle(replacement);
      }
      return next;
    });
  };

  // --- Language change handler (updates selected name to match new language) ---
  const handleLanguageChange = (lang: string) => {
    setLanguage(lang);
    if (!selected) return;
    // For language relabeling we want to find the entry regardless of game
    // filtering, so we pass an empty selectedGame to bypass the form filter.
    const fullP = buildSearchList(allPokemon, "", games, lang).find(
      (p) => p.spriteId === selected.spriteId && p.canonical === selected.canonical,
    );
    if (!fullP) return;
    setQuery(fullP.baseName ?? getPkmnName(fullP, lang));
    setSelected({
      ...selected,
      name: getPkmnName(fullP, lang),
      formName: fullP.formName,
      baseName: fullP.baseName,
    });
  };

  // --- Local sprite upload ---
  // Both operations only exist in edit mode; a null id disables them, which is
  // what the helpers in spriteUpload.ts expect instead of the mode union.
  const spriteTargetId = props.mode === "edit" ? props.pokemon.id : null;

  const onSpriteFile = (e: React.ChangeEvent<HTMLInputElement>) =>
    handleSpriteFile(e, {
      pokemonId: spriteTargetId,
      t,
      push,
      setCustomSprite,
      setUploading: setSpriteUploading,
    });

  const onSpriteDelete = () =>
    handleSpriteDelete({
      pokemonId: spriteTargetId,
      t,
      push,
      setCustomSprite,
      setDeleting: setSpriteDeleting,
      fallbackSprite: selected?.sprite ?? "",
    });

  // --- Submit handler; receives requestClose from the ModalShell footer so
  // a successful submit plays the shared close transition ---
  const handleSubmit = (requestClose: () => void) => {
    if (!selected) return;
    const data: NewPokemonData = {
      name: selected.name,
      base_name: selected.baseName || undefined,
      form_name: selected.formName || undefined,
      title: title || undefined,
      canonical_name: selected.canonical,
      sprite_url: customSprite || selected.sprite,
      sprite_type: spriteType,
      sprite_style: spriteStyle,
      gender,
      language,
      game: selectedGame,
      hunt_type: huntType,
      shiny_charm: shinyCharm,
      sparkling_power: sparklingPower,
      shiny_variant: shinyVariant || undefined,
      step: isEdit && step > 1 ? step : undefined,
      encounters,
      timer_accumulated_ms: timerH * 3600000 + timerM * 60000 + timerS * 1000,
      group_id: groupId,
      tags,
      // Always sent so editing unrelated fields never drops phase targets.
      phase_targets: phaseTargets,
      pokedex_ids: pokedexIDs,
    };
    void submitByMode(props, data, requestClose);
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

  // --- Input class reused across form fields ---
  const inputClass =
    "w-full bg-bg-secondary border border-border-subtle rounded-none px-3 py-2 text-sm text-text-primary placeholder-text-faint outline-none focus:border-accent-blue/50 transition-colors";
  const selectClass = "t-select";
  // Whether customSprite currently points at a locally-uploaded blob (as
  // opposed to a manually-typed URL), so the delete/preview UI only shows
  // for sprites this app actually stored for the Pokemon being edited.
  const isUploadedSprite =
    props.mode === "edit" &&
    customSprite.startsWith(apiUrl(`/api/pokemon/${props.pokemon.id}/sprite`));
  // A finished phase is a frozen snapshot of a past phase and never phases
  // again, so it gets no targets of its own.
  const isPhaseEntry = props.mode === "edit" && Boolean(props.pokemon.phase_of);
  const showPhaseTargets = !isPhaseEntry;

  return (
    <ModalShell
      title={isEdit ? t("modal.editTitle") : t("modal.addTitle")}
      onClose={props.onClose}
      size="xl"
      titleSize="sm"
      structured
      footer={(requestClose) => (
        <div className="flex justify-end gap-2">
          <button
            onClick={requestClose}
            className="px-5 py-2 rounded-none border border-border-subtle text-text-muted hover:text-text-primary hover:border-text-muted transition-colors text-sm"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={() => handleSubmit(requestClose)}
            disabled={
              !selected ||
              (props.enablePokedexes &&
                eligiblePokedexes.length > 0 &&
                !pokedexIDs.some((id) => eligiblePokedexes.some((dex) => dex.id === id)))
            }
            className="t-cut px-6 py-2 rounded-none bg-accent-blue hover:bg-accent-blue/80 text-bg-primary font-semibold text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isEdit ? t("common.save") : t("modal.add")}
          </button>
        </div>
      )}
    >
      <>
        {missingNames && (
          <div className="flex items-start gap-2 p-3 mb-4 rounded-none bg-accent-yellow/10 border border-accent-yellow/30 text-accent-yellow text-xs">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{t("modal.missingNames")}</span>
          </div>
        )}

        {/* --- Two-column layout --- */}
        <div className="grid grid-cols-[260px_1fr] gap-6">
          {/* --- Left Column: Pokemon Identity --- */}
          <div className="bg-bg-secondary rounded-none p-4 flex flex-col items-center gap-3">
            {/* Sprite area */}
            <div className="flex flex-col items-center gap-2 w-full">
              {selected ? (
                <>
                  {/* Hero: a high-resolution identity sprite. The box style's
                    tiny menu icon reads as distorted when scaled to hero
                    size, so it swaps to the home render and stays small
                    below as the actual output preview. */}
                  <img
                    // The scheme guard sits outermost, closest to the DOM: the
                    // pasted-URL field feeds this sprite, and nothing that runs
                    // after the check can then put a hostile scheme back.
                    src={safeSpriteSrc(
                      cachedSpriteSrc(
                        customSprite ||
                          (spriteStyle === "box"
                            ? (getGenderSpriteUrl(
                                {
                                  canonical_name: selected.canonical,
                                  game: selectedGame,
                                  sprite_type: spriteType,
                                  sprite_style: "3d",
                                },
                                allPokemon,
                                gender,
                              ) ??
                              getSpriteUrl(
                                selected.spriteId.toString(),
                                selectedGame,
                                spriteType,
                                "3d",
                                selected.canonical,
                                selected.spriteSlug,
                                selected.baseCanonical,
                              ))
                            : selected.sprite),
                      ),
                    )}
                    alt={activeName}
                    className="h-28 w-auto mx-auto pokemon-sprite object-contain"
                    style={spriteStyle === "classic" ? { imageRendering: "pixelated" } : undefined}
                    onError={(e) => {
                      const img = e.currentTarget;
                      if (img.src !== SPRITE_FALLBACK) {
                        img.src = SPRITE_FALLBACK;
                      }
                      if (spriteStyle !== "box") markStyleUnavailable(spriteStyle);
                    }}
                  />
                  <TrimmedBoxSprite
                    canonicalName={selected.canonical}
                    spriteType={spriteType}
                    alt=""
                    className="h-8 w-auto mx-auto"
                    hideOnFail
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
                <p className="text-sm text-text-faint">{t("modal.searchPokemon")}</p>
              </div>
            )}

            {/* Sprite style, 2-column grid with preview images */}
            <SpriteStylePicker
              selected={selected}
              selectedGame={selectedGame}
              spriteType={spriteType}
              spriteStyle={spriteStyle}
              gender={gender}
              generation={selectedGameGen ?? pokemonGen}
              unavailableStyles={unavailableStyles}
              onSelect={setSpriteStyle}
              onStyleUnavailable={markStyleUnavailable}
            />

            {/* Shiny / Normal toggle */}
            <div className="w-full">
              <span className="block text-xs text-text-muted mb-2">{t("modal.variant")}:</span>
              <div className="grid grid-cols-2 gap-2">
                {(["shiny", "normal"] as SpriteType[]).map((tp) => (
                  <button
                    key={tp}
                    onClick={() => setSpriteType(tp)}
                    aria-pressed={spriteType === tp}
                    className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-none text-sm font-medium transition-colors border ${
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
            <LanguageMenu
              language={language}
              availableLangs={availableLangs}
              anchorName={langAnchor}
              onChange={handleLanguageChange}
            />
          </div>

          {/* --- Right Column: Form Fields --- */}
          <div className="flex flex-col gap-4">
            {/* Section: Pokemon search / selected card */}
            {isEdit && selected && !showSearch ? (
              <div className="flex items-center gap-3 bg-bg-secondary rounded-none px-4 py-3">
                <TrimmedBoxSprite
                  canonicalName={selected.canonical}
                  spriteType={spriteType}
                  alt={activeName}
                  className="h-8 w-auto shrink-0"
                  fallbackSrc={cachedSpriteSrc(
                    getSpriteUrl(
                      selected.spriteId.toString(),
                      selectedGame,
                      spriteType,
                      "3d",
                      selected.canonical,
                      selected.spriteSlug,
                      selected.baseCanonical,
                      gender,
                    ),
                  )}
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
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-none bg-bg-primary border border-border-subtle text-text-muted hover:text-text-primary text-xs font-medium transition-colors"
                >
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                  {t("modal.change")}
                </button>
              </div>
            ) : (
              <SpeciesSearchField
                anchorName={speciesAnchor}
                inputRef={inputRef}
                query={query}
                onQueryChange={(value) => {
                  setQuery(value);
                  setSelected(null);
                  setPendingForms([]);
                }}
                onFocusChange={setInputFocused}
                showClose={isEdit && showSearch}
                onClose={() => setShowSearch(false)}
                suggestions={suggestions}
                isBrowseMode={isBrowseMode}
                onGrowBrowse={() =>
                  setBrowseLimit((l) => Math.min(l + BROWSE_PAGE, allPokemon.length))
                }
                language={language}
                onSelect={selectPokemon}
              />
            )}

            {/* Forms of the just-selected base species */}
            {pendingForms.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-xs text-text-muted">{t("modal.forms")}</span>
                <div className="flex flex-wrap gap-1.5">
                  {pendingForms.map((f) => {
                    const isActive = selected?.canonical === f.canonical;
                    return (
                      <button
                        key={f.canonical}
                        type="button"
                        onClick={() => selectPokemon(f)}
                        aria-pressed={isActive}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded-none border text-xs transition-colors ${
                          isActive
                            ? "border-accent-blue/40 bg-accent-blue/10 text-accent-blue"
                            : "border-border-subtle text-text-muted hover:text-text-primary"
                        }`}
                      >
                        <PokemonThumb
                          spriteId={f.spriteId}
                          canonical={f.canonical}
                          spriteSlug={f.spriteSlug}
                          gender={f.gender}
                          alt=""
                          className="h-6 w-6 object-contain shrink-0"
                        />
                        <span className="capitalize truncate max-w-[10rem]">
                          {f.formName || getPkmnName(f, language, t("dex.genderFormFemale"))}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {selected && (
              <GenderSelector
                value={gender}
                genderRate={selected.genderRate}
                onChange={setGender}
              />
            )}

            {/* Divider */}
            <div className="border-b border-border-subtle" />

            {/* Section: Game + Title */}
            <div className="flex flex-col gap-3">
              <div>
                <label htmlFor="game-select-form" className="block text-xs text-text-muted mb-1">
                  {t("modal.game")}
                </label>
                <div className="t-select-wrap">
                  <select
                    id="game-select-form"
                    value={selectedGame}
                    onChange={(e) => setSelectedGame(e.target.value)}
                    className={selectClass}
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
              </div>

              <div>
                <label htmlFor="title-form" className="block text-xs text-text-muted mb-1">
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
                  <div className="t-select-wrap">
                    <select
                      id="hunt-type-select-form"
                      value={huntType}
                      onChange={(e) => setHuntType(e.target.value)}
                      className={selectClass}
                    >
                      {getAvailableHuntMethods(selectedGame).map((m) => (
                        <option key={m.key} value={m.key}>
                          {t(`huntType.${m.key}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label htmlFor="step-form" className="block text-xs text-text-muted mb-1">
                    {t("modal.stepLabel")}
                  </label>
                  <input
                    id="step-form"
                    type="number"
                    min={1}
                    value={step}
                    onChange={(e) => setStep(Math.max(1, Number.parseInt(e.target.value) || 1))}
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
                <div className="t-select-wrap">
                  <select
                    id="hunt-type-select-form"
                    value={huntType}
                    onChange={(e) => setHuntType(e.target.value)}
                    className={selectClass}
                  >
                    {getAvailableHuntMethods(selectedGame).map((m) => (
                      <option key={m.key} value={m.key}>
                        {t(`huntType.${m.key}`)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Encounters */}
            <div>
              <label htmlFor="encounters-form" className="block text-xs text-text-muted mb-1">
                {t("modal.encountersLabel")}
              </label>
              <input
                id="encounters-form"
                type="number"
                min={0}
                value={encounters}
                onChange={(e) =>
                  setEncounters(Math.max(0, Number.parseInt(e.target.value, 10) || 0))
                }
                className={inputClass}
              />
            </div>

            {/* Timer */}
            <div>
              <label className="block text-xs text-text-muted mb-1">{t("modal.timerLabel")}</label>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label
                    htmlFor="timer-h-form"
                    className="block text-[10px] text-text-muted mb-0.5"
                  >
                    {t("timer.hours")}
                  </label>
                  <input
                    id="timer-h-form"
                    type="number"
                    min={0}
                    value={timerH}
                    onChange={(e) =>
                      setTimerH(Math.max(0, Number.parseInt(e.target.value, 10) || 0))
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <label
                    htmlFor="timer-m-form"
                    className="block text-[10px] text-text-muted mb-0.5"
                  >
                    {t("timer.minutes")}
                  </label>
                  <input
                    id="timer-m-form"
                    type="number"
                    min={0}
                    max={59}
                    value={timerM}
                    onChange={(e) =>
                      setTimerM(Math.min(59, Math.max(0, Number.parseInt(e.target.value, 10) || 0)))
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <label
                    htmlFor="timer-s-form"
                    className="block text-[10px] text-text-muted mb-0.5"
                  >
                    {t("timer.seconds")}
                  </label>
                  <input
                    id="timer-s-form"
                    type="number"
                    min={0}
                    max={59}
                    value={timerS}
                    onChange={(e) =>
                      setTimerS(Math.min(59, Math.max(0, Number.parseInt(e.target.value, 10) || 0)))
                    }
                    className={inputClass}
                  />
                </div>
              </div>
            </div>

            {/* Shiny Charm toggle, only shown for games that support it */}
            {gameSupportsCharm(selectedGame) && (
              <label
                htmlFor="shiny-charm-toggle"
                className="flex items-center gap-2 cursor-pointer"
              >
                <input
                  id="shiny-charm-toggle"
                  type="checkbox"
                  checked={shinyCharm}
                  onChange={(e) => setShinyCharm(e.target.checked)}
                  className="rounded-none border-border-subtle text-accent-blue focus:ring-accent-blue"
                />
                <Sparkles size={14} className="text-accent-yellow" />
                <span className="text-xs text-text-secondary">{t("huntType.shinyCharm")}</span>
              </label>
            )}

            {/* Sparkling Power level, only shown for methods a sandwich boosts */}
            {methodSupportsSparklingPower(selectedGame, huntType) && (
              <div>
                <label
                  htmlFor="sparkling-power-select"
                  className="block text-xs text-text-muted mb-1"
                >
                  {t("huntType.sparklingPower")}
                </label>
                <div className="t-select-wrap">
                  <select
                    id="sparkling-power-select"
                    value={sparklingPower}
                    onChange={(e) => setSparklingPower(Number(e.target.value))}
                    className={selectClass}
                  >
                    <option value={0}>{t("huntType.sparklingPowerNone")}</option>
                    {[1, 2, 3].map((level) => (
                      <option key={level} value={level}>
                        {t("huntType.sparklingPowerLevel", { level })}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Shiny variant, only shown for games that have star and square sparkles */}
            {gameSupportsShinyVariant(selectedGame) && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-text-secondary">{t("shinyVariant.label")}</span>
                <ShinyVariantSelect
                  value={shinyVariant}
                  onChange={setShinyVariant}
                  ariaLabel={t("aria.shinyVariant")}
                />
              </div>
            )}

            {/* Section: Phase targets. Hidden for methods whose encounter pool
              holds a single species, and for entries that are themselves a
              finished phase (those never phase again). */}
            {showPhaseTargets && (
              <PhaseTargetsSection
                targets={phaseTargets}
                onChange={setPhaseTargets}
                allPokemon={allPokemon}
                games={games}
                selectedGame={selectedGame}
                language={language}
                spriteStyle={spriteStyle}
              />
            )}

            {/* Divider */}
            <div className="border-b border-border-subtle" />

            {/* Section: Group + Tags */}
            <GroupAndTagsSection
              groups={props.groups ?? []}
              availableTags={props.availableTags ?? []}
              onManageGroups={props.onManageGroups}
              groupId={groupId}
              onGroupChange={setGroupId}
              tags={tags}
              onTagsChange={setTags}
              tagDraft={tagDraft}
              onTagDraftChange={setTagDraft}
              selectClass={selectClass}
              inputClass={inputClass}
            />

            {props.enablePokedexes && pokedexes.length > 0 && (
              <fieldset>
                <legend className="mb-2 text-xs text-text-muted">{t("modal.pokedexes")}</legend>
                <div className="flex flex-wrap gap-2">
                  {eligiblePokedexes.map((dex) => (
                    <label key={dex.id} className="t-label gap-2 px-2">
                      <input
                        type="checkbox"
                        checked={pokedexIDs.includes(dex.id)}
                        onChange={() =>
                          setPokedexIDs((ids) =>
                            ids.includes(dex.id)
                              ? ids.filter((id) => id !== dex.id)
                              : [...ids, dex.id],
                          )
                        }
                      />
                      {dex.name}
                    </label>
                  ))}
                </div>
                {selected && eligiblePokedexes.length === 0 && (
                  <p className="mt-1 text-xs text-accent-yellow">{t("modal.noEligiblePokedex")}</p>
                )}
              </fieldset>
            )}

            {/* Divider */}
            <div className="border-b border-border-subtle" />

            {/* Section: Custom Sprite URL, collapsible */}
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
                <div className="mt-2 space-y-2">
                  <input
                    id="custom-sprite-form"
                    type="url"
                    value={customSprite}
                    onChange={(e) => setCustomSprite(e.target.value)}
                    placeholder="https://..."
                    className={inputClass}
                  />
                  {isEdit ? (
                    <>
                      <input
                        ref={spriteFileRef}
                        type="file"
                        accept={SPRITE_ACCEPT}
                        onChange={onSpriteFile}
                        className="hidden"
                      />
                      <div className="flex gap-2">
                        {isUploadedSprite && (
                          <img
                            src={safeSpriteSrc(customSprite)}
                            alt=""
                            className="w-10 h-10 object-contain rounded-none border border-border-subtle pokemon-sprite"
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => spriteFileRef.current?.click()}
                          disabled={spriteUploading}
                          className={`${isUploadedSprite ? "flex-1" : "w-full"} py-2 rounded-none border border-border-subtle text-text-muted hover:text-text-primary hover:border-text-muted transition-colors text-xs disabled:opacity-40 disabled:cursor-not-allowed`}
                        >
                          {spriteUploading
                            ? t("modal.spriteUpload.uploading")
                            : t("modal.spriteUpload.choose")}
                        </button>
                        {isUploadedSprite && (
                          <button
                            type="button"
                            onClick={onSpriteDelete}
                            disabled={spriteDeleting}
                            aria-label={t("aria.spriteUpload.remove")}
                            className="py-2 px-3 rounded-none border border-border-subtle text-text-muted hover:text-accent-red hover:border-accent-red/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-text-muted">{t("modal.spriteUpload.saveFirst")}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </>
    </ModalShell>
  );
}
