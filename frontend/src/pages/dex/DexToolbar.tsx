/**
 * DexToolbar.tsx: the control panel above the Pokédex grid.
 *
 * Pokédex picker, national/game mode, search, caught state, shiny variant,
 * forms and generations. It owns none of that state: every value and setter is
 * handed down by the page, so the toolbar stays a rendering of the filters
 * rather than a second place they live in.
 */
import { Plus, Settings as SettingsIcon, Trash2 } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import { ShinyVariantSelect } from "../../components/pokemon/ShinyVariantSelect";
import { Toggle } from "../../components/shared/Toggle";
import { getGameName } from "../../utils/games";
import type { DexMode } from "../../utils/dex";
import { DEFAULT_POKEDEX, type UserPokedex } from "../../utils/userPokedex";
import type { useUserPokedexes } from "../../hooks/useUserPokedexes";
import type { GameEntry } from "../../types";
import { CaughtFilterControl } from "./CaughtFilterControl";
import { GenerationChips } from "./GenerationChips";
import { ModeButton } from "./ModeButton";
import type { CaughtFilter, VariantFilter } from "./types";

interface DexToolbarProps {
  /** The Pokédex list plus its mutations, exactly as the page holds it. */
  readonly userPokedexes: ReturnType<typeof useUserPokedexes>;
  readonly mode: DexMode;
  readonly setMode: React.Dispatch<React.SetStateAction<DexMode>>;
  readonly game: string;
  readonly setGame: React.Dispatch<React.SetStateAction<string>>;
  readonly games: GameEntry[];
  /** Language priority list for game names. */
  readonly gameLanguages: string[];
  /** Id of the search field, owned by the page so its label can point at it. */
  readonly searchId: string;
  /** Id of the game select, owned by the page for the same reason. */
  readonly gameId: string;
  readonly query: string;
  readonly setQuery: React.Dispatch<React.SetStateAction<string>>;
  readonly caughtFilter: CaughtFilter;
  readonly setCaughtFilter: React.Dispatch<React.SetStateAction<CaughtFilter>>;
  /** Whether any slot carries a recorded variant at all. */
  readonly hasShinyVariants: boolean;
  readonly variantFilter: VariantFilter;
  readonly setVariantFilter: React.Dispatch<React.SetStateAction<VariantFilter>>;
  /** Whether anything is filtered right now; gates the reset control. */
  readonly filtersActive: boolean;
  readonly clearFilters: () => void;
  readonly generations: number[];
  readonly generationFilter: ReadonlySet<number>;
  readonly toggleGeneration: (generation: number) => void;
  readonly setSettingsDraft: React.Dispatch<React.SetStateAction<UserPokedex | null>>;
  readonly setSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

/** Everything above the grid: which dex is shown, and which of it. */
export function DexToolbar({
  userPokedexes,
  mode,
  setMode,
  game,
  setGame,
  games,
  gameLanguages,
  searchId,
  gameId,
  query,
  setQuery,
  caughtFilter,
  setCaughtFilter,
  hasShinyVariants,
  variantFilter,
  setVariantFilter,
  filtersActive,
  clearFilters,
  generations,
  generationFilter,
  toggleGeneration,
  setSettingsDraft,
  setSettingsOpen,
}: DexToolbarProps) {
  const { t } = useI18n();

  return (
    <div className="t-panel flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <>
          <select
            aria-label={t("dex.selectPokedex")}
            className="t-select w-52"
            value={userPokedexes.active.id}
            onChange={(event) => userPokedexes.setActiveId(event.target.value)}
          >
            {userPokedexes.pokedexes.map((dex) => (
              <option key={dex.id} value={dex.id}>
                {dex.name}
                {dex.id === "default" ? ` (${t("dex.defaultMarker")})` : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="t-label px-2"
            aria-label={t("dex.createPokedex")}
            onClick={() => {
              setSettingsDraft({ ...DEFAULT_POKEDEX, id: "", name: t("dex.newPokedex") });
              setSettingsOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
          </button>
          {userPokedexes.active.id !== "default" && (
            <button
              type="button"
              className="t-label px-2 text-accent-red"
              aria-label={t("dex.deletePokedex")}
              onClick={() => {
                if (window.confirm(t("dex.deletePokedexConfirm")))
                  void userPokedexes
                    .remove(userPokedexes.active.id)
                    .catch(() => window.alert(t("dex.deletePokedexConflict")));
              }}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </>
        <ModeButton active={mode === "national"} onClick={() => setMode("national")}>
          {t("dex.modeNational")}
        </ModeButton>
        <ModeButton active={mode === "game"} onClick={() => setMode("game")}>
          {t("dex.modeGame")}
        </ModeButton>
        {mode === "game" && (
          <div className="flex items-center gap-2">
            <label htmlFor={gameId} className="text-xs text-text-muted">
              {t("dex.pickGame")}
            </label>
            <div className="t-select-wrap w-56">
              <select
                id={gameId}
                className="t-select text-sm"
                value={game}
                onChange={(e) => setGame(e.target.value)}
              >
                {games.map((entry) => (
                  <option key={entry.key} value={entry.key}>
                    {getGameName(entry, gameLanguages)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
          <label htmlFor={searchId} className="text-xs text-text-muted">
            {t("dex.searchLabel")}
          </label>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("dex.searchPlaceholder")}
            className="w-full rounded-none border border-border-subtle bg-bg-secondary px-3 py-2 text-sm text-text-primary placeholder-text-faint focus:border-accent-blue/50 focus:outline-none"
          />
        </div>
        <CaughtFilterControl value={caughtFilter} onChange={setCaughtFilter} />
        {/* Only worth screen space once a variant was actually recorded:
            it is a Sword/Shield detail most dexes never carry. */}
        {hasShinyVariants && (
          <ShinyVariantSelect
            value={variantFilter === "all" ? "" : variantFilter}
            onChange={(value) => setVariantFilter(value || "all")}
            ariaLabel={t("aria.dexVariantFilter")}
            anyLabelKey="dex.filterVariantAll"
          />
        )}
        {/* Grouped with the other list-shaping controls (search, caught
            state), not the mode buttons above: it shapes what the grid
            shows exactly the way they do, National/Spiel choose the
            underlying data instead. Still a pill switch rather than
            another radio/button, since it toggles independently of
            caughtFilter instead of picking one of a fixed set. */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">{t("dex.modeForms")}</span>
          <Toggle
            enabled={userPokedexes.active.show_forms}
            onChange={() =>
              void userPokedexes.save({
                ...userPokedexes.active,
                show_forms: !userPokedexes.active.show_forms,
              })
            }
            label={t("dex.modeForms")}
          />
          <button
            type="button"
            onClick={() => {
              setSettingsDraft(userPokedexes.active);
              setSettingsOpen(true);
            }}
            aria-label={t("dex.settingsTitle")}
            className="t-label min-h-[24px] px-2"
          >
            <SettingsIcon className="h-4 w-4" />
          </button>
        </div>
        {filtersActive && (
          <button
            type="button"
            onClick={clearFilters}
            className="t-label min-h-[24px] px-2 hover:text-text-primary"
          >
            {t("dex.clearFilters")}
          </button>
        )}
      </div>

      <GenerationChips
        generations={generations}
        selected={generationFilter}
        onToggle={toggleGeneration}
      />
    </div>
  );
}
