import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, makeAppState, waitFor, fireEvent } from "../test-utils";
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
      // Should render hotkey action labels (German default locale)
      expect(screen.getByText("+1 Encounter")).toBeInTheDocument();
    });
  });

  it("shows loading spinner when no app state", () => {
    useCounterStore.setState({ appState: null });
    const { container } = render(<HotkeyPage />);
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  describe("OBS Browser Source card", () => {
    it("renders with the expected heading", () => {
      render(<HotkeyPage />);
      const heading = screen.getByRole("heading", { level: 2, name: "OBS Browser Source" });
      expect(heading).toBeInTheDocument();
    });

    it("shows the universal overlay URL in a read-only input", () => {
      render(<HotkeyPage />);
      const input = screen.getByLabelText("Universelle Overlay-URL") as HTMLInputElement;
      expect(input).toBeInTheDocument();
      expect(input.readOnly).toBe(true);
      expect(input.value).toBe(`${globalThis.location.origin}/overlay`);
    });

    it("copies the universal URL to the clipboard when the copy button is clicked", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });

      render(<HotkeyPage />);
      const button = screen.getByRole("button", { name: "Universelle URL kopieren" });
      fireEvent.click(button);

      expect(writeText).toHaveBeenCalledWith(`${globalThis.location.origin}/overlay`);

      await waitFor(() => {
        expect(screen.getAllByText("URL kopiert!").length).toBeGreaterThan(0);
      });
    });

    it("shows the no-key hint when next_pokemon is unbound", () => {
      useCounterStore.setState({
        appState: makeAppState({
          hotkeys: { increment: "", decrement: "", reset: "", next_pokemon: "" },
        }),
      });
      render(<HotkeyPage />);
      expect(
        screen.getByText(
          'Tipp: Weise dem "Nächstes Pokémon"-Hotkey oben eine Taste zu, um live zu wechseln.',
        ),
      ).toBeInTheDocument();
    });

    it("shows the interpolated hint when next_pokemon is bound", () => {
      useCounterStore.setState({
        appState: makeAppState({
          hotkeys: { increment: "", decrement: "", reset: "", next_pokemon: "Ctrl+N" },
        }),
      });
      render(<HotkeyPage />);
      expect(
        screen.getByText(
          'Tipp: Mit dem Hotkey "Ctrl+N" (Nächstes Pokémon) wechselst du live ohne OBS neu zu laden.',
        ),
      ).toBeInTheDocument();
    });
  });
});
