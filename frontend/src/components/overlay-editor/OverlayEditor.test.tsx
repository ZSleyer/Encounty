import { describe, it, expect, vi } from "vitest";
import { render, makeOverlaySettings, makePokemon } from "../../test-utils";
import { OverlayEditor } from "./OverlayEditor";

// Mock the overlay utils
vi.mock("../../utils/overlay", () => ({
  resolveOverlay: (_p: unknown, _all: unknown, settings: unknown) => settings,
  wouldCreateCircularLink: () => false,
}));

describe("OverlayEditor", () => {
  it("renders without crashing", () => {
    const { container } = render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );
    expect(container.firstChild).not.toBeNull();
  });
});
