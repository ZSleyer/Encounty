/**
 * Animation channel state of the overlay: one channel per animated element,
 * holding the CSS class that is playing, its direction and the trigger id that
 * makes React replay it.
 */
import { useState } from "react";

/** State for a single animation channel (counter, sprite, name, title). */
export interface AnimChannel {
  animClass: string;
  reverse: boolean;
  triggerId: number;
}

/** Setters for a single animation channel. */
export interface AnimChannelSetters {
  setAnimClass: (cls: string) => void;
  setReverse: (rev: boolean) => void;
  setTriggerId: (id: number) => void;
  setRenderMode?: (mode: string) => void;
}

/** All animation channels managed by the overlay. */
export interface AnimChannels {
  counter: AnimChannel;
  sprite: AnimChannel;
  name: AnimChannel;
  title: AnimChannel;
  odds: AnimChannel;
  phase: AnimChannel;
  total_counter: AnimChannel;
}

/** All animation channel setters. */
export interface AnimChannelSettersMap {
  counter: AnimChannelSetters;
  sprite: AnimChannelSetters;
  name: AnimChannelSetters;
  title: AnimChannelSetters;
  odds: AnimChannelSetters;
  phase: AnimChannelSetters;
  total_counter: AnimChannelSetters;
}

/** State and setters of one animation channel. */
export interface AnimChannelHandle {
  channel: AnimChannel;
  setters: AnimChannelSetters;
}

/**
 * useAnimChannel holds the state of a single animation channel. Bundling the
 * three pieces here keeps the channel list below readable now that the overlay
 * drives seven of them.
 */
export function useAnimChannel(): AnimChannelHandle {
  const [animClass, setAnimClass] = useState("");
  const [reverse, setReverse] = useState(false);
  const [triggerId, setTriggerId] = useState(0);
  return {
    channel: { animClass, reverse, triggerId },
    setters: { setAnimClass, setReverse, setTriggerId },
  };
}

/**
 * Triggers an animation on a single channel by looking up the CSS class
 * from the given animation map and updating the channel state.
 */
export function triggerAnimation(
  key: string,
  animMap: Record<string, string>,
  reverse: boolean,
  setters: AnimChannelSetters,
): void {
  const cls = animMap[key] ?? "";
  if (cls) {
    setters.setReverse(reverse);
    setters.setAnimClass(cls);
    setters.setTriggerId(Date.now());
  }
}

/**
 * useAnimationTriggers manages the overlay animation channels (counter, sprite,
 * name, title, odds, phase, total_counter) and returns their state plus
 * setters. total_timer has no channel: like timer it only runs an idle
 * animation.
 */
export function useAnimationTriggers(): {
  channels: AnimChannels;
  setters: AnimChannelSettersMap;
  counterRenderMode: string;
  setCounterRenderMode: (mode: string) => void;
} {
  const counter = useAnimChannel();
  const sprite = useAnimChannel();
  const name = useAnimChannel();
  const title = useAnimChannel();
  const odds = useAnimChannel();
  const phase = useAnimChannel();
  const totalCounter = useAnimChannel();
  const [counterRenderMode, setCounterRenderMode] = useState("");

  return {
    channels: {
      counter: counter.channel,
      sprite: sprite.channel,
      name: name.channel,
      title: title.channel,
      odds: odds.channel,
      phase: phase.channel,
      total_counter: totalCounter.channel,
    },
    setters: {
      counter: { ...counter.setters, setRenderMode: setCounterRenderMode },
      sprite: sprite.setters,
      name: name.setters,
      title: title.setters,
      odds: odds.setters,
      phase: phase.setters,
      total_counter: totalCounter.setters,
    },
    counterRenderMode,
    setCounterRenderMode,
  };
}
