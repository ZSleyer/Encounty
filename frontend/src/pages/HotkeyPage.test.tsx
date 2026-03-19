import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, makeAppState } from "../test-utils";
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

  it("renders the hotkey settings when state is available", () => {
    render(<HotkeyPage />);
    // Should render hotkey action labels
    expect(screen.getByText("+1 Encounter")).toBeInTheDocument();
  });

  it("shows loading state when no app state", () => {
    useCounterStore.setState({ appState: null });
    render(<HotkeyPage />);
    expect(screen.getByText("Lade\u2026")).toBeInTheDocument();
  });
});
