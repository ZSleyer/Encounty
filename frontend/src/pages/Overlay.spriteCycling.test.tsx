/**
 * Overlay page tests: cycling the sprite element through the phase targets,
 * including the per-slot fallback chain and the swap transitions.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  makeAppState,
  makeOverlaySettings,
  makePokemon,
} from "../test-utils";
import { Overlay } from "./Overlay";
import { useCounterStore } from "../hooks/useCounterState";
import { cachedSpriteSrc, getBoxSpriteUrl } from "../utils/sprites";

describe("Overlay", () => {
  beforeEach(() => {
    useCounterStore.setState({
      appState: makeAppState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
  });

  // --- Sprite cycling through the phase targets ---

  describe("Sprite cycling", () => {
    const huntSprite = "http://example.com/hunt.png";
    const targetSprite = "http://example.com/target.png";

    function makeCyclingPokemon() {
      return makePokemon({
        sprite_url: huntSprite,
        phase_targets: [
          { canonical_name: "zigzagoon", name: "Zigzachs", sprite_url: targetSprite },
        ],
      });
    }

    function cyclingSettings(enabled: boolean, transition?: string, intervalMs = 3000) {
      const base = makeOverlaySettings();
      return makeOverlaySettings({
        sprite: {
          ...base.sprite,
          visible: true,
          cycle_phase_targets: enabled,
          cycle_interval_ms: intervalMs,
          cycle_transition: transition,
        },
      });
    }

    /**
     * Renders a cycling overlay, advances past one swap and hands back both
     * slots in the order [incoming, outgoing].
     */
    function swapOnce(transition?: string, intervalMs = 3000) {
      vi.useFakeTimers();
      const { container } = render(
        <Overlay
          previewSettings={cyclingSettings(true, transition, intervalMs)}
          previewPokemon={makeCyclingPokemon()}
        />,
      );
      act(() => {
        vi.advanceTimersByTime(intervalMs);
      });
      const slots = [...container.querySelectorAll("img.pokemon-sprite")] as HTMLElement[];
      // Slot 0 starts in front, so after exactly one swap slot 1 is the
      // incoming one and slot 0 the outgoing one.
      return { incoming: slots[1], outgoing: slots[0] };
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it("falls back to the box sprite when the stored URL fails to load", () => {
      // A form whose stored URL was baked wrong (or whose host dropped the
      // file) used to leave the overlay blank, because it is the one surface
      // without an onError chain.
      const pokemon = makePokemon({
        sprite_url: "http://example.com/gone.gif",
        canonical_name: "zigzagoon-galar",
        sprite_type: "shiny",
      });
      const { container } = render(
        <Overlay previewSettings={cyclingSettings(false)} previewPokemon={pokemon} />,
      );
      const slot = container.querySelector("img.pokemon-sprite") as HTMLImageElement;
      expect(slot).toHaveAttribute("src", "http://example.com/gone.gif");

      act(() => {
        fireEvent.error(slot);
      });
      expect(slot.getAttribute("src")).toBe(cachedSpriteSrc(getBoxSpriteUrl("zigzagoon-galar")));

      // And the placeholder as the last resort, never an empty slot.
      act(() => {
        fireEvent.error(slot);
      });
      expect(slot.getAttribute("src")).toContain("data:image/svg+xml");
    });

    it("falls back per phase target, not for the whole cycle", () => {
      vi.useFakeTimers();
      const pokemon = makePokemon({
        sprite_url: huntSprite,
        canonical_name: "bulbasaur",
        // A normal-sprite hunt still phases on shinies, so the target's
        // fallback must not inherit the hunt's sprite type.
        sprite_type: "normal",
        phase_targets: [
          {
            canonical_name: "zigzagoon-galar",
            name: "Galar-Zigzachs",
            sprite_url: "http://example.com/gone.gif",
          },
        ],
      });
      const { container } = render(
        <Overlay previewSettings={cyclingSettings(true)} previewPokemon={pokemon} />,
      );
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      const incoming = [...container.querySelectorAll("img.pokemon-sprite")][1] as HTMLImageElement;
      act(() => {
        fireEvent.error(incoming);
      });
      expect(incoming.getAttribute("src")).toBe(
        cachedSpriteSrc(getBoxSpriteUrl("zigzagoon-galar")),
      );

      // Back at the hunt sprite the chain starts over: the target's failure
      // must not push the hunt's own sprite down a step.
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(container.querySelector("img.pokemon-sprite")).toHaveAttribute("src", huntSprite);
    });

    it("crossfades to the next sprite when the interval elapses", () => {
      vi.useFakeTimers();
      const { container } = render(
        <Overlay previewSettings={cyclingSettings(true)} previewPokemon={makeCyclingPokemon()} />,
      );
      const slots = [...container.querySelectorAll("img.pokemon-sprite")];
      const wrapper = slots[0]?.parentElement;
      // Two stacked slots so the outgoing sprite stays on screen while the
      // incoming one fades in. Only the hunt sprite is visible at rest.
      expect(slots).toHaveLength(2);
      expect(slots[0]).toHaveAttribute("src", huntSprite);
      expect(slots[0]).toHaveStyle({ opacity: "1" });
      expect(slots[1]).toHaveStyle({ opacity: "0" });

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      // Same DOM nodes, the slots only swap contents and opacity: feeding the
      // cycle index into the wrapper key would restart the trigger animation on
      // every tick, and remounting the image would blink instead of fade.
      const after = [...container.querySelectorAll("img.pokemon-sprite")];
      expect(after[0]).toBe(slots[0]);
      expect(after[1]).toBe(slots[1]);
      expect(after[0]?.parentElement).toBe(wrapper);
      expect(after[1]).toHaveAttribute("src", targetSprite);
      expect(after[1]).toHaveStyle({ opacity: "1" });
      expect(after[0]).toHaveStyle({ opacity: "0" });
    });

    it("fades no longer than half the cycle interval", () => {
      vi.useFakeTimers();
      const settings = cyclingSettings(true);
      const { container } = render(
        <Overlay
          previewSettings={makeOverlaySettings({
            ...settings,
            sprite: { ...settings.sprite, cycle_interval_ms: 300 },
          })}
          previewPokemon={makeCyclingPokemon()}
        />,
      );
      // A fast cycle must not leave both sprites at partial opacity for longer
      // than it shows either one on its own.
      const slot = container.querySelector("img.pokemon-sprite");
      expect(slot).toHaveStyle({ transition: "opacity 150ms ease-in-out" });
    });

    it("returns to the hunt sprite after a full cycle", () => {
      vi.useFakeTimers();
      const { container } = render(
        <Overlay previewSettings={cyclingSettings(true)} previewPokemon={makeCyclingPokemon()} />,
      );
      act(() => {
        vi.advanceTimersByTime(6000);
      });
      expect(container.querySelector("img.pokemon-sprite")).toHaveAttribute("src", huntSprite);
    });

    it("keeps the hunt sprite when cycling is disabled", () => {
      vi.useFakeTimers();
      const { container } = render(
        <Overlay previewSettings={cyclingSettings(false)} previewPokemon={makeCyclingPokemon()} />,
      );
      act(() => {
        vi.advanceTimersByTime(9000);
      });
      expect(container.querySelector("img.pokemon-sprite")).toHaveAttribute("src", huntSprite);
    });

    it("keeps the hunt sprite when the hunt has no phase targets", () => {
      vi.useFakeTimers();
      const pokemon = makePokemon({ sprite_url: huntSprite, phase_targets: [] });
      const { container } = render(
        <Overlay previewSettings={cyclingSettings(true)} previewPokemon={pokemon} />,
      );
      act(() => {
        vi.advanceTimersByTime(9000);
      });
      expect(container.querySelector("img.pokemon-sprite")).toHaveAttribute("src", huntSprite);
    });

    // --- Transitions ---

    it("swaps in one frame with the none transition", () => {
      const { incoming, outgoing } = swapOnce("none");
      expect(incoming).toHaveAttribute("src", targetSprite);
      expect(incoming.style.opacity).toBe("1");
      expect(incoming.style.transition).toBe("none");
      expect(incoming.style.animation).toBe("");
      expect(outgoing.style.opacity).toBe("0");
      expect(outgoing.style.transition).toBe("none");
    });

    it("crossfades with the fade transition", () => {
      const { incoming, outgoing } = swapOnce("fade");
      expect(incoming.style.opacity).toBe("1");
      expect(incoming.style.transition).toBe("opacity 400ms ease-in-out");
      expect(incoming.style.animation).toBe("");
      expect(outgoing.style.opacity).toBe("0");
      expect(outgoing.style.transition).toBe("opacity 400ms ease-in-out");
    });

    it("reveals the incoming sprite left to right with wipe-lr", () => {
      const { incoming, outgoing } = swapOnce("wipe-lr");
      // Opacity 1 throughout, so the clip path is a wipe and not a fade.
      expect(incoming.style.opacity).toBe("1");
      expect(incoming.style.animation).toBe("overlay-sprite-wipe-lr 400ms ease-in-out both");
      // The outgoing sprite stays visible underneath for the whole wipe and is
      // only cut away afterwards; sprites are transparent, so leaving it up
      // would show two of them at once.
      expect(outgoing.style.opacity).toBe("0");
      expect(outgoing.style.transition).toBe("opacity 0s linear 400ms");
      expect(outgoing.style.animation).toBe("");
    });

    it("reveals the incoming sprite right to left with wipe-rl", () => {
      const { incoming, outgoing } = swapOnce("wipe-rl");
      expect(incoming.style.opacity).toBe("1");
      expect(incoming.style.animation).toBe("overlay-sprite-wipe-rl 400ms ease-in-out both");
      expect(outgoing.style.opacity).toBe("0");
      expect(outgoing.style.transition).toBe("opacity 0s linear 400ms");
    });

    it("stacks the incoming slot above the outgoing one while wiping", () => {
      const { incoming, outgoing } = swapOnce("wipe-lr");
      // A wipe that ran behind the sprite it replaces would reveal nothing, so
      // the front slot has to paint above the other one either way round.
      expect(Number(incoming.style.zIndex)).toBeGreaterThan(Number(outgoing.style.zIndex));
    });

    it("does not wipe the first sprite in, there is nothing to wipe over", () => {
      vi.useFakeTimers();
      const { container } = render(
        <Overlay
          previewSettings={cyclingSettings(true, "wipe-lr")}
          previewPokemon={makeCyclingPokemon()}
        />,
      );
      const first = container.querySelector("img.pokemon-sprite") as HTMLElement;
      expect(first.style.animation).toBe("");
    });

    it("caps the wipe at half the cycle interval too", () => {
      const { incoming, outgoing } = swapOnce("wipe-lr", 300);
      expect(incoming.style.animation).toBe("overlay-sprite-wipe-lr 150ms ease-in-out both");
      expect(outgoing.style.transition).toBe("opacity 0s linear 150ms");
    });

    it("falls back to the crossfade for a stored value this build has no effect for", () => {
      // An overlay written by a newer version, or one saved before the setting
      // existed, must still cycle instead of rendering nothing.
      for (const stored of ["", "wipe-diagonal", undefined]) {
        const { incoming, outgoing } = swapOnce(stored);
        expect(incoming.style.transition).toBe("opacity 400ms ease-in-out");
        expect(incoming.style.opacity).toBe("1");
        expect(outgoing.style.opacity).toBe("0");
      }
    });
  });
});
