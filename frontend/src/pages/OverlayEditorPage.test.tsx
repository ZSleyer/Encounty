import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, makeAppState } from "../test-utils";
import { OverlayEditorPage } from "./OverlayEditorPage";
import { useCounterStore } from "../hooks/useCounterState";

vi.stubGlobal(
  "fetch",
  vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}),
    }),
  ),
);

vi.mock("../utils/overlay", () => ({
  resolveOverlay: (_p: unknown, _all: unknown, settings: unknown) => settings,
  wouldCreateCircularLink: () => false,
}));

describe("OverlayEditorPage", () => {
  beforeEach(() => {
    useCounterStore.setState({
      appState: makeAppState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
  });

  it("renders without crashing when state is available", () => {
    render(<OverlayEditorPage />);
    // Should show some content
    const { container } = render(<OverlayEditorPage />);
    expect(container).toBeTruthy();
  });

  it("shows loading spinner when no app state", () => {
    useCounterStore.setState({ appState: null });
    const { container } = render(<OverlayEditorPage />);
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });
});
