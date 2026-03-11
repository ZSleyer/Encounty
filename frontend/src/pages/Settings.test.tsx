import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "../test-utils";
import { Settings } from "./Settings";
import { useCounterStore } from "../hooks/useCounterState";
import { makeAppState } from "../test-utils";

vi.stubGlobal(
  "fetch",
  vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}),
    }),
  ),
);

describe("Settings", () => {
  beforeEach(() => {
    useCounterStore.setState({
      appState: makeAppState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
  });

  it("renders without crashing when state is available", () => {
    render(<Settings />);
    // Should show settings sections once loaded
    const { container } = render(<Settings />);
    expect(container).toBeTruthy();
  });

  it("shows loading state when no app state", () => {
    useCounterStore.setState({ appState: null });
    render(<Settings />);
    expect(screen.getByText("Lade\u2026")).toBeInTheDocument();
  });
});
