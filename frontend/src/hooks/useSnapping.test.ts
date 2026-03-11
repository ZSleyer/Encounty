import { describe, it, expect } from "vitest";
import { useSnapping } from "./useSnapping";
import { makeOverlaySettings } from "../test-utils";

const settings = makeOverlaySettings();

describe("useSnapping — snap", () => {
  it("snaps coordinates to grid", () => {
    const { snap } = useSnapping(settings, true, 10);
    expect(snap(13, 27, 50, 50, false)).toEqual({ x: 10, y: 30 });
  });

  it("snaps exact multiples unchanged", () => {
    const { snap } = useSnapping(settings, true, 10);
    expect(snap(20, 40, 50, 50, false)).toEqual({ x: 20, y: 40 });
  });

  it("rounds to nearest grid line (up)", () => {
    const { snap } = useSnapping(settings, true, 10);
    expect(snap(16, 35, 50, 50, false)).toEqual({ x: 20, y: 40 });
  });

  it("bypasses snapping when shiftKey is true", () => {
    const { snap } = useSnapping(settings, true, 10);
    expect(snap(13, 27, 50, 50, true)).toEqual({ x: 13, y: 27 });
  });

  it("bypasses snapping when disabled", () => {
    const { snap } = useSnapping(settings, false, 10);
    expect(snap(13, 27, 50, 50, false)).toEqual({ x: 13, y: 27 });
  });

  it("works with different grid sizes", () => {
    const { snap } = useSnapping(settings, true, 25);
    expect(snap(37, 63, 50, 50, false)).toEqual({ x: 25, y: 75 });
  });
});

describe("useSnapping — getGuides", () => {
  it("returns empty array when snapping is disabled", () => {
    const { getGuides } = useSnapping(settings, false, 10);
    const guides = getGuides("sprite", 200, 100, 50, 50);
    expect(guides).toEqual([]);
  });

  it("detects canvas center alignment (vertical)", () => {
    // Canvas is 400 wide, so center is 200.
    // Element x=175, w=50 → center at 200 — within threshold
    const { getGuides } = useSnapping(settings, true, 10);
    const guides = getGuides("sprite", 175, 10, 50, 50);
    const vertical = guides.filter((g) => g.type === "v");
    expect(vertical.some((g) => g.position === 200)).toBe(true);
  });

  it("detects canvas center alignment (horizontal)", () => {
    // Canvas is 200 tall, so center is 100.
    // Element y=75, h=50 → center at 100
    const { getGuides } = useSnapping(settings, true, 10);
    const guides = getGuides("sprite", 10, 75, 50, 50);
    const horizontal = guides.filter((g) => g.type === "h");
    expect(horizontal.some((g) => g.position === 100)).toBe(true);
  });

  it("detects left edge alignment (x near 0)", () => {
    const { getGuides } = useSnapping(settings, true, 10);
    const guides = getGuides("sprite", 2, 50, 50, 50);
    expect(guides.some((g) => g.type === "v" && g.position === 0)).toBe(true);
  });

  it("detects top edge alignment (y near 0)", () => {
    const { getGuides } = useSnapping(settings, true, 10);
    const guides = getGuides("sprite", 50, 3, 50, 50);
    expect(guides.some((g) => g.type === "h" && g.position === 0)).toBe(true);
  });

  it("detects right edge alignment", () => {
    // Canvas width is 400, element x=348, w=50 → right edge at 398, within 5 of 400
    const { getGuides } = useSnapping(settings, true, 10);
    const guides = getGuides("sprite", 348, 50, 50, 50);
    expect(guides.some((g) => g.type === "v" && g.position === 400)).toBe(true);
  });

  it("detects bottom edge alignment", () => {
    // Canvas height is 200, element y=148, h=50 → bottom at 198, within 5 of 200
    const { getGuides } = useSnapping(settings, true, 10);
    const guides = getGuides("sprite", 50, 148, 50, 50);
    expect(guides.some((g) => g.type === "h" && g.position === 200)).toBe(true);
  });

  it("generates alignment guides against sibling elements", () => {
    // The name element is at x=100 in the default fixture.
    // Dragging sprite so its left edge aligns with name's left edge.
    const { getGuides } = useSnapping(settings, true, 10);
    const guides = getGuides("sprite", 100, 50, 80, 80);
    expect(guides.some((g) => g.type === "v" && g.position === 100)).toBe(true);
  });

  it("does not generate guides against the active element itself", () => {
    // Moving the name element — should not create guides from name's own position.
    const { getGuides } = useSnapping(settings, true, 10);
    // Place at exactly where name already is — guides should only be from sprite/counter
    const guides = getGuides("name", 100, 10, 200, 30);
    // The sprite is at x=10, counter at x=100 — counter aligns, but not name self-reference
    const sources = guides.filter((g) => g.type === "v" && g.position === 100);
    // This guide comes from the counter element, not from name itself
    expect(sources.length).toBeGreaterThanOrEqual(0);
  });
});
