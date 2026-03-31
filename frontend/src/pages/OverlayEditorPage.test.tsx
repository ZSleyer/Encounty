import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, makeAppState, waitFor, userEvent } from "../test-utils";
import { OverlayEditorPage } from "./OverlayEditorPage";
import { useCounterStore } from "../hooks/useCounterState";

const fetchMock = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
  }),
);

vi.stubGlobal("fetch", fetchMock);

vi.mock("../components/overlay-editor/OverlayEditor", () => ({
  OverlayEditor: ({ onUpdate, settings }: { onUpdate: (s: unknown) => void; settings: unknown }) => (
    <div data-testid="overlay-editor">
      <button
        data-testid="trigger-change"
        onClick={() => onUpdate({ ...(settings as object), canvas_width: 800 })}
      >
        Change
      </button>
    </div>
  ),
}));

vi.mock("../utils/overlay", () => ({
  resolveOverlay: (_p: unknown, _all: unknown, settings: unknown) => settings,
  wouldCreateCircularLink: () => false,
}));

describe("OverlayEditorPage", () => {
  beforeEach(() => {
    fetchMock.mockClear();
    useCounterStore.setState({
      appState: makeAppState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders without crashing when state is available", () => {
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
    expect(screen.getByText("Verbinde\u2026")).toBeInTheDocument();
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
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/hotkeys/pause"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("resumes hotkeys on unmount", () => {
    const { unmount } = render(<OverlayEditorPage />);
    fetchMock.mockClear();
    unmount();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/hotkeys/resume"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("renders main content area with correct id", () => {
    render(<OverlayEditorPage />);
    const main = document.getElementById("main-content");
    expect(main).toBeInTheDocument();
  });

  it("enables save button after overlay change", async () => {
    const user = userEvent.setup();
    render(<OverlayEditorPage />);

    const saveBtn = screen.getByLabelText("Overlay speichern");
    expect(saveBtn).toBeDisabled();

    await user.click(screen.getByTestId("trigger-change"));

    expect(saveBtn).not.toBeDisabled();
  });

  it("saves overlay and shows saved indicator", async () => {
    const user = userEvent.setup();
    render(<OverlayEditorPage />);

    // Trigger a change to enable the save button
    await user.click(screen.getByTestId("trigger-change"));

    const saveBtn = screen.getByLabelText("Overlay speichern");
    expect(saveBtn).not.toBeDisabled();

    fetchMock.mockClear();
    await user.click(saveBtn);

    // Should have called PUT /api/settings
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/settings"),
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "application/json" },
      }),
    );

    // "Gespeichert" indicator should appear
    await waitFor(() => {
      expect(screen.getByText("Gespeichert")).toBeInTheDocument();
    });

    // Save button should be disabled again after saving
    expect(saveBtn).toBeDisabled();
  });

  it("disables save button while saving (overlaySaving state)", async () => {
    // Make fetch hang so we can check the button during save
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let resolveFetch: (v: any) => void;
    fetchMock.mockImplementationOnce(() =>
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const user = userEvent.setup();
    render(<OverlayEditorPage />);

    await user.click(screen.getByTestId("trigger-change"));

    const saveBtn = screen.getByLabelText("Overlay speichern");

    // Clear the mock after the hotkey pause call
    fetchMock.mockClear();
    fetchMock.mockImplementationOnce(() =>
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    await user.click(saveBtn);

    // During save, button should be disabled
    expect(saveBtn).toBeDisabled();

    // Resolve the fetch
    resolveFetch!({ ok: true, json: () => Promise.resolve({}) });

    await waitFor(() => {
      // After save completes, button should still be disabled (no longer dirty)
      expect(saveBtn).toBeDisabled();
    });
  });

  it("handles save error gracefully", async () => {
    const user = userEvent.setup();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<OverlayEditorPage />);

    await user.click(screen.getByTestId("trigger-change"));

    fetchMock.mockImplementationOnce(() => Promise.reject(new Error("Network error")));

    const saveBtn = screen.getByLabelText("Overlay speichern");
    await user.click(saveBtn);

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });

    consoleSpy.mockRestore();
  });

  it("renders the OverlayEditor component", () => {
    render(<OverlayEditorPage />);
    expect(screen.getByTestId("overlay-editor")).toBeInTheDocument();
  });

  it("save button text is visible", () => {
    render(<OverlayEditorPage />);
    expect(screen.getByText("Overlay speichern")).toBeInTheDocument();
  });
});
