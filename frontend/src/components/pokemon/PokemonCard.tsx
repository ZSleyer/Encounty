import { useState } from "react";
import { Plus, Minus, RotateCcw, Edit2, Gamepad2, Video } from "lucide-react";
import { Pokemon } from "../../types";
import { useCounterStore, DetectorStatusEntry } from "../../hooks/useCounterState";
import { useI18n } from "../../contexts/I18nContext";
import { useCaptureService, useCaptureVersion } from "../../contexts/CaptureServiceContext";
import { SPRITE_FALLBACK } from "../../utils/sprites";
import { getOddsFractional } from "../../utils/odds";
import { DetectorPreview } from "../detector/DetectorPreview";
import { TrimmedBoxSprite } from "../shared/TrimmedBoxSprite";

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
      return { cls: "bg-accent-green", pulse: false, title: t("dash.tooltipDetectorMatch") };
    case "cooldown":
      return { cls: "bg-accent-purple", pulse: false, title: t("dash.tooltipDetectorCooldown") };
    default:
      return { cls: "bg-accent-blue", pulse: true, title: t("dash.tooltipDetectorRunning") };
  }
}


/**
 * Font size for the card counter that shrinks as the number grows so extreme
 * encounter counts never overflow the card.
 */
function cardCounterFontSize(value: number): string {
  const len = String(value).length;
  if (len > 9) return "clamp(18px, 2.4vw, 30px)";
  if (len > 6) return "clamp(24px, 3vw, 42px)";
  return "clamp(32px, 4vw, 56px)";
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
  // Narrow selectors keyed by this card's pokemon id: a bare useCounterStore()
  // re-renders every card on any store change; these re-render a card only when
  // its own flash membership or detector entry changes.
  const isFlashing = useCounterStore((s) => s.flashingIds.has(pokemon.id));
  const statusEntry = useCounterStore((s) => s.detectorStatus[pokemon.id]);
  const capture = useCaptureService();
  useCaptureVersion(); // re-render when capture streams change
  const [imgError, setImgError] = useState(false);
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
        {/* Status label: mirrors the single-hunt hero panel's status chip.
            Always mounted (visibility toggled, not presence) so every card
            in a row reserves the same height regardless of active state. */}
        <span
          className={`t-label t-label--accent w-fit ${pokemon.is_active ? "" : "invisible"}`}
          title={pokemon.is_active ? t("dash.tooltipSetActive") : undefined}
          aria-hidden={!pokemon.is_active}
        >
          {t("dash.hotkeyBadge")}
        </span>

        {/* Identity row: sprite next to name + game keeps the card short and
            lets the counter stay the hero. pr-8 clears the edit button. */}
        <div className="flex items-center gap-3 pr-8">
          <div className="w-14 h-14 2xl:w-16 2xl:h-16 shrink-0 grid place-items-center bg-bg-secondary border border-border-subtle group">
            {(!pokemon.sprite_style || pokemon.sprite_style === "box") ? (
              /* Box sprites sit off-center in a padded canvas; plain
                 object-contain shrinks the whole canvas instead of the
                 visible icon, leaving it tiny and misplaced. Trim the
                 transparent padding first so it fills the tile like every
                 other style. */
              <TrimmedBoxSprite
                canonicalName={pokemon.canonical_name}
                spriteType={pokemon.sprite_type}
                alt={pokemon.name}
                className="w-10 h-10 2xl:w-12 2xl:h-12 group-hover:scale-110 transition-transform duration-300"
                fallbackSrc={spriteUrl}
              />
            ) : (
              <img
                src={spriteUrl}
                alt={pokemon.name}
                className="w-10 h-10 2xl:w-12 2xl:h-12 object-contain group-hover:scale-110 transition-transform duration-300"
                onError={() => setImgError(true)}
              />
            )}
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

        {/* Counter — mirrors the single-hunt hero: raw number with the odds
            micro label below instead of a boxed stat. */}
        <div
          aria-live="polite"
          aria-atomic="true"
          className={`flex flex-col items-center gap-2 w-full py-2 2xl:py-3 transition-colors duration-200 ${isFlashing ? "bg-accent-blue/15" : ""}`}
        >
          <span
            className="font-black text-text-primary tabular-nums tracking-tight leading-none break-all min-w-0"
            style={{ fontSize: cardCounterFontSize(pokemon.encounters) }}
          >
            {pokemon.encounters}
          </span>
          <span className="t-label t-label--accent gap-1" title={t("aria.odds")}>
            {t("dash.odds")}
            <span className="tabular-nums">{getOddsFractional(pokemon)}</span>
          </span>
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

        {/* Footer label — always mounted (visibility toggled) so the row never
            resizes. Redundant with the preview box itself when there's no
            source (it already shows the same "no stream" placeholder). */}
        <div className="flex items-center min-h-[26px] mt-auto pt-2 border-t border-border-subtle">
          <span
            className={`flex items-center gap-1 pl-1 text-[11px] font-medium text-text-muted ${previewAvailable ? "" : "invisible"}`}
            aria-hidden={!previewAvailable}
          >
            <Video className="w-3.5 h-3.5" />
            {t("dash.preview")}
          </span>
        </div>

        {/* Preview — always rendered at a fixed aspect ratio so cards never
            resize when a source connects; DetectorPreview shows its own
            no-source placeholder (same as the Auto Erkennung tab) when idle.
            Only clickable through to auto-detection once a source AND a
            template are actually configured. */}
        <button
          type="button"
          onClick={() => previewAvailable && onOpenDetector?.(pokemon.id)}
          disabled={!previewAvailable}
          title={previewAvailable ? t("dash.openDetector") : undefined}
          aria-label={previewAvailable ? t("dash.openDetector") : t("dash.noPreview")}
          className="block w-full aspect-video overflow-hidden border border-border-subtle enabled:hover:border-accent-blue/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue disabled:cursor-default"
        >
          <DetectorPreview
            pokemon={pokemon}
            precision={pokemon.detector_config?.templates?.find((tmpl) => tmpl.enabled !== false)?.precision}
            isRunning={!!statusEntry}
            confidence={confidence}
          />
        </button>
      </div>
    </div>
  );
}
