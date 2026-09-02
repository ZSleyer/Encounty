/**
 * pokemonFormDefaults.ts: Initial state derivation for the Pokemon form modal.
 *
 * Both modes reduce to the same flat {@link FormDefaults} bag, so the component
 * itself only ever reads one shape. Edit mode additionally has to find the
 * stored Pokemon in the pokedex once that has loaded, which is what
 * {@link applyEditModeMatch} does.
 */
import type { GameEntry, PhaseTarget, PokemonGender, ShinyVariant } from "../../types";
import { getSpriteUrl, type SpriteStyle, type SpriteType } from "../../utils/sprites";
import {
  buildFormStrip,
  getPkmnName,
  localeToPokemonLangs,
  type PokemonData,
  type SearchResult,
} from "./pokemonPicker";
import type { ExistingPokemonData } from "./PokemonFormModal";

export interface FormDefaults {
  language: string;
  customSprite: string;
  spriteType: SpriteType;
  spriteStyle: SpriteStyle;
  title: string;
  step: number;
  game: string;
  huntType: string;
  shinyCharm: boolean;
  sparklingPower: number;
  shinyVariant: ShinyVariant | "";
  encounters: number;
  timerH: number;
  timerM: number;
  timerS: number;
  groupId: string;
  tags: string[];
  phaseTargets: PhaseTarget[];
  gender?: PokemonGender;
}

/** Compute initial form values for add mode. */
export function addDefaults(activeLanguages: string[], locale: string): FormDefaults {
  const candidates = localeToPokemonLangs(locale);
  const language =
    candidates.find((c) => activeLanguages.includes(c)) ?? activeLanguages[0] ?? "en";
  return {
    language,
    customSprite: "",
    spriteType: "shiny",
    spriteStyle: "box",
    title: "",
    step: 1,
    game: "",
    huntType: "encounter",
    shinyCharm: false,
    sparklingPower: 0,
    shinyVariant: "",
    encounters: 0,
    timerH: 0,
    timerM: 0,
    timerS: 0,
    groupId: "",
    tags: [],
    phaseTargets: [],
    gender: undefined,
  };
}

/** Compute initial form values for edit mode from existing pokemon data. */
export function editDefaults(
  pokemon: ExistingPokemonData,
  activeLanguages: string[],
  locale: string,
): FormDefaults {
  const candidates = localeToPokemonLangs(locale);
  const ms = pokemon.timer_accumulated_ms || 0;
  return {
    language:
      pokemon.language ||
      (candidates.find((c) => activeLanguages.includes(c)) ?? activeLanguages[0] ?? "en"),
    customSprite: pokemon.sprite_url,
    spriteType: pokemon.sprite_type || "shiny",
    spriteStyle: pokemon.sprite_style || "box",
    title: pokemon.title || "",
    step: pokemon.step || 1,
    game: pokemon.game || "",
    huntType: pokemon.hunt_type || "encounter",
    shinyCharm: pokemon.shiny_charm ?? false,
    sparklingPower: pokemon.sparkling_power ?? 0,
    shinyVariant: pokemon.shiny_variant ?? "",
    encounters: pokemon.encounters ?? 0,
    timerH: Math.floor(ms / 3600000),
    timerM: Math.floor((ms % 3600000) / 60000),
    timerS: Math.floor((ms % 60000) / 1000),
    groupId: pokemon.group_id || "",
    tags: Array.isArray(pokemon.tags) ? [...pokemon.tags] : [],
    gender: pokemon.gender,
    phaseTargets: Array.isArray(pokemon.phase_targets) ? [...pokemon.phase_targets] : [],
  };
}

export interface SelectedState {
  id: number;
  canonical: string;
  name: string;
  sprite: string;
  spriteId: number;
  /** PokeAPI sprite slug for cosmetic-only forms (sprite_id 0), e.g. "201-b". */
  spriteSlug?: string;
  formName?: string;
  baseName?: string;
  /** Canonical of the base species; the animated sprite URL of a form needs it. */
  baseCanonical: string;
  genderRate?: number;
}

/** Match an existing pokemon's canonical name against loaded pokedex data (edit mode). */
export function applyEditModeMatch(
  data: PokemonData[],
  pokemon: ExistingPokemonData,
  selectedGame: string,
  games: GameEntry[],
  spriteType: SpriteType,
  spriteStyle: SpriteStyle,
  setSelected: (s: SelectedState) => void,
  setQuery: (q: string) => void,
  setPendingForms: (f: SearchResult[]) => void,
) {
  const matchBase = data.find((p) => p.canonical === pokemon.canonical_name);
  if (matchBase) {
    const sprite = getSpriteUrl(
      matchBase.id.toString(),
      selectedGame,
      spriteType,
      spriteStyle,
      matchBase.canonical,
      undefined,
      matchBase.canonical,
    );
    setSelected({
      id: matchBase.id,
      canonical: matchBase.canonical,
      name: getPkmnName(matchBase, pokemon.language),
      sprite,
      spriteId: matchBase.id,
      baseCanonical: matchBase.canonical,
      genderRate: matchBase.gender_rate,
    });
    setQuery(getPkmnName(matchBase, pokemon.language));
    setPendingForms(buildFormStrip(matchBase, selectedGame, games, pokemon.language));
    return;
  }
  for (const p of data) {
    const form = p.forms?.find((f) => f.canonical === pokemon.canonical_name);
    if (form) {
      const sprite = getSpriteUrl(
        form.sprite_id.toString(),
        selectedGame,
        spriteType,
        spriteStyle,
        form.canonical,
        form.sprite_slug,
        p.canonical,
        form.gender,
      );
      setSelected({
        id: p.id,
        canonical: form.canonical,
        name: getPkmnName(form, pokemon.language),
        sprite,
        spriteId: form.sprite_id,
        baseCanonical: p.canonical,
        spriteSlug: form.sprite_slug,
        formName:
          (form as any).form_names?.[pokemon.language] ||
          (form as any).form_names?.["en"] ||
          undefined,
        baseName: p.names?.[pokemon.language] || p.names?.["en"] || undefined,
        genderRate: p.gender_rate,
      });
      // The search field always shows the base species name, not the form name.
      setQuery(p.names?.[pokemon.language] || p.names?.["en"] || p.canonical);
      setPendingForms(buildFormStrip(p, selectedGame, games, pokemon.language));
      return;
    }
  }
}
