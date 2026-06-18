import { useState } from "react";
import { Plus, Minus, RotateCcw, Star, Edit2, Gamepad2, Video, VideoOff, ChevronDown } from "lucide-react";
import { Pokemon } from "../../types";
import { useCounterStore, DetectorStatusEntry } from "../../hooks/useCounterState";
import { useI18n } from "../../contexts/I18nContext";
import { useCaptureService, useCaptureVersion } from "../../contexts/CaptureServiceContext";
import { SPRITE_FALLBACK } from "../../utils/sprites";
import { DetectorPreview } from "../detector/DetectorPreview";

type Props = Readonly<{
  pokemon: Pokemon;
  onIncrement: (id: string) => void;
  onDecrement: (id: string) => void;
  onReset: (id: string) => void;
  onEdit: (pokemon: Pokemon) => void;
  /** Open this Pokémon's auto-detection tab (from the live preview). */
  onOpenDetector?: (id: string) => void;
}>;


/** Returns Tailwind dot colour + pulse flag based on detector status.
 *  Palette is kept in sync with DetectorPanel.stateDotClass and the
 *  TemplateEditor sparkline so the same state has the same colour everywhere. */
function detectorDotClass(entry: DetectorStatusEntry, t: (key: string) => string): { cls: string; pulse: boolean; title: string } {
  switch (entry.state) {
    case "match":
      return { cls: "bg-green-500", pulse: false, title: t("dash.tooltipDetectorMatch") };
    case "cooldown":
      return { cls: "bg-purple-500", pulse: false, title: t("dash.tooltipDetectorCooldown") };
    default:
      return { cls: "bg-blue-400", pulse: true, title: t("dash.tooltipDetectorRunning") };
  }
}


export function PokemonCard({
  pokemon,
  onIncrement,
  onDecrement,
  onReset,
  onEdit,
  onOpenDetector,
}: Readonly<Props>) {
  const { t } = useI18n();
  const { flashingIds, detectorStatus } = useCounterStore();
  const capture = useCaptureService();
  useCaptureVersion(); // re-render when capture streams change
  const isFlashing = flashingIds?.has(pokemon.id) ?? false;
  const [imgError, setImgError] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const statusEntry = detectorStatus[pokemon.id];
  // A live preview is offered whenever a detection source is actually streaming
  // for this Pokémon, independent of whether match templates are configured.
  const previewAvailable = capture.isCapturing(pokemon.id) && !!pokemon.detector_config;
  const confidence = statusEntry?.confidence;

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

      <div className="p-4 2xl:p-5 flex-1 flex flex-col gap-3">
        {/* Identity row: sprite next to name + game keeps the card short and
            lets the counter stay the hero. pr-14 clears the absolute action cluster. */}
        <div className="flex items-center gap-3 pr-14">
          <div className="w-14 h-14 2xl:w-16 2xl:h-16 shrink-0 grid place-items-center rounded-xl bg-bg-secondary/40 border border-border-subtle/50 group">
            <img
              src={spriteUrl}
              alt={pokemon.name}
              className="w-10 h-10 2xl:w-12 2xl:h-12 object-contain pixelated drop-shadow group-hover:scale-110 transition-transform duration-300"
              style={
                (pokemon.sprite_style && pokemon.sprite_style !== "classic" && pokemon.sprite_style !== "box")
                  ? undefined
                  : { imageRendering: "pixelated" as const }
              }
              onError={() => setImgError(true)}
            />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-text-primary text-base 2xl:text-lg truncate capitalize leading-tight">
              {pokemon.name}
            </h3>
            <div
              className="inline-flex items-center gap-1 mt-1 text-[10px] 2xl:text-xs font-medium px-2 py-0.5 rounded-full bg-bg-secondary border border-border-subtle text-text-secondary"
              title={t("dash.tooltipGameInfo")}
            >
              <Gamepad2 className="w-3 h-3" />
              {formatGame(pokemon.game)}
            </div>
          </div>
        </div>

        {/* Counter — the hero; scales up on roomier cards. */}
        <div
          className={`text-center w-full bg-bg-secondary/30 rounded-xl py-4 2xl:py-5 border border-border-subtle/50 transition-all duration-200 ${isFlashing ? "scale-105 bg-accent-blue/20 border-accent-blue/50" : ""}`}
        >
          <span className="text-4xl 2xl:text-6xl font-black text-text-primary tabular-nums tracking-tight">
            {pokemon.encounters}
          </span>
          <p className="text-[10px] 2xl:text-xs text-text-muted uppercase tracking-widest font-bold mt-0.5">
            {t("dash.encounters")}
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
            className="flex flex-col items-center justify-center py-2.5 rounded-lg bg-accent-blue hover:bg-accent-blue/80 text-white font-bold transition-all hover:scale-[1.02] active:scale-[0.98] shadow-sm"
            title={t("dash.tooltipIncrement")}
            aria-label={t("dash.tooltipIncrement")}
          >
            <Plus className="w-5 h-5" />
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

        {/* Footer — always present so every card reserves the same space: the
            live-preview toggle when a source streams, otherwise a muted note. */}
        <div className="flex items-center min-h-[30px] mt-auto pt-2 border-t border-border-subtle/50">
          {previewAvailable ? (
            <button
              onClick={() => setShowPreview((v) => !v)}
              aria-expanded={showPreview}
              title={t("dash.preview")}
              className="flex items-center gap-1 py-1 pr-2 pl-1 rounded-md text-[11px] font-medium text-text-muted hover:text-accent-blue transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
            >
              <Video className="w-3.5 h-3.5" />
              <span>{t("dash.preview")}</span>
              {confidence != null && confidence > 0.01 && (
                <span className="tabular-nums text-text-faint">{(confidence * 100).toFixed(0)}%</span>
              )}
              <ChevronDown className={`w-3 h-3 transition-transform ${showPreview ? "rotate-180" : ""}`} />
            </button>
          ) : (
            <span className="flex items-center gap-1 pl-1 text-[11px] text-text-faint">
              <VideoOff className="w-3.5 h-3.5" />
              {t("dash.noPreview")}
            </span>
          )}
        </div>

        {/* Collapsible live source preview — click to jump to auto-detection.
            Shows current match confidence (DetectorPreview badge) and threshold. */}
        {previewAvailable && showPreview && pokemon.detector_config && (
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => onOpenDetector?.(pokemon.id)}
              title={t("dash.openDetector")}
              aria-label={t("dash.openDetector")}
              className="block w-full aspect-video rounded-lg overflow-hidden border border-border-subtle/50 hover:border-accent-blue/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
            >
              <DetectorPreview
                pokemon={pokemon}
                cfg={pokemon.detector_config}
                isRunning={!!statusEntry}
                confidence={confidence}
              />
            </button>
            <div className="flex items-center justify-between text-[11px] tabular-nums text-text-muted">
              <span>
                {t("detector.confidence")}:{" "}
                <b className="text-text-secondary">{confidence != null ? `${(confidence * 100).toFixed(0)}%` : "–"}</b>
              </span>
              <span>
                {t("detector.precision")}: {((pokemon.detector_config.precision || 0.8) * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
