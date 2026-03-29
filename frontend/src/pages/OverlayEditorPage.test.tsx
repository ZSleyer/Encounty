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

  it("shows connecting text when no app state", () => {
    useCounterStore.setState({ appState: null });
    render(<OverlayEditorPage />);
    expect(screen.getByText("Verbinde…")).toBeInTheDocument();
  });

  it("renders save button in disabled state initially", () => {
    render(<OverlayEditorPage />);
    const saveBtn = screen.getByLabelText("Overlay speichern");
    expect(saveBtn).toBeDisabled();
  });

  it("renders the default layout title", () => {
    render(<OverlayEditorPage />);
    expect(screen.getByText("Standard-Layout")).toBeInTheDocument();
  });

  it("renders hotkeys paused badge", () => {
    render(<OverlayEditorPage />);
    expect(screen.getByText("Hotkeys pausiert")).toBeInTheDocument();
  });

  it("renders OBS hint text", () => {
    render(<OverlayEditorPage />);
    expect(screen.getByText(/OBS URL findest du/)).toBeInTheDocument();
  });

  it("pauses hotkeys on mount", () => {
    render(<OverlayEditorPage />);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/hotkeys/pause"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("renders main content area with correct id", () => {
    render(<OverlayEditorPage />);
    const main = document.getElementById("main-content");
    expect(main).toBeInTheDocument();
  });
});
