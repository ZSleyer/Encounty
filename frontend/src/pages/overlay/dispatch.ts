/**
 * Animation dispatch of the overlay: translates a counter change or an editor
 * test trigger into the per-channel animation updates, and resolves which
 * settings the overlay renders from.
 */
import { OverlaySettings, Pokemon, LabeledTextElement } from "../../types";
import { resolveOverlay } from "../../utils/overlay";
import {
  triggerAnimation,
  type AnimChannelSetters,
  type AnimChannelSettersMap,
} from "./animChannels";
import { COUNTER_ANIMS, LABELED_TEXT_ANIMS, NAME_ANIMS, SPRITE_ANIMS } from "./animMaps";

/**
 * Dispatches trigger animation for a single overlay element (sprite, name, title).
 * Only fires when the trigger key is set to a valid animation.
 */
export function dispatchElementAnim(
  key: string | undefined,
  animMap: Record<string, string>,
  reverse: boolean,
  channelSetters: AnimChannelSetters,
): void {
  if (key && key !== "none") {
    triggerAnimation(key, animMap, reverse, channelSetters);
  }
}

/**
 * Dispatches the counter animation, with special handling for slot/flip-digit modes
 * which only toggle direction instead of playing a CSS animation.
 */
export function dispatchCounterAnim(
  counter: { trigger_enter: string; trigger_decrement: string },
  isIncrement: boolean,
  isDecrement: boolean,
  isReset: boolean,
  channelSetters: AnimChannelSetters,
): void {
  const enterKey = counter.trigger_enter;
  const hasExplicitDecrement = counter.trigger_decrement && counter.trigger_decrement !== "none";

  if (isReset) {
    channelSetters.setRenderMode?.("");
    triggerAnimation("rubber", COUNTER_ANIMS, false, channelSetters);
  } else if (isIncrement) {
    if (enterKey === "slot" || enterKey === "flip-digit") {
      channelSetters.setRenderMode?.(enterKey);
      channelSetters.setReverse(false);
    } else {
      channelSetters.setRenderMode?.("");
      triggerAnimation(enterKey, COUNTER_ANIMS, false, channelSetters);
    }
  } else if (isDecrement) {
    if (hasExplicitDecrement) {
      const dk = counter.trigger_decrement;
      if (dk === "slot" || dk === "flip-digit") {
        channelSetters.setRenderMode?.(dk);
        channelSetters.setReverse(true);
      } else {
        channelSetters.setRenderMode?.("");
        triggerAnimation(dk, COUNTER_ANIMS, true, channelSetters);
      }
    } else if (enterKey === "slot" || enterKey === "flip-digit") {
      channelSetters.setRenderMode?.(enterKey);
      channelSetters.setReverse(true);
    } else {
      channelSetters.setRenderMode?.("");
      triggerAnimation("shake", COUNTER_ANIMS, true, channelSetters);
    }
  }
}

/**
 * Dispatches the trigger animation of one labeled phasing text element.
 * Does nothing for elements an older overlay does not carry yet.
 */
export function dispatchLabeledTextAnim(
  element: LabeledTextElement | undefined,
  reverse: boolean,
  channelSetters: AnimChannelSetters,
): void {
  if (!element) return;
  const key = resolveTriggerKey(element.trigger_enter, element.trigger_decrement, reverse);
  dispatchElementAnim(key, LABELED_TEXT_ANIMS, reverse, channelSetters);
}

/**
 * Dispatches counter-change animations across all overlay channels
 * (counter, sprite, name, title).
 */
export function dispatchCounterAnimations(
  settings: OverlaySettings,
  isIncrement: boolean,
  isDecrement: boolean,
  isReset: boolean,
  allSetters: AnimChannelSettersMap,
): void {
  dispatchCounterAnim(settings.counter, isIncrement, isDecrement, isReset, allSetters.counter);

  const spriteKey =
    isDecrement && settings.sprite.trigger_decrement && settings.sprite.trigger_decrement !== "none"
      ? settings.sprite.trigger_decrement
      : settings.sprite.trigger_enter;
  dispatchElementAnim(spriteKey, SPRITE_ANIMS, isDecrement, allSetters.sprite);

  const nameKey =
    isDecrement && settings.name.trigger_decrement && settings.name.trigger_decrement !== "none"
      ? settings.name.trigger_decrement
      : settings.name.trigger_enter;
  dispatchElementAnim(nameKey, NAME_ANIMS, isDecrement, allSetters.name);

  if (settings.title) {
    const titleKey =
      isDecrement && settings.title.trigger_decrement && settings.title.trigger_decrement !== "none"
        ? settings.title.trigger_decrement
        : settings.title.trigger_enter;
    dispatchElementAnim(titleKey, NAME_ANIMS, isDecrement, allSetters.title);
  }

  if (settings.odds) {
    const oddsKey =
      isDecrement && settings.odds.trigger_decrement && settings.odds.trigger_decrement !== "none"
        ? settings.odds.trigger_decrement
        : settings.odds.trigger_enter;
    dispatchElementAnim(oddsKey, NAME_ANIMS, isDecrement, allSetters.odds);
  }

  dispatchLabeledTextAnim(settings.phase, isDecrement, allSetters.phase);
  dispatchLabeledTextAnim(settings.total_counter, isDecrement, allSetters.total_counter);
}

/** Resolves the effective overlay settings for the current Pokemon. */
export function resolveSettings(
  previewSettings: OverlaySettings | undefined,
  activePokemon: Pokemon | null,
  appState: { pokemon: Pokemon[]; settings: { overlay: OverlaySettings } } | null,
): OverlaySettings | null {
  if (previewSettings) return previewSettings;
  if (!activePokemon || !appState) return null;
  return resolveOverlay(activePokemon, appState.pokemon, appState.settings.overlay);
}

/**
 * Resolves which trigger key to use, preferring the decrement trigger on
 * reverse if one is configured, otherwise falling back to the enter trigger.
 */
export function resolveTriggerKey(
  enterKey: string,
  decrementKey: string | undefined,
  reverse: boolean,
): string {
  if (reverse && decrementKey && decrementKey !== "none") {
    return decrementKey;
  }
  return enterKey;
}

/** Dispatches a test-trigger animation from the overlay editor preview. */
export function dispatchTestTrigger(
  testTrigger: { element: string; reverse?: boolean; n: number },
  settings: OverlaySettings,
  allSetters: AnimChannelSettersMap,
): void {
  const rev = testTrigger.reverse ?? false;

  if (testTrigger.element === "counter") {
    const key = resolveTriggerKey(
      settings.counter.trigger_enter,
      settings.counter.trigger_decrement,
      rev,
    );
    if (key === "slot" || key === "flip-digit") {
      allSetters.counter.setRenderMode?.(key);
      allSetters.counter.setReverse(rev);
      allSetters.counter.setTriggerId(Date.now());
    } else {
      allSetters.counter.setRenderMode?.("");
      triggerAnimation(key, COUNTER_ANIMS, rev, allSetters.counter);
    }
  } else if (testTrigger.element === "sprite") {
    const key = resolveTriggerKey(
      settings.sprite.trigger_enter,
      settings.sprite.trigger_decrement,
      rev,
    );
    triggerAnimation(key, SPRITE_ANIMS, rev, allSetters.sprite);
  } else if (testTrigger.element === "name") {
    const key = resolveTriggerKey(
      settings.name.trigger_enter,
      settings.name.trigger_decrement,
      rev,
    );
    triggerAnimation(key, NAME_ANIMS, rev, allSetters.name);
  } else if (testTrigger.element === "title" && settings.title) {
    const key = resolveTriggerKey(
      settings.title.trigger_enter,
      settings.title.trigger_decrement,
      rev,
    );
    triggerAnimation(key, NAME_ANIMS, rev, allSetters.title);
  } else if (testTrigger.element === "odds" && settings.odds) {
    const key = resolveTriggerKey(
      settings.odds.trigger_enter,
      settings.odds.trigger_decrement,
      rev,
    );
    triggerAnimation(key, NAME_ANIMS, rev, allSetters.odds);
  } else if (testTrigger.element === "phase") {
    dispatchLabeledTextAnim(settings.phase, rev, allSetters.phase);
  } else if (testTrigger.element === "total_counter") {
    dispatchLabeledTextAnim(settings.total_counter, rev, allSetters.total_counter);
  }
}
