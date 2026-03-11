import { describe, it, expect } from "vitest";
import { resolveOverlay, wouldCreateCircularLink } from "./overlay";
import { makePokemon, makeOverlaySettings } from "../test-utils";
import type { OverlaySettings } from "../types";

const defaultOverlay = makeOverlaySettings();

describe("resolveOverlay", () => {
  it("returns default overlay when overlay_mode is 'default'", () => {
    const poke = makePokemon({ overlay_mode: "default" });
    const result = resolveOverlay(poke, [poke], defaultOverlay);
    expect(result).toBe(defaultOverlay);
  });

  it("returns pokemon's own overlay when overlay_mode is 'custom'", () => {
    const customOverlay = makeOverlaySettings({ canvas_width: 800 });
    const poke = makePokemon({
      overlay_mode: "custom",
      overlay: customOverlay,
    });
    const result = resolveOverlay(poke, [poke], defaultOverlay);
    expect(result).toBe(customOverlay);
    expect(result.canvas_width).toBe(800);
  });

  it("returns default when overlay_mode is 'custom' but overlay is undefined", () => {
    const poke = makePokemon({ overlay_mode: "custom", overlay: undefined });
    const result = resolveOverlay(poke, [poke], defaultOverlay);
    expect(result).toBe(defaultOverlay);
  });

  it("follows linked overlay to target pokemon", () => {
    const targetOverlay = makeOverlaySettings({ canvas_width: 600 });
    const target = makePokemon({
      id: "target",
      overlay_mode: "custom",
      overlay: targetOverlay,
    });
    const source = makePokemon({
      id: "source",
      overlay_mode: "linked:target",
    });
    const result = resolveOverlay(source, [source, target], defaultOverlay);
    expect(result).toBe(targetOverlay);
  });

  it("follows a chain of links", () => {
    const finalOverlay = makeOverlaySettings({ canvas_height: 999 });
    const c = makePokemon({ id: "c", overlay_mode: "custom", overlay: finalOverlay });
    const b = makePokemon({ id: "b", overlay_mode: "linked:c" });
    const a = makePokemon({ id: "a", overlay_mode: "linked:b" });
    const all = [a, b, c];
    const result = resolveOverlay(a, all, defaultOverlay);
    expect(result).toBe(finalOverlay);
  });

  it("returns default when linked target does not exist", () => {
    const poke = makePokemon({ id: "a", overlay_mode: "linked:nonexistent" });
    const result = resolveOverlay(poke, [poke], defaultOverlay);
    expect(result).toBe(defaultOverlay);
  });

  it("detects circular link and returns default overlay", () => {
    const a = makePokemon({ id: "a", overlay_mode: "linked:b" });
    const b = makePokemon({ id: "b", overlay_mode: "linked:a" });
    const result = resolveOverlay(a, [a, b], defaultOverlay);
    expect(result).toBe(defaultOverlay);
  });

  it("detects self-link and returns default overlay", () => {
    const poke = makePokemon({ id: "self", overlay_mode: "linked:self" });
    const result = resolveOverlay(poke, [poke], defaultOverlay);
    expect(result).toBe(defaultOverlay);
  });

  it("returns default for linked target that is itself default mode", () => {
    const target = makePokemon({ id: "target", overlay_mode: "default" });
    const source = makePokemon({ id: "source", overlay_mode: "linked:target" });
    const result = resolveOverlay(source, [source, target], defaultOverlay);
    expect(result).toBe(defaultOverlay);
  });
});

describe("wouldCreateCircularLink", () => {
  it("returns false for a simple non-circular link", () => {
    const a = makePokemon({ id: "a", overlay_mode: "default" });
    const b = makePokemon({ id: "b", overlay_mode: "default" });
    expect(wouldCreateCircularLink("a", "b", [a, b])).toBe(false);
  });

  it("returns true when linking to self", () => {
    const a = makePokemon({ id: "a", overlay_mode: "default" });
    expect(wouldCreateCircularLink("a", "a", [a])).toBe(true);
  });

  it("returns true for direct circular link (A→B→A)", () => {
    const a = makePokemon({ id: "a", overlay_mode: "default" });
    const b = makePokemon({ id: "b", overlay_mode: "linked:a" });
    // Linking a→b would create a→b→a
    expect(wouldCreateCircularLink("a", "b", [a, b])).toBe(true);
  });

  it("returns true for indirect circular link (A→B→C→A)", () => {
    const a = makePokemon({ id: "a", overlay_mode: "default" });
    const b = makePokemon({ id: "b", overlay_mode: "linked:c" });
    const c = makePokemon({ id: "c", overlay_mode: "linked:a" });
    // Linking a→b creates a→b→c→a
    expect(wouldCreateCircularLink("a", "b", [a, b, c])).toBe(true);
  });

  it("returns false when target chain does not link back", () => {
    const a = makePokemon({ id: "a", overlay_mode: "default" });
    const b = makePokemon({ id: "b", overlay_mode: "linked:c" });
    const c = makePokemon({ id: "c", overlay_mode: "custom" });
    expect(wouldCreateCircularLink("a", "b", [a, b, c])).toBe(false);
  });
});
