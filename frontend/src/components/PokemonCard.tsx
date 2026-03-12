import { useState } from "react";
import { Plus, Minus, RotateCcw, Star, Edit2, Gamepad2 } from "lucide-react";
import { Pokemon } from "../types";
import { useCounterStore, DetectorStatusEntry } from "../hooks/useCounterState";
import { useI18n } from "../contexts/I18nContext";

interface Props {
  readonly pokemon: Pokemon;
  readonly onIncrement: (id: string) => void;
  readonly onDecrement: (id: string) => void;
  readonly onReset: (id: string) => void;
  readonly onActivate: (id: string) => void;
  readonly onDelete: (id: string) => void;
  readonly onEdit: (pokemon: Pokemon) => void;
}

const SPRITE_FALLBACK = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='40' fill='%23333'/><text y='.9em' font-size='60' x='50%' text-anchor='middle' dominant-baseline='middle'>?</text></svg>`;

/** Returns Tailwind dot colour + pulse flag based on detector status. */
function detectorDotClass(entry: DetectorStatusEntry, t: (key: string) => string): { cls: string; pulse: boolean; title: string } {
  switch (entry.state) {
    case "match_active":
      return { cls: "bg-green-400", pulse: false, title: t("dash.tooltipDetectorMatch") };
    case "cooldown":
      return { cls: "bg-amber-400", pulse: false, title: t("dash.tooltipDetectorCooldown") };
    default:
      return { cls: "bg-accent-blue", pulse: true, title: t("dash.tooltipDetectorRunning") };
  }
}


export function PokemonCard({
  pokemon,
  onIncrement,
  onDecrement,
  onReset,
  onActivate,
  onDelete,
  onEdit,
}: Props) {
  const { t } = useI18n();
  const { lastEncounterPokemonId, detectorStatus } = useCounterStore();
  const isFlashing = lastEncounterPokemonId === pokemon.id;
  const [imgError, setImgError] = useState(false);
  const statusEntry = detectorStatus[pokemon.id];

  const spriteUrl =
    imgError || !pokemon.sprite_url ? SPRITE_FALLBACK : pokemon.sprite_url;

  // Helper to get a generic short name for the Game since we don't have the full games.json loaded here
  const formatGame = (game: string) => {
    if (!game) return "Global";
    return game
      .replace("pokemon-", "")
      .replace("letsgo", "L.G. ")
      .toUpperCase();
  };

  return (
    <div
      onClick={() => {
        if (!pokemon.is_active) onActivate(pokemon.id);
      }}
      className={`relative rounded-xl border transition-all duration-300 overflow-hidden flex flex-col ${
        pokemon.is_active
          ? "border-accent-blue/50 bg-linear-to-b from-bg-card to-accent-blue/5 shadow-[0_0_15px_rgba(59,130,246,0.15)] scale-[1.02]"

          : "border-border-subtle bg-bg-card hover:border-border-active/40 hover:shadow-lg cursor-pointer"
      } ${isFlashing ? "animate-flash" : ""}`}
    >
      {/* Active Top Bar Indicator */}
      {pokemon.is_active && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-accent-blue" />
      )}

      {/* Detector status indicator — only visible while a detector is active */}
      {statusEntry && (() => {
        const { cls, pulse, title } = detectorDotClass(statusEntry, t);
        return (
          <span
            className={`absolute top-2 left-2 w-2 h-2 2xl:w-2.5 2xl:h-2.5 rounded-full ${cls} ${pulse ? "animate-pulse" : ""}`}
            title={title}
          />
        );
      })()}

      {/* Header logic (edit, active star, delete) */}
      <div className="absolute top-2 right-2 flex gap-1">
        {pokemon.is_active && (
          <div
            className="bg-accent-blue rounded-md p-1.5 shadow-sm"
            title={t("dash.tooltipSetActive")}
          >
            <Star className="w-3.5 h-3.5 text-white fill-white" />
          </div>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit(pokemon);
          }}
          className="p-1.5 rounded-md bg-bg-secondary/80 hover:bg-accent-blue hover:text-white text-text-secondary backdrop-blur-sm transition-colors"
          title={t("dash.tooltipEdit")}
        >
          <Edit2 className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-5 2xl:p-6 flex-1 flex flex-col items-center">
        {/* Sprite */}
        <div className="w-24 h-24 2xl:w-32 2xl:h-32 mb-3 relative group">
          <div className="absolute inset-0 bg-blue-500/10 rounded-full blur-xl scale-75 group-hover:scale-110 transition-transform duration-500" />
          <img
            src={spriteUrl}
            alt={pokemon.name}
            className="w-full h-full object-contain pixelated relative z-10 drop-shadow-lg"
            style={
              pokemon.sprite_style && pokemon.sprite_style !== "classic"
                ? undefined
                : { imageRendering: "pixelated" as const }
            }
            onError={() => setImgError(true)}
          />
        </div>

        {/* Text */}
        <div className="text-center w-full mb-4">
          <h3 className="font-bold text-text-primary text-lg 2xl:text-xl truncate capitalize leading-tight mb-1">
            {pokemon.name}
          </h3>

          {/* Game Badges */}
          <div
            className="flex items-center gap-1 text-[10px] 2xl:text-xs font-medium px-2 py-0.5 rounded-full bg-bg-secondary border border-border-subtle text-text-secondary"
            title={t("dash.tooltipGameInfo")}
          >
            <Gamepad2 className="w-3 h-3" />
            {formatGame(pokemon.game)}
          </div>
        </div>

        {/* Counter */}
        <div
          className={`mt-auto text-center w-full bg-bg-secondary/30 rounded-xl py-3 border border-border-subtle/50 mb-4 transition-all duration-200 ${isFlashing ? "scale-110 bg-accent-blue/20 border-accent-blue/50" : ""}`}
        >
          <span className="text-4xl 2xl:text-5xl font-black text-text-primary tabular-nums tracking-tight">
            {pokemon.encounters}
          </span>
          <p className="text-[10px] 2xl:text-xs text-text-muted uppercase tracking-widest font-bold mt-0.5">
            Encounters
          </p>
        </div>

        {/* Primary Controls */}
        <div className="grid grid-cols-[1fr_2fr_1fr] gap-2 w-full">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDecrement(pokemon.id);
            }}
            className="flex items-center justify-center py-2.5 rounded-lg bg-bg-secondary hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
            title={t("dash.tooltipDecrement")}
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onIncrement(pokemon.id);
            }}
            className="flex flex-col items-center justify-center rounded-lg bg-accent-blue hover:bg-blue-500 text-white font-bold transition-all hover:scale-[1.02] active:scale-[0.98] shadow-sm"
            title={t("dash.tooltipIncrement")}
          >
            <Plus className="w-5 h-5 mb-0.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onReset(pokemon.id);
            }}
            className="flex items-center justify-center py-2.5 rounded-lg bg-bg-secondary hover:bg-bg-hover text-text-secondary hover:text-red-400 transition-colors"
            title={t("dash.tooltipReset")}
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>

        {/* Secondary controls (Delete) */}
        <div className="flex gap-2 w-full mt-3 pt-3 border-t border-border-subtle/50">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(pokemon.id);
            }}
            title={t("dash.tooltipDelete")}
            className="flex-1 py-1.5 rounded-md text-xs font-medium text-text-muted hover:text-red-400 border border-transparent hover:border-red-500/30 hover:bg-red-500/10 transition-all"
          >
            Löschen
          </button>
        </div>
      </div>
    </div>
  );
}
