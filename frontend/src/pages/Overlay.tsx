import { useRef, useEffect, useMemo } from "react";
import { useParams } from "react-router";
import { Pokemon, OverlaySettings } from "../types";
import { useCounterStore } from "../hooks/useCounterState";
import { useSecondTick } from "../hooks/useSecondTick";
import { textDecorationPadding } from "../utils/textStyle";
import { formatTimer, computeTimerMs } from "../utils/timer";
import { computeOddsDisplay } from "../utils/odds";
import { computePhaseStats, PhaseStats } from "../utils/phase";
import { pokemonDisplayName } from "../utils/pokemon";
import { useAnimationTriggers } from "./overlay/animChannels";
import { BG_ANIM_CLASS, SPRITE_IDLE, TEXT_IDLE } from "./overlay/animMaps";
import {
  buildSpriteCycleSources,
  CyclingSprite,
  DEFAULT_CYCLE_INTERVAL_MS,
  resolveSpriteTransition,
} from "./overlay/CyclingSprite";
import {
  dispatchCounterAnimations,
  dispatchTestTrigger,
  resolveSettings,
} from "./overlay/dispatch";
import { LabeledTextLayer } from "./overlay/LabeledTextLayer";
import {
  CounterAffix,
  FlipCounter,
  SlotCounter,
  StyledText,
  TextLabel,
} from "./overlay/StyledText";
import { buildHomebrewBgStyle, buildOverlayStyles } from "./overlay/styles";
import { useGoogleFont } from "./overlay/useGoogleFont";

interface Props {
  previewSettings?: OverlaySettings;
  previewPokemon?: Pokemon;
  /**
   * Snapshot the phase totals are derived from while previewing in the editor.
   * Live overlays read the same list from the counter store instead.
   */
  previewPokemonList?: Pokemon[];
  testTrigger?: { element: string; n: number; reverse?: boolean };
}

/**
 * Resolves the active Pokemon to display in the overlay, checking
 * preview, URL-targeted, and server-active sources in priority order.
 */
function resolveActivePokemon(
  previewPokemon: Pokemon | undefined,
  appState: { pokemon: Pokemon[]; active_id: string } | null,
  overlayPokemonId: string | null,
): Pokemon | null {
  if (previewPokemon) return previewPokemon;
  if (overlayPokemonId) {
    return appState?.pokemon.find((p) => p.id === overlayPokemonId) ?? null;
  }
  if (!appState) return null;
  return appState.pokemon.find((p) => p.id === appState.active_id) ?? null;
}

/** Renders a placeholder when no active Pokemon is available in the overlay. */
function renderNoDataFallback(isPreview: boolean): React.JSX.Element {
  if (isPreview) {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            color: "rgba(255,255,255,0.3)",
            fontSize: 11,
            fontFamily: "sans-serif",
            letterSpacing: "0.2em",
          }}
        >
          Kein aktives Pokémon
        </span>
      </div>
    );
  }
  return (
    <div className="overlay-page min-h-screen flex items-center justify-center bg-transparent overflow-hidden relative">
      <div className="text-white/20 text-xs font-bold uppercase tracking-[0.3em] animate-pulse relative z-10">
        Warten auf Daten...
      </div>
    </div>
  );
}

/**
 * Total timer of a hunt across all of its phases, including the segment that is
 * running right now. computePhaseStats stays clock-free so callers can cache it,
 * which is why the live segment is added here on every render instead.
 */
function liveTotalTimerMs(pokemon: Pokemon, stats: PhaseStats): number {
  const childrenMs = stats.totalTimerMs - (pokemon.timer_accumulated_ms || 0);
  return childrenMs + computeTimerMs(pokemon);
}

export function Overlay({
  previewSettings,
  previewPokemon,
  previewPokemonList,
  testTrigger,
}: Readonly<Props>) {
  const appState = useCounterStore((s) => s.appState);
  const { channels, setters, counterRenderMode } = useAnimationTriggers();

  const prevCount = useRef<number | undefined>(undefined);

  // Path-based route param takes priority, query param as fallback
  const { pokemonId: routePokemonId } = useParams<{ pokemonId?: string }>();
  const searchParams = new URLSearchParams(globalThis.location.search);
  const overlayPokemonId = routePokemonId || searchParams.get("id");

  const activePokemon: Pokemon | null = useMemo(
    () => resolveActivePokemon(previewPokemon, appState, overlayPokemonId),
    [previewPokemon, appState, overlayPokemonId],
  );

  const settings: OverlaySettings | null = useMemo(
    () => resolveSettings(previewSettings, activePokemon, appState),
    [previewSettings, activePokemon, appState],
  );

  // Snapshot the phase totals are derived from: the editor preview passes its
  // own list, the live overlay already holds every phase entry in the store.
  const pokemonList: Pokemon[] = useMemo(
    () => previewPokemonList ?? appState?.pokemon ?? [],
    [previewPokemonList, appState],
  );

  const phaseStats = useMemo(
    () => computePhaseStats(activePokemon, pokemonList),
    [activePokemon, pokemonList],
  );

  const spriteCycleSources = useMemo(() => buildSpriteCycleSources(activePokemon), [activePokemon]);

  // Inject fonts
  useGoogleFont(settings?.name.style.font_family || "sans");
  useGoogleFont(settings?.counter.style.font_family || "sans");
  useGoogleFont(settings?.title?.style.font_family || "sans");
  useGoogleFont(settings?.timer?.style.font_family ?? "sans");
  useGoogleFont(settings?.timer?.label_style?.font_family ?? "sans");
  useGoogleFont(settings?.odds?.style.font_family ?? "sans");
  useGoogleFont(settings?.odds?.label_style?.font_family ?? "sans");
  useGoogleFont(settings?.phase?.style.font_family ?? "sans");
  useGoogleFont(settings?.phase?.label_style?.font_family ?? "sans");
  useGoogleFont(settings?.total_counter?.style.font_family ?? "sans");
  useGoogleFont(settings?.total_counter?.label_style?.font_family ?? "sans");
  useGoogleFont(settings?.total_timer?.style.font_family ?? "sans");
  useGoogleFont(settings?.total_timer?.label_style?.font_family ?? "sans");

  // Timer tick: force a re-render every second while the timer is running
  const isTimerRunning = !!activePokemon?.timer_started_at;
  useSecondTick(isTimerRunning);

  // Trigger animations on counter change
  useEffect(() => {
    if (!activePokemon || !settings) return;
    if (prevCount.current !== undefined && activePokemon.encounters !== prevCount.current) {
      const isReset = activePokemon.encounters === 0;
      const isIncrement = activePokemon.encounters > (prevCount.current ?? 0);
      dispatchCounterAnimations(settings, isIncrement, !isIncrement && !isReset, isReset, setters);
    }
    prevCount.current = activePokemon.encounters;
  }, [activePokemon?.encounters, settings]);

  // Test trigger from editor
  useEffect(() => {
    if (testTrigger && settings) {
      dispatchTestTrigger(testTrigger, settings, setters);
    }
    // eslint-disable-next-line react-hooks/exhaustive-docs
  }, [testTrigger?.n]);

  if (!activePokemon || !settings) {
    return renderNoDataFallback(!!previewSettings);
  }

  const {
    counterMode: defaultCounterMode,
    outerStyle,
    crispSprites,
    bgAnimKey,
    hasBgAnim,
    bgStyle,
    bgImageStyle,
  } = buildOverlayStyles(settings, !!previewSettings, appState?.settings.crisp_sprites ?? false);

  // Dynamic counter mode: override when a decrement animation uses a different rendering style
  const counterMode = counterRenderMode || defaultCounterMode;

  const canvas = (
    <div style={outerStyle}>
      {/* Card background — clipped to border-radius, does NOT clip content */}
      <div style={bgStyle}>
        {bgImageStyle && <div style={bgImageStyle} />}
        {hasBgAnim && (
          <div
            className={BG_ANIM_CLASS[bgAnimKey]}
            style={buildHomebrewBgStyle(
              bgAnimKey,
              settings.background_animation_speed,
              settings.background_animation_config ?? {},
            )}
          />
        )}
      </div>

      {/* Sprite — outer div holds idle, inner keyed div holds trigger */}
      {settings.sprite.visible && (
        <div
          style={{
            position: "absolute",
            left: settings.sprite.x,
            top: settings.sprite.y,
            width: settings.sprite.width,
            height: settings.sprite.height,
            zIndex: settings.sprite.z_index,
          }}
          className={SPRITE_IDLE[settings.sprite.idle_animation] ?? ""}
        >
          <div
            key={`sprite-${channels.sprite.triggerId}`}
            style={{
              position: "relative",
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transformOrigin: "center",
              animationDirection: channels.sprite.reverse ? "reverse" : undefined,
            }}
            className={channels.sprite.animClass}
          >
            {settings.sprite.show_glow && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: settings.sprite.glow_color,
                  opacity: settings.sprite.glow_opacity ?? 0.2,
                  borderRadius: "50%",
                  filter: `blur(${settings.sprite.glow_blur ?? 20}px)`,
                }}
              />
            )}
            <CyclingSprite
              sources={spriteCycleSources}
              enabled={settings.sprite.cycle_phase_targets ?? false}
              resetKey={activePokemon?.id ?? ""}
              crisp={crispSprites}
              intervalMs={settings.sprite.cycle_interval_ms ?? DEFAULT_CYCLE_INTERVAL_MS}
              transition={resolveSpriteTransition(settings.sprite.cycle_transition)}
            />
          </div>
        </div>
      )}

      {/* Name — outer div holds position + idle (stable, no key), inner span holds trigger (keyed) */}
      {settings.name.visible &&
        (() => {
          const alignToJustify: Record<string, string> = { center: "center", right: "flex-end" };
          const nameJustifyContent = alignToJustify[settings.name.style.text_align] ?? "flex-start";

          return (
            <div
              style={{
                position: "absolute",
                left: settings.name.x,
                top: settings.name.y,
                width: settings.name.width,
                height: settings.name.height,
                zIndex: settings.name.z_index,
                display: "flex",
                alignItems: "center",
                justifyContent: nameJustifyContent,
                // No padding for the stroke: the box does not clip, so the only
                // thing padding would do is indent the glyphs by an amount that
                // depends on the outline width, which makes the text jump the
                // moment someone changes the outline.
                overflow: "visible",
              }}
              className={TEXT_IDLE[settings.name.idle_animation] ?? ""}
            >
              <StyledText
                key={`name-${channels.name.triggerId}`}
                style={settings.name.style}
                className={`uppercase tracking-widest whitespace-nowrap ${channels.name.animClass}`}
                outerStyle={{
                  display: "inline-block",
                  transformOrigin: "center",
                  animationDirection: channels.name.reverse ? "reverse" : undefined,
                }}
              >
                {pokemonDisplayName(activePokemon)}
              </StyledText>
            </div>
          );
        })()}

      {/* Title — outer div holds position + idle (stable, no key), inner span holds trigger (keyed) */}
      {settings.title?.visible &&
        (activePokemon.title || !!previewSettings) &&
        (() => {
          const alignToJustify: Record<string, string> = { center: "center", right: "flex-end" };
          const titleJustifyContent =
            alignToJustify[settings.title.style.text_align] ?? "flex-start";

          return (
            <div
              style={{
                position: "absolute",
                left: settings.title.x,
                top: settings.title.y,
                width: settings.title.width,
                height: settings.title.height,
                zIndex: settings.title.z_index,
                display: "flex",
                alignItems: "center",
                justifyContent: titleJustifyContent,
                // See the name layer: padding here would only indent the glyphs
                // by an outline-dependent amount, and the box does not clip.
                overflow: "visible",
              }}
              className={TEXT_IDLE[settings.title.idle_animation] ?? ""}
            >
              <StyledText
                key={`title-${channels.title.triggerId}`}
                style={settings.title.style}
                className={`uppercase tracking-widest whitespace-nowrap ${channels.title.animClass}`}
                outerStyle={{
                  display: "inline-block",
                  transformOrigin: "center",
                  animationDirection: channels.title.reverse ? "reverse" : undefined,
                }}
              >
                {activePokemon.title || "Titel"}
              </StyledText>
            </div>
          );
        })()}

      {/* Counter — outer div holds position + idle (stable, no key), inner span holds trigger (keyed) */}
      {settings.counter.visible &&
        (() => {
          const counterAlignMap: Record<string, string> = { center: "center", right: "flex-end" };
          const counterAlignItems =
            counterAlignMap[settings.counter.style.text_align] ?? "flex-start";

          return (
            <div
              style={{
                position: "absolute",
                left: settings.counter.x,
                top: settings.counter.y,
                width: settings.counter.width,
                height: settings.counter.height,
                zIndex: settings.counter.z_index,
                display: "flex",
                flexDirection: "column",
                alignItems: counterAlignItems,
                justifyContent: "center",
              }}
              className={
                counterMode !== "slot" && counterMode !== "flip-digit"
                  ? (TEXT_IDLE[settings.counter.idle_animation] ?? "")
                  : ""
              }
            >
              {(() => {
                // The digit wrappers below clip their overflow, so they must hold
                // the room the stroke layer of every digit reserves for itself.
                const counterStrokePad = textDecorationPadding(settings.counter.style);
                const counterPrefix = settings.counter.prefix_text ?? "";
                const counterSuffix = settings.counter.suffix_text ?? "";

                if (counterMode === "slot") {
                  return (
                    // nowrap: affix and digits are one value, they must not be
                    // torn onto two lines when the element is narrow.
                    <span
                      key={`slot-${channels.counter.triggerId}`}
                      style={{ whiteSpace: "nowrap" }}
                    >
                      <CounterAffix text={counterPrefix} counterStyle={settings.counter.style} />
                      <SlotCounter
                        value={activePokemon.encounters}
                        counterStyle={settings.counter.style}
                        reverse={channels.counter.reverse}
                        strokePadding={counterStrokePad}
                      />
                      <CounterAffix text={counterSuffix} counterStyle={settings.counter.style} />
                    </span>
                  );
                }
                if (counterMode === "flip-digit") {
                  return (
                    <span
                      key={`flip-${channels.counter.triggerId}`}
                      style={{ whiteSpace: "nowrap" }}
                    >
                      <CounterAffix text={counterPrefix} counterStyle={settings.counter.style} />
                      <FlipCounter
                        value={activePokemon.encounters}
                        counterStyle={settings.counter.style}
                        reverse={channels.counter.reverse}
                        strokePadding={counterStrokePad}
                      />
                      <CounterAffix text={counterSuffix} counterStyle={settings.counter.style} />
                    </span>
                  );
                }
                return (
                  <StyledText
                    key={`counter-${channels.counter.triggerId}`}
                    style={settings.counter.style}
                    className={`font-black tabular-nums leading-none ${channels.counter.animClass}`}
                    outerStyle={{
                      display: "inline-block",
                      transformOrigin: "center",
                      animationDirection: channels.counter.reverse ? "reverse" : undefined,
                      whiteSpace: "pre",
                    }}
                  >
                    {counterPrefix + activePokemon.encounters + counterSuffix}
                  </StyledText>
                );
              })()}
              {settings.counter.show_label && (
                <TextLabel
                  style={settings.counter.label_style}
                  text={settings.counter.label_text}
                />
              )}
            </div>
          );
        })()}

      {/* Timer — live HH:MM:SS display with optional label */}
      {settings.timer?.visible &&
        (() => {
          const timerAlignMap: Record<string, string> = { center: "center", right: "flex-end" };
          const timerAlignItems = timerAlignMap[settings.timer.style.text_align] ?? "flex-start";
          const timerMs = activePokemon ? computeTimerMs(activePokemon) : 0;

          return (
            <div
              style={{
                position: "absolute",
                left: settings.timer.x,
                top: settings.timer.y,
                width: settings.timer.width,
                height: settings.timer.height,
                zIndex: settings.timer.z_index,
                display: "flex",
                flexDirection: "column",
                alignItems: timerAlignItems,
                justifyContent: "center",
              }}
              className={TEXT_IDLE[settings.timer.idle_animation] ?? ""}
            >
              <StyledText
                style={settings.timer.style}
                className="font-black tabular-nums leading-none"
                outerStyle={{
                  display: "inline-block",
                  whiteSpace: "pre",
                }}
              >
                {(settings.timer.prefix_text ?? "") +
                  formatTimer(timerMs) +
                  (settings.timer.suffix_text ?? "")}
              </StyledText>
              {settings.timer.show_label && (
                <TextLabel style={settings.timer.label_style} text={settings.timer.label_text} />
              )}
            </div>
          );
        })()}

      {/* Odds — shiny-probability display (fractional or cumulative percent) */}
      {settings.odds?.visible &&
        (() => {
          const oddsAlignMap: Record<string, string> = { center: "center", right: "flex-end" };
          const oddsAlignItems = oddsAlignMap[settings.odds.style.text_align] ?? "flex-start";
          // Every encounter of every phase was a roll at the target, so the
          // percentage counts them all, exactly like the statistics panel.
          const oddsText = computeOddsDisplay(
            activePokemon,
            settings.odds.format,
            phaseStats.totalEncounters,
          );

          return (
            <div
              style={{
                position: "absolute",
                left: settings.odds.x,
                top: settings.odds.y,
                width: settings.odds.width,
                height: settings.odds.height,
                zIndex: settings.odds.z_index,
                display: "flex",
                flexDirection: "column",
                alignItems: oddsAlignItems,
                justifyContent: "center",
              }}
              className={TEXT_IDLE[settings.odds.idle_animation] ?? ""}
            >
              <StyledText
                key={`odds-${channels.odds.triggerId}`}
                style={settings.odds.style}
                className={`font-black tabular-nums leading-none ${channels.odds.animClass}`}
                outerStyle={{
                  display: "inline-block",
                  transformOrigin: "center",
                  animationDirection: channels.odds.reverse ? "reverse" : undefined,
                  whiteSpace: "pre",
                }}
              >
                {(settings.odds.prefix_text ?? "") + oddsText + (settings.odds.suffix_text ?? "")}
              </StyledText>
              {settings.odds.show_label && (
                <TextLabel style={settings.odds.label_style} text={settings.odds.label_text} />
              )}
            </div>
          );
        })()}

      {/* Phase: number of the phase currently in progress */}
      {settings.phase?.visible && (
        <LabeledTextLayer
          element={settings.phase}
          channelKey="phase"
          channel={channels.phase}
          value={String(phaseStats.phaseNumber)}
        />
      )}

      {/* Total encounters: current phase plus all finished ones */}
      {settings.total_counter?.visible && (
        <LabeledTextLayer
          element={settings.total_counter}
          channelKey="total-counter"
          channel={channels.total_counter}
          value={String(phaseStats.totalEncounters)}
        />
      )}

      {/* Total timer: accumulated phase time plus the running segment */}
      {settings.total_timer?.visible && (
        <LabeledTextLayer
          element={settings.total_timer}
          channelKey="total-timer"
          value={formatTimer(liveTotalTimerMs(activePokemon, phaseStats))}
        />
      )}
    </div>
  );

  if (previewSettings) return canvas;

  return (
    <div className="overlay-page w-screen h-screen bg-transparent absolute top-0 left-0 overflow-hidden">
      <style>{`
        html, body, #root {
          width: 100vw !important;
          height: 100vh !important;
          margin: 0 !important;
          padding: 0 !important;
          overflow: hidden !important;
          background-color: transparent !important;
        }
      `}</style>
      {canvas}
    </div>
  );
}
