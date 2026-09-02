/**
 * useWSMessageHandler.ts: Dispatcher for the application WebSocket stream.
 *
 * Owns every reaction to a backend broadcast: mirroring state into the counter
 * store, raising encounter toasts, and keeping the browser-side detection loop
 * in step with hunts that were started or finished elsewhere.
 */
import { useCallback } from "react";
import { useNavigate } from "react-router";
import { useCounterStore, DetectorStatusEntry } from "../hooks/useCounterState";
import { WSMessage, AppState } from "../types";
import { useI18n } from "../contexts/I18nContext";
import { useToast } from "../contexts/ToastContext";
import { useCaptureService } from "../contexts/CaptureServiceContext";
import { resolveSpriteSrc } from "../utils/sprites";
import { startDetectionForPokemon, stopDetectionForPokemon } from "../engine/startDetection";
import { recordEncounter } from "../utils/supportPrompt";

// Tracks which pokemon were already marked as completed in the last state_update.
// Used as a safety net so the detection loop is stopped even if the typed
// `pokemon_completed` event is missed (e.g. late join, dropped message).
const completedPokemonIds = new Set<string>();

/**
 * useWSMessageHandler returns the callback that AppShell hands to useWebSocket.
 *
 * It reads the same store slices and contexts the shell does, so the handler
 * chain always sees the state of the render it was created in.
 */
export function useWSMessageHandler(): (msg: WSMessage) => void {
  const navigate = useNavigate();
  const setAppState = useCounterStore((s) => s.setAppState);
  const setConnected = useCounterStore((s) => s.setConnected);
  const flashPokemon = useCounterStore((s) => s.flashPokemon);
  const appState = useCounterStore((s) => s.appState);
  const setDetectorStatus = useCounterStore((s) => s.setDetectorStatus);
  const clearDetectorStatus = useCounterStore((s) => s.clearDetectorStatus);
  const { t } = useI18n();
  const { push: pushToast } = useToast();
  const captureService = useCaptureService();

  const handleWSMessage = useCallback(
    (msg: WSMessage) => {
      if (msg.type === "state_update") {
        handleStateUpdate(msg.payload as AppState);
      } else if (msg.type === "encounter_added") {
        handleEncounterAdded(msg.payload as { pokemon_id: string; count: number });
      } else if (msg.type === "encounter_removed") {
        const rmPayload = msg.payload as { pokemon_id: string; count: number };
        const rmStep = appState?.pokemon.find((x) => x.id === rmPayload.pokemon_id)?.step;
        const rmEffective = rmStep && rmStep > 0 ? rmStep : 1;
        handleEncounterToast(rmPayload, `-${rmEffective}`);
      } else if (msg.type === "encounter_reset") {
        handlePokemonToast(
          (msg.payload as { pokemon_id: string }).pokemon_id,
          "0",
          t("app.counterReset") || "Zähler zurückgesetzt",
        );
      } else if (msg.type === "pokemon_completed") {
        const completedId = (msg.payload as { pokemon_id: string }).pokemon_id;
        // Stop the in-browser detection loop so a late match cannot re-increment
        // the counter after the hunt was marked as caught. Also clear the cached
        // detector status so the sidebar indicators reset immediately and a later
        // uncomplete starts from a clean slate.
        stopDetectionForPokemon(completedId);
        clearDetectorStatus(completedId);
        completedPokemonIds.add(completedId);
        handlePokemonToast(
          completedId,
          "✔",
          t("app.pokemonCompleted") || "Hunt erfolgreich abgeschlossen!",
        );
      } else if (msg.type === "hunt_start_requested") {
        handleHuntStartRequested(msg.payload as { pokemon_id: string; hunt_mode?: string });
      } else if (msg.type === "hunt_start_rejected") {
        const reason = (msg.payload as { reason?: string }).reason;
        pushToast({
          type: "error",
          title:
            reason === "no_templates" ? t("detector.errNoTemplates") : t("detector.errNoSource"),
          key: reason === "no_templates" ? "detector-templates" : "capture-source",
        });
      } else if (msg.type === "hunt_stop_requested") {
        const stopId = (msg.payload as { pokemon_id: string }).pokemon_id;
        // Mirror the sidebar stop button: always stop the browser-side detector.
        // Timer-only hunts simply have no active loop and stopLoop() no-ops.
        stopDetectionForPokemon(stopId);
      } else if (msg.type === "pokemon_deleted") {
        handlePokemonToast(
          (msg.payload as { pokemon_id: string }).pokemon_id,
          "🗑",
          t("app.pokemonDeleted") || "Pokémon entfernt",
        );
      } else if (msg.type === "detector_status") {
        const p = msg.payload as {
          pokemon_id: string;
          state: string;
          confidence: number;
          poll_ms: number;
        };
        setDetectorStatus(p.pokemon_id, {
          state: p.state,
          confidence: p.confidence,
          poll_ms: p.poll_ms,
        } as DetectorStatusEntry);
      } else if (
        msg.type === "request_reset_confirm" ||
        msg.type === "request_group_reset_confirm"
      ) {
        // Navigate to dashboard so the reset confirmation modal can be shown.
        // Without this, the modal is invisible on non-dashboard pages and the
        // app appears frozen because the modal blocks interaction.
        globalThis.electronAPI?.focusWindow();
        navigate("/");
      }
      // detector_match: counter already incremented by backend; encounter_added fires separately
    },
    [
      appState,
      t,
      setAppState,
      setConnected,
      flashPokemon,
      pushToast,
      clearDetectorStatus,
      setDetectorStatus,
      navigate,
      captureService,
    ],
  );

  /**
   * Handle the `hunt_start_requested` event triggered by the global hotkey.
   *
   * The backend has already started the timer (if the mode includes timer) and
   * re-broadcast state. This handler only deals with the detector half of the
   * hunt: if the hunt_mode includes detection AND an active capture stream
   * already exists for the pokemon, start the browser-side detection loop.
   *
   * Design note: we intentionally do NOT auto-acquire a capture source from
   * the hotkey, even though a persisted source is available via
   * getLastSource(). Silent source acquisition would trigger surprising
   * fullscreen permission dialogs or pick a stale display on machines where
   * the user has reshuffled monitors. The user is expected to have connected
   * a source via the Dashboard before using the hotkey.
   */
  function handleHuntStartRequested(payload: { pokemon_id: string; hunt_mode?: string }) {
    const pokemonId = payload.pokemon_id;
    const mode = payload.hunt_mode && payload.hunt_mode.length > 0 ? payload.hunt_mode : "both";

    const pokemon = appState?.pokemon.find((p) => p.id === pokemonId);
    if (!pokemon) return;

    const templates = pokemon.detector_config?.templates ?? [];
    // Backend has already gated missing templates / missing source and
    // emitted hunt_start_rejected before reaching here, so we only need
    // to decide whether to spin up the browser-side detection loop.
    const effectiveMode: "timer" | "detector" | "both" =
      mode === "both" && !pokemon.detector_config
        ? "timer"
        : (mode as "timer" | "detector" | "both");

    if (effectiveMode === "timer") return;

    startDetectionForPokemon({
      pokemonId,
      templates,
      config: pokemon.detector_config!,
      getVideoElement: () => captureService.getVideoElement(pokemonId),
      onScore: (score, state, cooldownMs) =>
        setDetectorStatus(pokemonId, {
          state,
          confidence: score,
          poll_ms: 100,
          cooldown_remaining_ms: cooldownMs,
        } as DetectorStatusEntry),
    });
  }

  function handleStateUpdate(newState: AppState) {
    const prev = appState;
    setAppState(newState);
    setConnected(true);
    // Safety net: if a pokemon transitioned to completed but the typed
    // pokemon_completed event was missed, still stop its detection loop.
    // Uncomplete transitions remove the id so a future complete fires again.
    const nowCompleted = new Set<string>();
    for (const p of newState.pokemon ?? []) {
      if (p.completed_at) {
        nowCompleted.add(p.id);
        if (!completedPokemonIds.has(p.id)) {
          stopDetectionForPokemon(p.id);
          clearDetectorStatus(p.id);
        }
      }
    }
    for (const id of completedPokemonIds) {
      if (!nowCompleted.has(id)) completedPokemonIds.delete(id);
    }
    for (const id of nowCompleted) completedPokemonIds.add(id);

    // Only clear detector status when a pokemon's detector was explicitly
    // disabled (enabled toggled off), not on every state_update broadcast.
    // Clearing on every broadcast caused a brief "idle" flash during active
    // detection because the backend broadcasts state after each match.
    for (const p of newState.pokemon ?? []) {
      if (!p.detector_config?.enabled) {
        const wasPreviouslyEnabled = prev?.pokemon?.find((pp) => pp.id === p.id)?.detector_config
          ?.enabled;
        if (wasPreviouslyEnabled) {
          clearDetectorStatus(p.id);
        }
      }
    }
  }

  function handleEncounterAdded(p: { pokemon_id: string; count: number }) {
    // Count only genuine encounters (hotkey / detector) toward the support
    // nudge. Manual "set encounters" broadcasts `encounter_set`, which never
    // reaches this handler, so it is naturally excluded.
    recordEncounter();
    flashPokemon(p.pokemon_id);
    const step = appState?.pokemon.find((x) => x.id === p.pokemon_id)?.step;
    const effectiveStep = step && step > 0 ? step : 1;
    handleEncounterToast(p, `+${effectiveStep}`);
  }

  function handleEncounterToast(p: { pokemon_id: string; count: number }, badge?: string) {
    const pokemon = appState?.pokemon.find((x) => x.id === p.pokemon_id);
    if (!pokemon) return;
    pushToast({
      type: "encounter",
      badge,
      spriteUrl: pokemon.sprite_url ? resolveSpriteSrc(pokemon.sprite_url) : undefined,
      title: pokemon.name,
      message: `${p.count} ${t("settings.encounterToast")}`,
    });
  }

  function handlePokemonToast(pokemonId: string, badge: string, message: string) {
    const pokemon = appState?.pokemon.find((x) => x.id === pokemonId);
    if (!pokemon) return;
    pushToast({
      type: "encounter",
      badge,
      spriteUrl: pokemon.sprite_url ? resolveSpriteSrc(pokemon.sprite_url) : undefined,
      title: pokemon.name,
      message,
    });
  }

  return handleWSMessage;
}
