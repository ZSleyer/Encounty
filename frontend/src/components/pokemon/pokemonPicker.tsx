/**
 * Shared Pokémon search building blocks.
 *
 * Holds the pokedex data types, the pure search/filter helpers and the
 * reusable `PokemonSearchPicker` component. Extracted from PokemonFormModal so
 * every place that needs to pick a species (the form modal, the end-phase
 * modal, the phase-targets section) works off one implementation instead of
 * several drifting copies.
 */

import { useState, useEffect, useId, useMemo, useRef, type CSSProperties } from "react";
import { Search } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import { GameEntry } from "../../types";
import {
  getSpriteUrl,
  getDefaultSpriteUrl,
  getBoxSpriteUrl,
  SPRITE_FALLBACK,
} from "../../utils/sprites";
import { apiUrl } from "../../utils/api";

// --- Types ---

/** One selectable form of a base species as delivered by /api/pokedex. */
export interface PokemonForm {
  canonical: string;
  names?: Record<string, string>;
  form_names?: Record<string, string>;
  sprite_id: number;
  /** PokeAPI sprite slug for cosmetic-only forms (sprite_id 0), e.g. "201-b". */
  sprite_slug?: string;
  generations?: number[];
  /** Set on a gender-restricted form (including synthesized gender-only pseudo-forms). */
  gender?: "male" | "female";
}

/** One base species entry as delivered by /api/pokedex. */
export interface PokemonData {
  id: number;
  canonical: string;
  names?: Record<string, string>;
  forms?: PokemonForm[];
}

/** A flattened, selectable search row (base species or one of its forms). */
export interface SearchResult {
  id: number;
  canonical: string;
  names?: Record<string, string>;
  isForm: boolean;
  spriteId: number;
  /** PokeAPI sprite slug for cosmetic-only forms (sprite_id 0), e.g. "201-b". */
  spriteSlug?: string;
  formName?: string;
  baseName?: string;
  /** Canonical of the base species; a form's animated sprite URL needs it. */
  baseCanonical: string;
  /** Set on a gender-restricted form (including synthesized gender-only pseudo-forms). */
  gender?: "male" | "female";
}

// --- Helpers ---

/**
 * Localized display name of a pokedex entry, falling back to English then
 * canonical. `genderFemaleLabel` (pass `t("dex.genderFormFemale")`) covers
 * gender-only pseudo-forms PokeAPI never names (e.g. a synthesized
 * "pikachu-female"): without it these would otherwise fall back to the raw
 * PokeAPI slug instead of a translated label.
 */
export function getPkmnName(
  p: SearchResult | PokemonData | PokemonForm,
  lang: string,
  genderFemaleLabel?: string,
): string {
  const named = p.names?.[lang] || p.names?.["en"];
  if (named) return named;
  const gender = "gender" in p ? p.gender : undefined;
  if (gender === "female" && genderFemaleLabel) return genderFemaleLabel;
  return p.canonical;
}

/**
 * Test whether a Pokémon form is available for the currently selected game.
 * Returns true (no filtering) when no game is selected, when the game is
 * unknown, or when the form has no generation metadata. Otherwise the form
 * is shown only if its generations list contains the game's generation.
 */
export function isFormAvailableForGame(
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

/** Number of browse-mode rows revealed per scroll page. */
export const BROWSE_PAGE = 30;

/** Build browse-mode suggestions (dex-ordered base forms, capped at `limit`). */
export function buildBrowseList(allPokemon: PokemonData[], limit: number): SearchResult[] {
  return allPokemon
    .slice(0, limit)
    .map((p) => ({
      id: p.id,
      canonical: p.canonical,
      names: p.names,
      isForm: false,
      spriteId: p.id,
      baseCanonical: p.canonical,
    }));
}

/** Filter pokemon data by query string, grouping forms under their base. */
export function filterByQuery(
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
    const baseEntry: SearchResult = { id: p.id, canonical: p.canonical, names: p.names, isForm: false, spriteId: p.id, baseCanonical: p.canonical };
    const baseMatches = matchesQuery(baseEntry);
    const matchingForms = formEntriesFor(p, selectedGame, games, language).filter(matchesQuery);

    // The search lists base species only; forms are picked from the strip
    // after selecting the base. Form names still count as matches (e.g.
    // "kappe" or "mega" surfaces the species owning such a form), but never
    // produce their own rows.
    if (baseMatches || matchingForms.length > 0) {
      results.push(baseEntry);
    }
    if (results.length >= 20) break;
  }
  return results.slice(0, 20);
}

/** Map UI locale to candidate Pokemon language codes (UI "es" → Pokemon "es-es"/"es-419"). */
export function localeToPokemonLangs(locale: string): string[] {
  if (locale === "es") return ["es-es", "es-419"];
  return [locale];
}

/** Build a flat search list of all pokemon including forms. */
export function buildSearchList(
  data: PokemonData[],
  selectedGame: string,
  games: GameEntry[],
  language: string = "en",
): SearchResult[] {
  const results: SearchResult[] = [];
  for (const p of data) {
    results.push({ id: p.id, canonical: p.canonical, names: p.names, isForm: false, spriteId: p.id, baseCanonical: p.canonical });
    if (p.forms) {
      for (const f of p.forms) {
        if (!isFormAvailableForGame(f, selectedGame, games)) continue;
        results.push({
          id: p.id, canonical: f.canonical, names: f.names, isForm: true, spriteId: f.sprite_id,
          baseCanonical: p.canonical,
          spriteSlug: f.sprite_slug,
          formName: f.form_names?.[language] || f.form_names?.["en"] || undefined,
          baseName: p.names?.[language] || p.names?.["en"] || undefined,
          gender: f.gender,
        });
      }
    }
  }
  return results;
}

/** Available forms of a base pokemon as selectable entries (game-filtered). */
export function formEntriesFor(
  p: PokemonData,
  selectedGame: string,
  games: GameEntry[],
  language: string,
): SearchResult[] {
  return (p.forms || [])
    .filter((f) => isFormAvailableForGame(f, selectedGame, games))
    .map((f) => ({
      id: p.id, canonical: f.canonical, names: f.names, isForm: true, spriteId: f.sprite_id,
      baseCanonical: p.canonical,
      spriteSlug: f.sprite_slug,
      formName: f.form_names?.[language] || f.form_names?.["en"] || undefined,
      baseName: p.names?.[language] || p.names?.["en"] || undefined,
      gender: f.gender,
    }));
}

/**
 * Build the form-strip entries for a base species: the base itself followed by
 * its game-filtered forms. Returns an empty array when the species has no
 * selectable forms so the strip stays hidden.
 */
export function buildFormStrip(
  base: PokemonData,
  selectedGame: string,
  games: GameEntry[],
  language: string,
): SearchResult[] {
  const forms = formEntriesFor(base, selectedGame, games, language);
  if (forms.length === 0) return [];
  const baseEntry: SearchResult = { id: base.id, canonical: base.canonical, names: base.names, isForm: false, spriteId: base.id, baseCanonical: base.canonical };
  return [baseEntry, ...forms];
}

/** Compute search suggestions based on current query and input state. */
export function computeSuggestions(
  enabled: boolean,
  query: string,
  inputFocused: boolean,
  allPokemon: PokemonData[],
  selectedGame: string,
  games: GameEntry[],
  language: string,
  browseLimit: number,
): SearchResult[] {
  if (!enabled) return [];
  // Dropdown only lives while the field has focus. Without this, selecting a
  // pokemon (which writes its name into `query`) re-triggers the filter and
  // reopens the list until the next click.
  if (!inputFocused) return [];
  const q = query.trim();
  if (!q) {
    return allPokemon.length > 0 ? buildBrowseList(allPokemon, browseLimit) : [];
  }
  return filterByQuery(query, allPokemon, selectedGame, games, language);
}

// --- Pokedex data ---

/** Pokedex and game metadata shared by every species picker. */
export interface PokedexData {
  /** Dex-ordered base species with their forms; empty until the fetch settles. */
  allPokemon: PokemonData[];
  /** Game metadata used for generation filtering; empty until the fetch settles. */
  games: GameEntry[];
  /** True when the loaded pokedex carries no localized names at all. */
  missingNames: boolean;
}

/**
 * Load the pokedex and the game list once on mount.
 *
 * Both requests are fired in parallel and failures are swallowed: a picker
 * without pokedex data still renders, it just offers no suggestions.
 */
export function usePokedex(): PokedexData {
  const [allPokemon, setAllPokemon] = useState<PokemonData[]>([]);
  const [games, setGames] = useState<GameEntry[]>([]);
  const [missingNames, setMissingNames] = useState(false);

  useEffect(() => {
    fetch(apiUrl("/api/pokedex"))
      .then((r) => r.json())
      .then((data: PokemonData[]) => {
        // Consumers iterate the list outside the promise chain, so a malformed
        // payload has to be rejected here instead of throwing later.
        if (!Array.isArray(data)) return;
        setAllPokemon(data);
        setMissingNames(!data.some((p) => p.names && Object.keys(p.names).length > 0));
      })
      .catch(() => {});

    fetch(apiUrl("/api/games"))
      .then((r) => r.json())
      .then((data: GameEntry[]) => {
        if (Array.isArray(data)) setGames(data);
      })
      .catch(() => {});
  }, []);

  return { allPokemon, games, missingNames };
}

// --- Thumbnail ---

interface PokemonThumbProps {
  readonly spriteId: number;
  readonly canonical: string;
  readonly alt: string;
  readonly className?: string;
  /** PokeAPI sprite slug for cosmetic-only forms (sprite_id 0), e.g. "201-b". */
  readonly spriteSlug?: string;
  /**
   * Set on a gender-restricted form so a synthesized female pseudo-form
   * (e.g. "pikachu-female") renders the female sprite instead of the base
   * (male-appearing) one.
   */
  readonly gender?: "male" | "female";
}

/**
 * Small thumbnail sprite with a resilient fallback chain: the PokeAPI default
 * pixel sprite, then the 3D Home render, then the Pokésprite box sprite
 * (which covers form IDs missing from both PokeAPI sets, e.g.
 * pikachu-starter), and finally the neutral placeholder glyph so the slot
 * stays layout-stable instead of collapsing.
 *
 * Cosmetic-only forms (spriteSlug set) have no numeric PokeAPI ID and no 3D
 * Home render, so their chain starts at the slug-based default sprite and
 * skips straight to the Pokésprite box sprite.
 */
export function PokemonThumb({ spriteId, canonical, alt, className, spriteSlug, gender }: PokemonThumbProps) {
  // Candidate URLs in fallback order, deduplicated so onError always advances
  // to a genuinely different source. Pixel-art candidates render pixelated.
  const sources = spriteSlug
    ? [
        { src: getDefaultSpriteUrl(spriteSlug), pixelated: true },
        { src: getBoxSpriteUrl(canonical, "shiny"), pixelated: true },
        { src: SPRITE_FALLBACK, pixelated: false },
      ]
    : [
        { src: getDefaultSpriteUrl(spriteId, "normal", gender), pixelated: true },
        {
          src: getSpriteUrl(spriteId.toString(), "", "shiny", "3d", canonical, undefined, undefined, gender),
          pixelated: false,
        },
        { src: getBoxSpriteUrl(canonical, "shiny"), pixelated: true },
        { src: SPRITE_FALLBACK, pixelated: false },
      ];
  const candidates: { src: string; pixelated: boolean }[] = [];
  const seen = new Set<string>();
  for (const c of sources) {
    if (!seen.has(c.src)) {
      seen.add(c.src);
      candidates.push(c);
    }
  }

  const [candidateIndex, setCandidateIndex] = useState(0);

  // Restart the fallback chain when this instance is reused for a different
  // Pokemon: the surrounding lists key their buttons, not the thumb itself,
  // so React keeps the component instance (and its state) alive across items.
  useEffect(() => {
    setCandidateIndex(0);
  }, [spriteId, canonical, spriteSlug, gender]);

  const current = candidates[Math.min(candidateIndex, candidates.length - 1)];
  return (
    <img
      src={current.src}
      alt={alt}
      className={className}
      style={{ imageRendering: current.pixelated ? "pixelated" : "auto" }}
      onError={() => setCandidateIndex((i) => Math.min(i + 1, candidates.length - 1))}
    />
  );
}

// --- Picker ---

export interface PokemonSearchPickerProps {
  /** Pokedex entries to search in (typically from `usePokedex`). */
  readonly allPokemon: PokemonData[];
  /** Game metadata, used to hide forms that do not exist in `selectedGame`. */
  readonly games: GameEntry[];
  /** Game key the picked species is hunted in; empty disables form filtering. */
  readonly selectedGame: string;
  /** Pokemon language code used for display names. */
  readonly language: string;
  /** Placeholder text of the search field. */
  readonly placeholder: string;
  /** Accessible name of the search field. */
  readonly inputLabel: string;
  /** Canonical name of the current selection, used to mark the active form. */
  readonly selectedCanonical?: string;
  /**
   * Focus the search field on mount. Inside a modal the field is additionally
   * marked with `data-autofocus`, which useModalDialog honours after
   * showModal() would otherwise have claimed the focus for the close button.
   */
  readonly autoFocus?: boolean;
  /**
   * Called with the picked entry (base species or form). `origin` tells the
   * two lists apart: a pick from the search list is also what reveals the form
   * strip, so for a species that has one it is not yet a final choice, while
   * every pick from the strip is.
   */
  readonly onPick: (entry: SearchResult, origin: PickOrigin) => void;
}

/** Which of the picker's two lists a selection came from. */
export type PickOrigin = "search" | "strip";

/**
 * Species search field with a paged suggestion list and a form strip.
 *
 * Owns only its own transient UI state (query, focus, browse window, which
 * base species the strip belongs to) and reports every pick upwards through
 * `onPick`; the caller decides what a selection means. Deliberately sets no
 * `aria-haspopup` so it does not masquerade as a menu button.
 */
export function PokemonSearchPicker({
  allPokemon,
  games,
  selectedGame,
  language,
  placeholder,
  inputLabel,
  selectedCanonical,
  autoFocus,
  onPick,
}: PokemonSearchPickerProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const instanceId = useId();
  // useId() yields colons, which are not valid in a CSS dashed-ident.
  const anchorName = `--picker-${instanceId.replace(/[^a-zA-Z0-9]/g, "-")}`;

  const [query, setQuery] = useState("");
  // True while the suggestion list is open. Bound to focus anywhere inside the
  // combobox, not to the input alone, so tabbing into the list keeps it alive.
  const [listOpen, setListOpen] = useState(false);
  const [browseLimit, setBrowseLimit] = useState(BROWSE_PAGE);
  // Base species the form strip belongs to; null hides the strip.
  const [baseId, setBaseId] = useState<number | null>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // Reset the browse window whenever the query changes so a new browse
  // session starts at the top instead of a previously scrolled-down offset.
  useEffect(() => {
    setBrowseLimit(BROWSE_PAGE);
  }, [query]);

  // When query is empty but the list is open, show dex-ordered base Pokemon
  // (browse mode); with text, filter by name/canonical/ID.
  const isBrowseMode = listOpen && !query.trim();

  const suggestions = useMemo(
    () => computeSuggestions(true, query, listOpen, allPokemon, selectedGame, games, language, browseLimit),
    [query, listOpen, allPokemon, selectedGame, games, language, browseLimit],
  );

  // Rebuild the strip whenever its filter inputs change: the pokedex and the
  // games list load in parallel, and a later game or language switch must
  // re-filter and relabel the entries.
  const formStrip = useMemo(() => {
    if (baseId === null) return [];
    const base = allPokemon.find((p) => p.id === baseId);
    return base ? buildFormStrip(base, selectedGame, games, language) : [];
  }, [baseId, allPokemon, selectedGame, games, language]);

  /**
   * Closes the list once focus leaves the combobox entirely. Focus moving from
   * the field onto a suggestion stays inside and keeps the list mounted, which
   * is what makes it reachable with the Tab key (WCAG 2.1.1).
   */
  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setListOpen(false);
  };

  /**
   * Escape closes the suggestion list and returns focus to the field. The event
   * must not bubble: inside a <dialog> the browser would otherwise treat the
   * same keypress as a close request and dismiss the whole modal.
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || suggestions.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    // Focus first: refocusing the field from a suggestion re-opens the list,
    // and only a close queued afterwards wins.
    inputRef.current?.focus();
    setListOpen(false);
  };

  const handlePick = (entry: SearchResult, origin: PickOrigin) => {
    setListOpen(false);
    // The search field always shows the base species name; form entries carry
    // it in baseName, base entries fall back to their own display name.
    setQuery(entry.baseName ?? getPkmnName(entry, language));
    setBaseId(entry.id);
    onPick(entry, origin);
  };

  return (
    <div className="flex flex-col gap-2">
      <div onBlur={handleBlur} onKeyDown={handleKeyDown}>
        <div
          // anchorName is CSS anchor positioning, which React's CSSProperties
          // does not know yet, hence the cast.
          style={{ anchorName } as CSSProperties}
          className="flex items-center gap-2 bg-bg-secondary border border-border-subtle focus-within:border-accent-blue/50 focus-within:ring-2 focus-within:ring-accent-blue/30 transition-colors rounded-none px-3 py-2"
        >
          <Search className="w-4 h-4 text-text-muted shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            data-autofocus={autoFocus ? true : undefined}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              // Typing re-opens a list that Escape closed, and starts a new
              // search, so the strip of the previous species is no longer
              // meaningful. The caller keeps its pick until a new one arrives
              // through onPick.
              setListOpen(true);
              setBaseId(null);
            }}
            onFocus={() => setListOpen(true)}
            // A pick keeps the focus in the field, so a plain click has to be
            // able to bring the list back; onFocus alone would not fire again.
            onClick={() => setListOpen(true)}
            placeholder={placeholder}
            aria-label={inputLabel}
            className="flex-1 bg-transparent text-text-primary placeholder-text-faint outline-none focus:outline-none focus-visible:outline-none text-sm"
          />
        </div>

        {suggestions.length > 0 && (
          <div
            onScroll={(e) => {
              // Browse mode reveals the full dex in pages of BROWSE_PAGE.
              // Grow the window when the user nears the bottom.
              if (!isBrowseMode) return;
              const el = e.currentTarget;
              if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
                setBrowseLimit((l) => Math.min(l + BROWSE_PAGE, allPokemon.length));
              }
            }}
            // Fixed instead of absolute: the picker lives inside scrollable
            // modal bodies and native <dialog> boxes, whose overflow clipped
            // the list down to a couple of visible rows. A fixed box escapes
            // that clip, and CSS anchor positioning keeps it under the field
            // (and at its width) without JS measuring. The properties are not
            // in React's CSSProperties yet.
            style={
              {
                positionAnchor: anchorName,
                positionArea: "block-end span-inline-end",
                // Without a fallback the list only ever opens downwards and
                // runs off the bottom of short windows. flip-block moves it
                // above the field when there is no room below.
                positionTryFallbacks: "flip-block",
                width: "anchor-size(width)",
                marginBlockStart: "0.25rem",
              } as CSSProperties
            }
            className="fixed bg-bg-secondary border border-border-subtle rounded-none z-50 shadow-xl max-h-[min(13rem,45vh)] overflow-x-hidden overflow-y-auto"
          >
            {isBrowseMode && (
              <div className="px-4 py-1.5 text-xs text-text-faint border-b border-border-subtle bg-bg-primary/50">
                {t("modal.browseDex")}
              </div>
            )}
            {suggestions.map((s) => (
              <button
                key={s.canonical}
                type="button"
                // Keep the press from moving focus at all: browsers that do not
                // focus a clicked button (Safari) would otherwise blur the
                // field and unmount the row before its click fires.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handlePick(s, "search")}
                className="w-full text-left px-3 py-2 text-sm hover:bg-bg-hover transition-colors flex items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
              >
                <PokemonThumb
                  spriteId={s.spriteId}
                  canonical={s.canonical}
                  spriteSlug={s.spriteSlug}
                  gender={s.gender}
                  alt=""
                  className="h-7 w-7 object-contain shrink-0"
                />
                <span className="w-10 text-xs text-text-faint tabular-nums shrink-0">
                  #{s.id}
                </span>
                <span className="capitalize flex-1 min-w-0 truncate text-text-primary">
                  {getPkmnName(s, language, t("dex.genderFormFemale"))}
                </span>
                <span className="text-xs text-text-muted shrink-0">{s.canonical}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {formStrip.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-text-muted">{t("modal.forms")}</span>
          <div className="flex flex-wrap gap-1.5">
            {formStrip.map((f) => {
              const isActive = selectedCanonical === f.canonical;
              return (
                <button
                  key={f.canonical}
                  type="button"
                  onClick={() => handlePick(f, "strip")}
                  aria-pressed={isActive}
                  className={`flex items-center gap-1.5 min-h-[24px] px-2 py-1 rounded-none border text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue ${
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
    </div>
  );
}
