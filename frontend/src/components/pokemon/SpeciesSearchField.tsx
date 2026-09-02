/**
 * SpeciesSearchField.tsx: The species search box of the Pokemon form together
 * with its anchored suggestion list.
 *
 * Query, suggestions and the browse window live in the form, because effects
 * there recompute them from the pokedex, the picked game and the language; this
 * component only renders them and reports back what the user did.
 */
import { Search, X } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import { anchoredMenuStyle, anchorTriggerStyle } from "../../utils/anchoredMenu";
import { getPkmnName, PokemonThumb, type SearchResult } from "./pokemonPicker";

interface SpeciesSearchFieldProps {
  /** Anchor name of the field; owned by the form so the id stays stable. */
  readonly anchorName: string;
  /** Focused by the form when the user reopens the search in edit mode. */
  readonly inputRef: React.RefObject<HTMLInputElement | null>;
  readonly query: string;
  readonly onQueryChange: (value: string) => void;
  readonly onFocusChange: (focused: boolean) => void;
  /** Whether the field offers a button that collapses the search again. */
  readonly showClose: boolean;
  readonly onClose: () => void;
  readonly suggestions: readonly SearchResult[];
  /** True while the list shows the whole dex instead of query matches. */
  readonly isBrowseMode: boolean;
  /** Called when a browse-mode scroll nears the bottom of the window. */
  readonly onGrowBrowse: () => void;
  readonly language: string;
  readonly onSelect: (entry: SearchResult) => void;
}

/** Renders the species search input and its suggestion list. */
export function SpeciesSearchField({
  anchorName,
  inputRef,
  query,
  onQueryChange,
  onFocusChange,
  showClose,
  onClose,
  suggestions,
  isBrowseMode,
  onGrowBrowse,
  language,
  onSelect,
}: SpeciesSearchFieldProps) {
  const { t } = useI18n();
  return (
    <div className="relative">
      <div
        data-focus-wrapper
        style={anchorTriggerStyle(anchorName)}
        className="flex items-center gap-2 bg-bg-secondary border border-border-subtle focus-within:border-accent-blue/50 focus-within:ring-2 focus-within:ring-accent-blue/30 transition-colors rounded-none px-3 py-2"
      >
        <Search className="w-4 h-4 text-text-muted shrink-0" />
        <input
          ref={inputRef}
          data-autofocus
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onFocus={() => onFocusChange(true)}
          onBlur={() => {
            // Delay to allow click on suggestion before closing
            setTimeout(() => onFocusChange(false), 200);
          }}
          placeholder={t("modal.searchPokemon")}
          className="flex-1 bg-transparent text-text-primary placeholder-text-faint outline-none focus:outline-none focus-visible:outline-none text-sm"
        />
        {showClose && (
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary p-1"
            aria-label={t("aria.close")}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {suggestions.length > 0 && (
        <div
          onScroll={(e) => {
            // Browse mode reveals the full dex one page at a time.
            // Grow the window when the user nears the bottom.
            if (!isBrowseMode) return;
            const el = e.currentTarget;
            if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
              onGrowBrowse();
            }
          }}
          style={anchoredMenuStyle(anchorName, "below-start", true)}
          className="fixed bg-bg-secondary border border-border-subtle rounded-none z-10 shadow-xl overflow-y-auto"
        >
          {isBrowseMode && (
            <div className="px-4 py-1.5 text-xs text-text-faint border-b border-border-subtle bg-bg-primary/50">
              {t("modal.browseDex")}
            </div>
          )}
          {suggestions.map((s) => (
            <button
              key={s.canonical}
              onClick={() => onSelect(s)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-bg-hover transition-colors flex items-center gap-2.5 ${s.isForm ? "pl-6" : ""}`}
            >
              <PokemonThumb
                spriteId={s.spriteId}
                canonical={s.canonical}
                spriteSlug={s.spriteSlug}
                gender={s.gender}
                alt={getPkmnName(s, language, t("dex.genderFormFemale"))}
                className="h-7 w-7 object-contain shrink-0"
              />
              {!s.isForm && (
                <span className="w-10 text-xs text-text-faint tabular-nums shrink-0">#{s.id}</span>
              )}
              <span
                className={`capitalize flex-1 min-w-0 truncate ${s.isForm ? "text-text-secondary" : "text-text-primary"}`}
              >
                {getPkmnName(s, language, t("dex.genderFormFemale"))}
              </span>
              <span className="text-xs text-text-muted shrink-0">{s.canonical}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
