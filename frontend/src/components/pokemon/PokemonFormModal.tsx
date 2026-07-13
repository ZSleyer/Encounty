import { useState, useEffect, useRef } from "react";
import {
  X,
  Search,
  Globe,
  AlertTriangle,
  ArrowRightLeft,
  Sparkles,
  ChevronDown,
  Check,
  Package,
  Film,
  Box,
  Palette,
  Gamepad2,
  Trash2,
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
import { TagChip } from "../shared/TagChip";
import { getGameName, ALL_LANGUAGES } from "../../utils/games";
import { getAvailableHuntMethods } from "../../utils/huntTypes";
import { gameSupportsCharm } from "../../utils/gameGroups";
import { CountryFlag } from "../shared/CountryFlag";
import { apiUrl } from "../../utils/api";
import { useToast } from "../../contexts/ToastContext";
import { ModalShell } from "../shared/ModalShell";

// --- Exported types ---

/**
 * Maximum accepted local sprite upload size in bytes. Kept in sync with the
 * backend cap (spriteMaxBytes) so the client can reject oversized files before
 * uploading; the backend remains the authoritative guard.
 */
const SPRITE_MAX_BYTES = 4 * 1024 * 1024;

/** Image MIME types accepted for local sprite uploads (matches backend). */
const SPRITE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

export interface NewPokemonData {
  name: string;
  base_name?: string;
  form_name?: string;
  title?: string;
  canonical_name: string;
  sprite_url: string;
  sprite_type: SpriteType;
  sprite_style: SpriteStyle;
  language: string;
  game: string;
  hunt_type: string;
  shiny_charm: boolean;
  step?: number;
  encounters?: number;
  timer_accumulated_ms?: number;
  /** Group ID — empty string means "no group". */
  group_id?: string;
  /** Free-form tags attached to this Pokémon. */
  tags?: string[];
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
  shiny_charm: boolean;
  step?: number;
  encounters?: number;
  timer_accumulated_ms?: number;
  group_id?: string;
  tags?: string[];
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
    };

// --- Internal types ---

interface PokemonForm {
  canonical: string;
  names?: Record<string, string>;
  form_names?: Record<string, string>;
  sprite_id: number;
  generations?: number[];
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
  formName?: string;
  baseName?: string;
}

// --- Helpers ---

function getPkmnName(
  p: SearchResult | PokemonData | PokemonForm,
  lang: string,
): string {
  return p.names?.[lang] || p.names?.["en"] || p.canonical;
}

/**
 * Test whether a Pokémon form is available for the currently selected game.
 * Returns true (no filtering) when no game is selected, when the game is
 * unknown, or when the form has no generation metadata. Otherwise the form
 * is shown only if its generations list contains the game's generation.
 */
function isFormAvailableForGame(
  form: PokemonForm,
  selectedGame: string,
  games: GameEntry[],
): boolean {
  if (!selectedGame) return true;
  if (!form.generations?.length) return true;
  const game = games.find((g) => g.key === selectedGame);
  if (!game?.generation) return true;
  return form.generations.includes(game.generation);
}

/** Build browse-mode suggestions (dex-ordered base forms, capped at 30). */
function buildBrowseList(allPokemon: PokemonData[]): SearchResult[] {
  return allPokemon
    .map((p) => ({
      id: p.id,
      canonical: p.canonical,
      names: p.names,
      isForm: false,
      spriteId: p.id,
    }))
    .slice(0, 30);
}

/** Filter pokemon data by query string, grouping forms under their base. */
function filterByQuery(
  query: string,
  allPokemon: PokemonData[],
  selectedGame: string,
  games: GameEntry[],
  language: string,
): SearchResult[] {
  const q = query.trim().toLowerCase();
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
    const availableForms = (p.forms || []).filter((f) => isFormAvailableForGame(f, selectedGame, games));
    const formEntries: SearchResult[] = availableForms.map((f) => ({
      id: p.id, canonical: f.canonical, names: f.names, isForm: true, spriteId: f.sprite_id,
      formName: (f as any).form_names?.[language] || (f as any).form_names?.["en"] || undefined,
      baseName: p.names?.[language] || p.names?.["en"] || undefined,
    }));
    const matchingForms = formEntries.filter(matchesQuery);

    if (baseMatches) {
      results.push(baseEntry, ...formEntries);
    } else if (matchingForms.length > 0) {
      results.push(baseEntry, ...matchingForms);
    }
    if (results.length >= 20) break;
  }
  return results.slice(0, 20);
}

interface FormDefaults {
  language: string;
  customSprite: string;
  spriteType: SpriteType;
  spriteStyle: SpriteStyle;
  title: string;
  step: number;
  game: string;
  huntType: string;
  shinyCharm: boolean;
  encounters: number;
  timerH: number;
  timerM: number;
  timerS: number;
  groupId: string;
  tags: string[];
}

/** Map UI locale to candidate Pokemon language codes (UI "es" → Pokemon "es-es"/"es-419"). */
function localeToPokemonLangs(locale: string): string[] {
  if (locale === "es") return ["es-es", "es-419"];
  return [locale];
}

/** Compute initial form values for add mode. */
function addDefaults(activeLanguages: string[], locale: string): FormDefaults {
  const candidates = localeToPokemonLangs(locale);
  const language = candidates.find((c) => activeLanguages.includes(c)) ?? activeLanguages[0] ?? "en";
  return { language, customSprite: "", spriteType: "shiny", spriteStyle: "box", title: "", step: 1, game: "", huntType: "encounter", shinyCharm: false, encounters: 0, timerH: 0, timerM: 0, timerS: 0, groupId: "", tags: [] };
}

/** Compute initial form values for edit mode from existing pokemon data. */
function editDefaults(pokemon: ExistingPokemonData, activeLanguages: string[], locale: string): FormDefaults {
  const candidates = localeToPokemonLangs(locale);
  const ms = pokemon.timer_accumulated_ms || 0;
  return {
    language: pokemon.language || (candidates.find((c) => activeLanguages.includes(c)) ?? activeLanguages[0] ?? "en"),
    customSprite: pokemon.sprite_url,
    spriteType: pokemon.sprite_type || "shiny",
    spriteStyle: pokemon.sprite_style || "box",
    title: pokemon.title || "",
    step: pokemon.step || 1,
    game: pokemon.game || "",
    huntType: pokemon.hunt_type || "encounter",
    shinyCharm: pokemon.shiny_charm ?? false,
    encounters: pokemon.encounters ?? 0,
    timerH: Math.floor(ms / 3600000),
    timerM: Math.floor((ms % 3600000) / 60000),
    timerS: Math.floor((ms % 60000) / 1000),
    groupId: pokemon.group_id || "",
    tags: Array.isArray(pokemon.tags) ? [...pokemon.tags] : [],
  };
}

/** Build a flat search list of all pokemon including forms. */
function buildSearchList(
  data: PokemonData[],
  selectedGame: string,
  games: GameEntry[],
  language: string = "en",
): SearchResult[] {
  const results: SearchResult[] = [];
  for (const p of data) {
    results.push({ id: p.id, canonical: p.canonical, names: p.names, isForm: false, spriteId: p.id });
    if (p.forms) {
      for (const f of p.forms) {
        if (!isFormAvailableForGame(f, selectedGame, games)) continue;
        results.push({
          id: p.id, canonical: f.canonical, names: f.names, isForm: true, spriteId: f.sprite_id,
          formName: (f as any).form_names?.[language] || (f as any).form_names?.["en"] || undefined,
          baseName: p.names?.[language] || p.names?.["en"] || undefined,
        });
      }
    }
  }
  return results;
}

interface SelectedState {
  id: number;
  canonical: string;
  name: string;
  sprite: string;
  spriteId: number;
  formName?: string;
  baseName?: string;
}

/** Match an existing pokemon's canonical name against loaded pokedex data (edit mode). */
function applyEditModeMatch(
  data: PokemonData[],
  pokemon: ExistingPokemonData,
  selectedGame: string,
  spriteType: SpriteType,
  spriteStyle: SpriteStyle,
  setSelected: (s: SelectedState) => void,
  setQuery: (q: string) => void,
) {
  const matchBase = data.find((p) => p.canonical === pokemon.canonical_name);
  if (matchBase) {
    const sprite = getSpriteUrl(matchBase.id.toString(), selectedGame, spriteType, spriteStyle, matchBase.canonical);
    setSelected({ id: matchBase.id, canonical: matchBase.canonical, name: getPkmnName(matchBase, pokemon.language), sprite, spriteId: matchBase.id });
    setQuery(getPkmnName(matchBase, pokemon.language));
    return;
  }
  for (const p of data) {
    const form = p.forms?.find((f) => f.canonical === pokemon.canonical_name);
    if (form) {
      const sprite = getSpriteUrl(form.sprite_id.toString(), selectedGame, spriteType, spriteStyle, form.canonical);
      setSelected({
        id: p.id, canonical: form.canonical, name: getPkmnName(form, pokemon.language), sprite, spriteId: form.sprite_id,
        formName: (form as any).form_names?.[pokemon.language] || (form as any).form_names?.["en"] || undefined,
        baseName: p.names?.[pokemon.language] || p.names?.["en"] || undefined,
      });
      setQuery(getPkmnName(form, pokemon.language));
      return;
    }
  }
}

/** Dispatch the submit action based on modal mode (add vs edit), then play the
 *  dialog's close transition. Awaits `onSubmit` first (it may be async, e.g.
 *  a save request) so the dialog stays open — and visibly submitting — until
 *  the request settles, succeed or fail, instead of closing instantly and
 *  leaving the caller to close it later with no transition to play. */
async function submitByMode(props: Readonly<PokemonFormModalProps>, data: NewPokemonData, close: () => void) {
  try {
    if (props.mode === "edit") {
      await props.onSubmit(props.pokemon.id, data);
    } else {
      await props.onSubmit(data);
    }
  } finally {
    close();
  }
}

/** Resolve the effective sprite style for a Pokemon, auto-switching if the current style is unavailable. */
function resolveEffectiveStyle(
  pokemonId: number,
  current: SpriteStyle,
  setSpriteStyle: (s: SpriteStyle) => void,
): SpriteStyle {
  const pkGen = getPokemonGeneration(pokemonId);
  if (isSpriteStyleAvailable(current, pkGen)) return current;
  const best = bestAvailableStyle(current, pkGen);
  setSpriteStyle(best);
  return best;
}

/** Compute search suggestions based on current query and input state. */
function computeSuggestions(
  isEdit: boolean,
  showSearch: boolean,
  query: string,
  inputFocused: boolean,
  allPokemon: PokemonData[],
  selectedGame: string,
  games: GameEntry[],
  language: string,
): SearchResult[] {
  if (isEdit && !showSearch) return [];
  const q = query.trim();
  if (!q) {
    return inputFocused && allPokemon.length > 0
      ? buildBrowseList(allPokemon)
      : [];
  }
  return filterByQuery(query, allPokemon, selectedGame, games, language);
}

interface GroupAndTagsSectionProps {
  readonly groups: readonly GroupOption[];
  readonly availableTags: readonly string[];
  readonly onManageGroups?: () => void;
  readonly groupId: string;
  readonly onGroupChange: (id: string) => void;
  readonly tags: string[];
  readonly onTagsChange: (tags: string[]) => void;
  readonly tagDraft: string;
  readonly onTagDraftChange: (v: string) => void;
  readonly selectClass: string;
  readonly inputClass: string;
}

/**
 * Group dropdown + tag input section for the Pokémon form.
 *
 * Kept as a standalone component so it stays out of the large main modal
 * function and can be snapshot-tested independently if needed.
 */
function GroupAndTagsSection({
  groups,
  availableTags,
  onManageGroups,
  groupId,
  onGroupChange,
  tags,
  onTagsChange,
  tagDraft,
  onTagDraftChange,
  selectClass,
  inputClass,
}: GroupAndTagsSectionProps) {
  const { t } = useI18n();

  // Autocomplete suggestions: show tags from the pool that match the current
  // draft (case-insensitive prefix) and are not already attached.
  const draft = tagDraft.trim().toLowerCase();
  const suggestions = draft
    ? availableTags.filter(
        (a) => a.toLowerCase().startsWith(draft) && !tags.includes(a),
      ).slice(0, 5)
    : [];

  const addTag = (raw: string) => {
    const v = raw.trim().toLowerCase();
    if (!v || tags.includes(v)) return;
    onTagsChange([...tags, v]);
    onTagDraftChange("");
  };

  const removeTag = (tag: string) => {
    onTagsChange(tags.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(tagDraft);
    } else if (e.key === "Backspace" && !tagDraft && tags.length > 0) {
      // Convenience: Backspace on empty input removes the last tag.
      removeTag(tags[tags.length - 1]);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label htmlFor="group-select-form" className="flex items-center justify-between text-xs text-text-muted mb-1">
          <span>{t("group.title")}</span>
          {onManageGroups && (
            <button
              type="button"
              onClick={onManageGroups}
              className="text-[11px] text-accent-blue hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue rounded px-1"
            >
              {t("group.manage")}
            </button>
          )}
        </label>
        <div className="t-select-wrap">
          <select
            id="group-select-form"
            value={groupId}
            onChange={(e) => onGroupChange(e.target.value)}
            className={selectClass}
          >
            <option value="">{t("sidebar.noGroup")}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <div className="block text-xs text-text-muted mb-1">{t("tag.filter")}</div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {tags.map((tag) => (
            <TagChip
              key={tag}
              tag={tag}
              active
              removable
              onRemove={() => removeTag(tag)}
            />
          ))}
        </div>
        <div className="relative">
          <input
            type="text"
            value={tagDraft}
            onChange={(e) => onTagDraftChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("tag.placeholder")}
            aria-label={t("tag.add")}
            className={inputClass}
          />
          {suggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-bg-secondary border border-border-subtle rounded-none shadow-lg max-h-40 overflow-y-auto">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => addTag(s)}
                  className="flex items-center w-full px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-bg-primary transition-colors"
                >
                  <TagChip tag={s} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Pick the first sprite style that is both generation-available and not marked
 * as unavailable for the currently selected Pokemon. Returns null if every
 * style has been ruled out.
 */
function pickAvailableStyle(
  unavailable: Set<SpriteStyle>,
  gen: number | null,
): SpriteStyle | null {
  const order: SpriteStyle[] = ["animated", "3d", "artwork", "classic", "box"];
  for (const s of order) {
    if (!unavailable.has(s) && isSpriteStyleAvailable(s, gen)) return s;
  }
  return null;
}

/** Switch sprite style to best available when the current style is unavailable for a generation. */
function autoSwitchSpriteStyle(
  gen: number | null,
  current: SpriteStyle,
  setSpriteStyle: (s: SpriteStyle) => void,
) {
  if (gen == null) return;
  const best = bestAvailableStyle(current, gen);
  if (best !== current) setSpriteStyle(best);
}

/** Clear game selection when the game predates the selected Pokemon's introduction generation. */
function clearIncompatibleGame(
  selected: { id: number } | null,
  selectedGame: string,
  games: GameEntry[],
  setSelectedGame: (g: string) => void,
) {
  if (!selected || !selectedGame) return;
  const gameGen = games.find((g) => g.key === selectedGame)?.generation;
  const pkGen = getPokemonGeneration(selected.id);
  if (gameGen != null && gameGen < pkGen) setSelectedGame("");
}

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

  // --- State initialization (differs by mode) ---
  const defaults = isEdit ? editDefaults(props.pokemon, activeLanguages, locale) : addDefaults(activeLanguages, locale);

  const [language, setLanguage] = useState<string>(defaults.language);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [allPokemon, setAllPokemon] = useState<PokemonData[]>([]);
  const [missingNames, setMissingNames] = useState(false);
  const [showSearch, setShowSearch] = useState(!isEdit);
  const [showCustomSprite, setShowCustomSprite] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);

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

  const [games, setGames] = useState<GameEntry[]>([]);
  const [selectedGame, setSelectedGame] = useState(defaults.game);
  const [huntType, setHuntType] = useState(defaults.huntType);
  const [shinyCharm, setShinyCharm] = useState(defaults.shinyCharm);
  const [groupId, setGroupId] = useState(defaults.groupId);
  const [tags, setTags] = useState<string[]>(defaults.tags);
  const [tagDraft, setTagDraft] = useState("");

  // Get the generation for the currently selected game
  const selectedGameGen: number | null =
    games.find((g) => g.key === selectedGame)?.generation ?? null;

  // Get the generation in which the selected Pokemon was introduced
  const pokemonGen: number | null = selected
    ? getPokemonGeneration(selected.id)
    : null;

  /** Handle pokedex data after fetch. */
  const handlePokedexLoaded = (data: PokemonData[]) => {
    setAllPokemon(data);
    setMissingNames(!data.some((p) => p.names && Object.keys(p.names).length > 0));
    if (isEdit) {
      applyEditModeMatch(data, props.pokemon, selectedGame, spriteType, spriteStyle, setSelected, setQuery);
    }
  };

  // --- Focus search + load pokedex and games on mount (ModalShell opens the dialog) ---
  useEffect(() => {
    inputRef.current?.focus();

    fetch(apiUrl("/api/pokedex"))
      .then((r) => r.json())
      .then(handlePokedexLoaded)
      .catch(() => {});

    fetch(apiUrl("/api/games"))
      .then((r) => r.json())
      .then((data: GameEntry[]) => setGames(data))
      .catch(() => {});
  }, []);

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
      setHuntType("encounter");
    }
    if (!gameSupportsCharm(selectedGame)) {
      setShinyCharm(false);
    }
  }, [selectedGame]);

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
      computeSuggestions(isEdit, showSearch, query, inputFocused, allPokemon, selectedGame, games, language),
    );
  }, [query, allPokemon, showSearch, inputFocused, selectedGame, games, language]);

  // --- Select a pokemon from search results ---
  const selectPokemon = (p: SearchResult) => {
    setSuggestions([]);
    setInputFocused(false);
    setQuery(getPkmnName(p, language));

    const effectiveStyle = resolveEffectiveStyle(p.id, spriteStyle, setSpriteStyle);
    const sprite = getSpriteUrl(
      p.spriteId.toString(), selectedGame, spriteType, effectiveStyle, p.canonical,
    );
    setSelected({
      id: p.id, canonical: p.canonical,
      name: getPkmnName(p, language), sprite, spriteId: p.spriteId,
      formName: p.formName,
      baseName: p.baseName,
    });
    setCustomSprite(sprite);
    if (isEdit) setShowSearch(false);
  };

  // --- Recalculate sprite URL when dependencies change ---
  useEffect(() => {
    if (!selected) return;
    const newSprite = getSpriteUrl(
      selected.spriteId.toString(), selectedGame, spriteType, spriteStyle, selected.canonical,
    );
    // Preserve a user-set custom sprite (local upload or manual URL): only
    // resync customSprite when it still mirrors the auto-computed sprite.
    const overridden = customSpriteRef.current !== selected.sprite;
    setSelected((prev) => (prev ? { ...prev, sprite: newSprite } : null));
    if (!overridden) setCustomSprite(newSprite);
  }, [selectedGame, spriteType, spriteStyle, selected?.spriteId]);

  // --- Reset per-pokemon unavailable-style cache when the relevant inputs change ---
  useEffect(() => {
    setUnavailableStyles(new Set());
  }, [selected?.spriteId, selectedGame, spriteType]);

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
    setQuery(getPkmnName(fullP, lang));
    setSelected({ ...selected, name: getPkmnName(fullP, lang), formName: fullP.formName, baseName: fullP.baseName });
  };

  // --- Local sprite upload handler ---
  /**
   * Upload a locally chosen image as the Pokemon's sprite.
   *
   * Only available in edit mode, where the Pokemon already has an id to upload
   * against. The bytes are stored server-side (DB binary) and served over HTTP;
   * we keep only the returned reference URL in the form. The URL is resolved
   * through apiUrl so it points at the backend (fixed port) from the Electron
   * renderer and the OBS overlay alike, rather than the renderer origin.
   */
  const handleSpriteFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file later
    if (!file || props.mode !== "edit") return;

    if (!SPRITE_ACCEPT.split(",").includes(file.type)) {
      push({ type: "error", title: t("modal.spriteUpload.invalidType") });
      return;
    }
    if (file.size > SPRITE_MAX_BYTES) {
      push({ type: "error", title: t("modal.spriteUpload.tooLarge") });
      return;
    }

    setSpriteUploading(true);
    try {
      const res = await fetch(apiUrl(`/api/pokemon/${props.pokemon.id}/sprite`), {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) {
        const title = res.status === 413
          ? t("modal.spriteUpload.tooLarge")
          : t("modal.spriteUpload.failed");
        push({ type: "error", title });
        return;
      }
      const body: { sprite_url: string } = await res.json();
      setCustomSprite(apiUrl(body.sprite_url));
      push({ type: "success", title: t("modal.spriteUpload.success") });
    } catch {
      push({ type: "error", title: t("modal.spriteUpload.failed") });
    } finally {
      setSpriteUploading(false);
    }
  };

  /**
   * Removes the currently uploaded custom sprite for this Pokemon, both
   * server-side (DELETE the stored BLOB) and in the form state, falling back
   * to the auto-computed default sprite (selected.sprite) instead of leaving
   * the field blank, and persisting that fallback immediately so other views
   * (list, overlay) don't show a broken/placeholder image before the next
   * Save. Only available in edit mode, mirroring handleSpriteFile's guard.
   */
  const handleSpriteDelete = async () => {
    if (props.mode !== "edit") return;
    setSpriteDeleting(true);
    try {
      const res = await fetch(apiUrl(`/api/pokemon/${props.pokemon.id}/sprite`), { method: "DELETE" });
      if (!res.ok) {
        push({ type: "error", title: t("modal.spriteUpload.removeFailed") });
        return;
      }
      const fallback = selected?.sprite ?? "";
      setCustomSprite(fallback);
      if (fallback) {
        await fetch(apiUrl(`/api/pokemon/${props.pokemon.id}`), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sprite_url: fallback }),
        });
      }
      push({ type: "success", title: t("modal.spriteUpload.removed") });
    } catch {
      push({ type: "error", title: t("modal.spriteUpload.removeFailed") });
    } finally {
      setSpriteDeleting(false);
    }
  };

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
      language,
      game: selectedGame,
      hunt_type: huntType,
      shiny_charm: shinyCharm,
      step: isEdit && step > 1 ? step : undefined,
      encounters,
      timer_accumulated_ms: timerH * 3600000 + timerM * 60000 + timerS * 1000,
      group_id: groupId,
      tags,
    };
    void submitByMode(props, data, requestClose);
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
    "w-full bg-bg-secondary border border-border-subtle rounded-none px-3 py-2 text-sm text-text-primary placeholder-text-faint outline-none focus:border-accent-blue/50 transition-colors";
  const selectClass = "t-select";
  // Whether customSprite currently points at a locally-uploaded blob (as
  // opposed to a manually-typed URL), so the delete/preview UI only shows
  // for sprites this app actually stored for the Pokemon being edited.
  const isUploadedSprite =
    props.mode === "edit" && customSprite.startsWith(apiUrl(`/api/pokemon/${props.pokemon.id}/sprite`));

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
            disabled={!selected}
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
                  src={
                    customSprite ||
                    (spriteStyle === "box"
                      ? getSpriteUrl(selected.spriteId.toString(), selectedGame, spriteType, "3d", selected.canonical)
                      : selected.sprite)
                  }
                  alt={activeName}
                  className="h-28 w-auto mx-auto pokemon-sprite object-contain"
                  style={
                    spriteStyle === "classic"
                      ? { imageRendering: "pixelated" }
                      : undefined
                  }
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
                const isUnavailable = unavailableStyles.has(s.key);
                const isSelected = spriteStyle === s.key;
                let buttonStateClass: string;
                if (isUnavailable) {
                  buttonStateClass =
                    "bg-bg-primary text-text-faint border-border-subtle opacity-40 cursor-not-allowed";
                } else if (isSelected) {
                  buttonStateClass =
                    "bg-accent-blue/10 text-accent-blue border-accent-blue/30 ring-1 ring-accent-blue/30";
                } else {
                  buttonStateClass =
                    "bg-bg-primary text-text-muted border-border-subtle hover:text-text-secondary";
                }
                return (
                  <button
                    key={s.key}
                    type="button"
                    disabled={isUnavailable}
                    aria-disabled={isUnavailable}
                    aria-pressed={isSelected}
                    onClick={() => {
                      if (!isUnavailable) setSpriteStyle(s.key);
                    }}
                    title={isUnavailable ? t("modal.spriteUnavailable") : s.desc}
                    className={`flex flex-col items-center gap-1 px-2 py-2 rounded-none text-xs font-medium transition-colors border ${isLastOdd ? "col-span-2" : ""} ${buttonStateClass}`}
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
                          if (img.src !== SPRITE_FALLBACK) {
                            img.src = SPRITE_FALLBACK;
                          }
                          markStyleUnavailable(s.key);
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
          <div className="w-full">
            <label className="flex items-center gap-2 mb-2">
              <Globe className="w-3.5 h-3.5 text-text-muted" />
              <span className="text-xs text-text-muted">
                {t("modal.language")}
              </span>
            </label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setLangMenuOpen((v) => !v)}
                aria-expanded={langMenuOpen}
                aria-haspopup="true"
                aria-label={t("modal.language")}
                className="flex items-center gap-2 w-full bg-bg-primary border border-border-subtle rounded-none px-3 py-2 text-sm text-text-primary hover:border-border-default transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
              >
                <CountryFlag code={language} />
                <span className="flex-1 text-left">{ALL_LANGUAGES.find((l) => l.code === language)?.label ?? language.toUpperCase()}</span>
                <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
              </button>
              {langMenuOpen && (
                <>
                  <button className="fixed inset-0 z-40 cursor-default" onClick={() => setLangMenuOpen(false)} aria-label={t("aria.close")} />
                  <div aria-label={t("modal.language")} className="absolute left-0 bottom-full mb-1 z-50 bg-bg-secondary border border-border-subtle rounded-none shadow-lg py-1 min-w-full max-h-48 overflow-y-auto">
                    {availableLangs.map((lang) => {
                      const info = ALL_LANGUAGES.find((l) => l.code === lang);
                      return (
                        <button
                          key={lang}
                          type="button"
                          aria-pressed={language === lang}
                          onClick={() => { handleLanguageChange(lang); setLangMenuOpen(false); }}
                          className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-primary transition-colors"
                        >
                          <CountryFlag code={lang} className="w-4 h-3" />
                          <span className="flex-1 text-left">{info?.label ?? lang.toUpperCase()}</span>
                          {language === lang && <Check className="w-3.5 h-3.5 text-accent-green" />}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
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
                fallbackSrc={getSpriteUrl(
                  selected.spriteId.toString(),
                  selectedGame,
                  spriteType,
                  "3d",
                  selected.canonical,
                )}
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
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-none bg-bg-primary border border-border-subtle text-text-muted hover:text-text-primary text-xs font-medium transition-colors"
              >
                <ArrowRightLeft className="w-3.5 h-3.5" />
                {t("modal.change")}
              </button>
            </div>
          ) : (
            <div className="relative">
              <div data-focus-wrapper className="flex items-center gap-2 bg-bg-secondary border border-border-subtle focus-within:border-accent-blue/50 focus-within:ring-2 focus-within:ring-accent-blue/30 transition-colors rounded-none px-3 py-2">
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
                  className="flex-1 bg-transparent text-text-primary placeholder-text-faint outline-none focus:outline-none focus-visible:outline-none text-sm"
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
                <div className="absolute top-full left-0 right-0 mt-1 bg-bg-secondary border border-border-subtle rounded-none overflow-hidden z-10 shadow-xl max-h-52 overflow-y-auto">
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
                          // PokeAPI default sprite missing (typical for newer
                          // forms). Swap to the 3D Home render so users still
                          // get a recognizable image instead of an empty slot.
                          const img = e.currentTarget;
                          const fallback = getSpriteUrl(
                            s.spriteId.toString(),
                            "",
                            "shiny",
                            "3d",
                            s.canonical,
                          );
                          if (img.src !== fallback) {
                            img.style.imageRendering = "auto";
                            img.src = fallback;
                          } else {
                            img.style.display = "none";
                          }
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
              <div className="t-select-wrap">
                <select
                  id="game-select-form"
                  value={selectedGame}
                  onChange={(e) => setSelectedGame(e.target.value)}
                  className={selectClass}
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
              onChange={(e) => setEncounters(Math.max(0, Number.parseInt(e.target.value, 10) || 0))}
              className={inputClass}
            />
          </div>

          {/* Timer */}
          <div>
            <label className="block text-xs text-text-muted mb-1">
              {t("modal.timerLabel")}
            </label>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label htmlFor="timer-h-form" className="block text-[10px] text-text-muted mb-0.5">
                  {t("timer.hours")}
                </label>
                <input
                  id="timer-h-form"
                  type="number"
                  min={0}
                  value={timerH}
                  onChange={(e) => setTimerH(Math.max(0, Number.parseInt(e.target.value, 10) || 0))}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="timer-m-form" className="block text-[10px] text-text-muted mb-0.5">
                  {t("timer.minutes")}
                </label>
                <input
                  id="timer-m-form"
                  type="number"
                  min={0}
                  max={59}
                  value={timerM}
                  onChange={(e) => setTimerM(Math.min(59, Math.max(0, Number.parseInt(e.target.value, 10) || 0)))}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="timer-s-form" className="block text-[10px] text-text-muted mb-0.5">
                  {t("timer.seconds")}
                </label>
                <input
                  id="timer-s-form"
                  type="number"
                  min={0}
                  max={59}
                  value={timerS}
                  onChange={(e) => setTimerS(Math.min(59, Math.max(0, Number.parseInt(e.target.value, 10) || 0)))}
                  className={inputClass}
                />
              </div>
            </div>
          </div>

          {/* Shiny Charm toggle — only shown for games that support it */}
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
              <span className="text-xs text-text-secondary">
                {t("huntType.shinyCharm")}
              </span>
            </label>
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
                      onChange={handleSpriteFile}
                      className="hidden"
                    />
                    <div className="flex gap-2">
                      {isUploadedSprite && (
                        <img
                          src={customSprite}
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
                        {spriteUploading ? t("modal.spriteUpload.uploading") : t("modal.spriteUpload.choose")}
                      </button>
                      {isUploadedSprite && (
                        <button
                          type="button"
                          onClick={handleSpriteDelete}
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
