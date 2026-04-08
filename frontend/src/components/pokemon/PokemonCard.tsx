import { useState } from "react";
import { Plus, Minus, RotateCcw, Star, Edit2, Gamepad2, Zap } from "lucide-react";
import { Pokemon } from "../../types";
import { useCounterStore, DetectorStatusEntry } from "../../hooks/useCounterState";
import { useI18n } from "../../contexts/I18nContext";
import { SPRITE_FALLBACK } from "../../utils/sprites";

type Props = Readonly<{
  pokemon: Pokemon;
  onIncrement: (id: string) => void;
  onDecrement: (id: string) => void;
  onReset: (id: string) => void;
  onActivate: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (pokemon: Pokemon) => void;
}>;


/** Returns Tailwind dot colour + pulse flag based on detector status. */
function detectorDotClass(entry: DetectorStatusEntry, t: (key: string) => string): { cls: string; pulse: boolean; title: string } {
  switch (entry.state) {
    case "match":
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
}: Readonly<Props>) {
  const { t } = useI18n();
  const { lastEncounterPokemonId, detectorStatus } = useCounterStore();
  const isFlashing = lastEncounterPokemonId === pokemon.id;
  const [imgError, setImgError] = useState(false);
  const statusEntry = detectorStatus[pokemon.id];

  const spriteUrl =
    (imgError || !pokemon.sprite_url) ? SPRITE_FALLBACK : pokemon.sprite_url;

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
      className={`relative rounded-xl border transition-all duration-300 overflow-hidden flex flex-col text-left w-full p-0 ${
        pokemon.is_active
          ? "border-accent-blue/50 bg-linear-to-b from-bg-card to-accent-blue/5 shadow-[0_0_15px_rgba(59,130,246,0.15)] scale-[1.02]"
          : "border-border-subtle bg-bg-card hover:border-border-active/40 hover:shadow-lg"
      } ${isFlashing ? "animate-flash" : ""}`}
    >
      {/* Active Top Bar Indicator */}
      {pokemon.is_active && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-accent-blue" />
      )}

      {/* Detector status indicator — only visible while a detector is active */}
      {statusEntry ? (() => {
        const { cls, pulse, title } = detectorDotClass(statusEntry, t);
        return (
          <span
            className={`absolute top-2 left-2 w-2 h-2 2xl:w-2.5 2xl:h-2.5 rounded-full ${cls} ${pulse ? "animate-pulse" : ""}`}
            title={title}
            aria-hidden="true"
          />
        );
      })() : null}

      {/* Header logic (edit, active star, delete) */}
      <div className="absolute top-2 right-2 flex gap-1">
        {pokemon.is_active && (
          <div
            className="bg-accent-blue rounded-md p-1.5 shadow-sm"
            title={t("dash.tooltipSetActive")}
            aria-hidden="true"
          >
            <Star className="w-3.5 h-3.5 text-white fill-white" />
          </div>
        )}
        <button
          onClick={() => onEdit(pokemon)}
          className="p-1.5 rounded-md bg-bg-secondary/80 hover:bg-accent-blue hover:text-white text-text-secondary backdrop-blur-sm transition-colors"
          title={t("dash.tooltipEdit")}
          aria-label={t("dash.tooltipEdit")}
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
              (pokemon.sprite_style && pokemon.sprite_style !== "classic" && pokemon.sprite_style !== "box")
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
            onClick={() => onDecrement(pokemon.id)}
            className="flex items-center justify-center py-2.5 rounded-lg bg-bg-secondary hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
            title={t("dash.tooltipDecrement")}
            aria-label={t("dash.tooltipDecrement")}
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            onClick={() => onIncrement(pokemon.id)}
            className="flex flex-col items-center justify-center rounded-lg bg-accent-blue hover:bg-accent-blue/80 text-white font-bold transition-all hover:scale-[1.02] active:scale-[0.98] shadow-sm"
            title={t("dash.tooltipIncrement")}
            aria-label={t("dash.tooltipIncrement")}
          >
            <Plus className="w-5 h-5 mb-0.5" />
          </button>
          <button
            onClick={() => onReset(pokemon.id)}
            className="flex items-center justify-center py-2.5 rounded-lg bg-bg-secondary hover:bg-bg-hover text-text-secondary hover:text-red-400 transition-colors"
            title={t("dash.tooltipReset")}
            aria-label={t("dash.tooltipReset")}
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>

        {/* Secondary controls */}
        <div className="flex gap-2 w-full mt-3 pt-3 border-t border-border-subtle/50">
          {!pokemon.is_active && (
            <button
              onClick={() => onActivate(pokemon.id)}
              title={t("dash.activate")}
              aria-label={t("dash.activate")}
              className="flex-1 py-1.5 rounded-md text-xs font-medium text-text-muted hover:text-accent-blue border border-transparent hover:border-accent-blue/30 hover:bg-accent-blue/10 transition-all flex items-center justify-center gap-1"
            >
              <Zap className="w-3 h-3" />
              {t("dash.activate")}
            </button>
          )}
          <button
            onClick={() => onDelete(pokemon.id)}
            title={t("dash.tooltipDelete")}
            aria-label={t("dash.tooltipDelete")}
            className="flex-1 py-1.5 rounded-md text-xs font-medium text-text-muted hover:text-red-400 border border-transparent hover:border-red-500/30 hover:bg-red-500/10 transition-all"
          >
            {t("dash.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}
