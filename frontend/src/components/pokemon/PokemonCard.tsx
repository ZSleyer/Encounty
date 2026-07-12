import { useState } from "react";
import { Plus, Minus, RotateCcw, Edit2, Gamepad2, Video, VideoOff, ChevronDown } from "lucide-react";
import { Pokemon } from "../../types";
import { useCounterStore, DetectorStatusEntry } from "../../hooks/useCounterState";
import { useI18n } from "../../contexts/I18nContext";
import { useCaptureService, useCaptureVersion } from "../../contexts/CaptureServiceContext";
import { SPRITE_FALLBACK } from "../../utils/sprites";
import { DetectorPreview } from "../detector/DetectorPreview";
import { DEFAULT_PRECISION } from "../../engine/detectorDefaults";

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
      className={`t-panel t-hatch relative flex flex-col text-left w-full p-0 ${isFlashing ? "animate-flash" : ""}`}
    >
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

      <button
        onClick={() => onEdit(pokemon)}
        className="absolute top-2 right-2 p-1.5 rounded-none text-text-faint hover:text-text-primary hover:bg-bg-hover transition-colors"
        title={t("dash.tooltipEdit")}
        aria-label={t("dash.tooltipEdit")}
      >
        <Edit2 className="w-3.5 h-3.5" />
      </button>

      <div className="p-4 2xl:p-5 flex-1 flex flex-col gap-3">
        {/* Status label: mirrors the single-hunt hero panel's status chip. */}
        {pokemon.is_active && (
          <span className="t-label t-label--accent w-fit" title={t("dash.tooltipSetActive")}>
            {t("dash.tabActive")}
          </span>
        )}

        {/* Identity row: sprite next to name + game keeps the card short and
            lets the counter stay the hero. pr-8 clears the edit button. */}
        <div className="flex items-center gap-3 pr-8">
          <div className="w-14 h-14 2xl:w-16 2xl:h-16 shrink-0 grid place-items-center bg-bg-secondary border border-border-subtle group">
            <img
              src={spriteUrl}
              alt={pokemon.name}
              className="w-10 h-10 2xl:w-12 2xl:h-12 object-contain pixelated group-hover:scale-110 transition-transform duration-300"
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
              className="inline-flex items-center gap-1 mt-1 text-[10px] 2xl:text-xs font-medium px-2 py-0.5 rounded-none bg-bg-secondary border border-border-subtle text-text-secondary"
              title={t("dash.tooltipGameInfo")}
            >
              <Gamepad2 className="w-3 h-3" />
              {formatGame(pokemon.game)}
            </div>
          </div>
        </div>

        {/* Counter — the hero; fluid size mirrors the single-hunt counter. */}
        <div
          aria-live="polite"
          aria-atomic="true"
          className={`text-center w-full bg-bg-secondary rounded-none py-4 2xl:py-5 border border-border-subtle transition-colors duration-200 ${isFlashing ? "bg-accent-blue/20 border-accent-blue/50" : ""}`}
        >
          <span className="text-[clamp(32px,4vw,56px)] font-black text-text-primary tabular-nums tracking-tight leading-none">
            {pokemon.encounters}
          </span>
          <p className="text-[10px] 2xl:text-xs text-text-muted uppercase tracking-widest font-bold mt-0.5">
            {t("dash.encounters")}
          </p>
        </div>

        {/* Primary Controls: same secondary / primary-cut / ghost hierarchy as the hero. */}
        <div className="grid grid-cols-[1fr_2fr_1fr] gap-2 w-full">
          <button
            onClick={() => onDecrement(pokemon.id)}
            className="flex items-center justify-center py-2.5 rounded-none bg-bg-card border border-border-subtle text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors"
            title={t("dash.tooltipDecrement")}
            aria-label={t("dash.tooltipDecrement")}
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            onClick={() => onIncrement(pokemon.id)}
            className="t-cut flex flex-col items-center justify-center py-2.5 rounded-none bg-accent-blue hover:bg-accent-blue/90 text-bg-primary font-bold transition-colors"
            title={t("dash.tooltipIncrement")}
            aria-label={t("dash.tooltipIncrement")}
          >
            <Plus className="w-5 h-5 stroke-[2.5px]" />
          </button>
          <button
            onClick={() => onReset(pokemon.id)}
            className="flex items-center justify-center py-2.5 rounded-none text-text-muted hover:bg-bg-hover hover:text-accent-red transition-colors"
            title={t("dash.tooltipReset")}
            aria-label={t("dash.tooltipReset")}
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>

        {/* Footer — always present so every card reserves the same space: the
            live-preview toggle when a source streams, otherwise a muted note. */}
        <div className="flex items-center min-h-[30px] mt-auto pt-2 border-t border-border-subtle">
          {previewAvailable ? (
            <button
              onClick={() => setShowPreview((v) => !v)}
              aria-expanded={showPreview}
              title={t("dash.preview")}
              className="flex items-center gap-1 py-1 pr-2 pl-1 rounded-none text-[11px] font-medium text-text-muted hover:text-accent-blue transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
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
              className="block w-full aspect-video rounded-none overflow-hidden border border-border-subtle hover:border-accent-blue/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
            >
              <DetectorPreview
                pokemon={pokemon}
                precision={pokemon.detector_config.templates.find((tmpl) => tmpl.enabled !== false)?.precision}
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
                {t("detector.precision")}: {((pokemon.detector_config.templates.find((tmpl) => tmpl.enabled !== false)?.precision ?? DEFAULT_PRECISION) * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
