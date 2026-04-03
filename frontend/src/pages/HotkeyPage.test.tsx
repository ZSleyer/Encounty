import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, makeAppState, waitFor } from "../test-utils";
import { HotkeyPage } from "./HotkeyPage";
import { useCounterStore } from "../hooks/useCounterState";

vi.stubGlobal(
  "fetch",
  vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ available: true }),
    }),
  ),
);

describe("HotkeyPage", () => {
  beforeEach(() => {
    useCounterStore.setState({
      appState: makeAppState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
  });

  it("renders the hotkey settings when state is available", async () => {
    render(<HotkeyPage />);
    await waitFor(() => {
      // Should render hotkey action labels
      expect(screen.getByText("+1 Encounter")).toBeInTheDocument();
    });
  });

  it("shows loading spinner when no app state", () => {
    useCounterStore.setState({ appState: null });
    const { container } = render(<HotkeyPage />);
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });
});
