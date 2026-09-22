import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, settle, makeAppState, waitFor, fireEvent } from "../test-utils";
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
    // The capture service settles a microtask after this render.
    await settle();
    await waitFor(() => {
      // Should render the global hotkey rows (German default locale). The
      // per-hunt slots reuse the same action label, so match the button whose
      // name carries no entry name.
      expect(screen.getByRole("button", { name: "Aufzeichnen: +1 Encounter" })).toBeInTheDocument();
    });
  });

  it("shows loading spinner when no app state", async () => {
    useCounterStore.setState({ appState: null });
    const { container } = render(<HotkeyPage />);
    // The capture service settles a microtask after this render.
    await settle();
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  describe("per-hunt hotkey section", () => {
    it("renders below the global section with its own heading", async () => {
      render(<HotkeyPage />);
      // The capture service settles a microtask after this render.
      await settle();
      expect(
        screen.getByRole("heading", { level: 2, name: "Hotkeys pro Hunt" }),
      ).toBeInTheDocument();
    });

    it("lists the running hunts from the app state", async () => {
      render(<HotkeyPage />);
      // The capture service settles a microtask after this render.
      await settle();
      expect(
        screen.getByRole("button", { name: "Aufzeichnen: Bisasam, +1 Encounter" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Aufzeichnen: Glumanda, +1 Encounter" }),
      ).toBeInTheDocument();
    });
  });

  describe("OBS Browser Source card", () => {
    it("renders with the expected heading", async () => {
      render(<HotkeyPage />);
      // The capture service settles a microtask after this render.
      await settle();
      const heading = screen.getByRole("heading", { level: 2, name: "OBS Browser Source" });
      expect(heading).toBeInTheDocument();
    });

    it("shows the universal overlay URL in a read-only input", async () => {
      render(<HotkeyPage />);
      // The capture service settles a microtask after this render.
      await settle();
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

      // The capture service settles a microtask after this render.

      await settle();
      const button = screen.getByRole("button", { name: "Universelle URL kopieren" });
      fireEvent.click(button);

      expect(writeText).toHaveBeenCalledWith(`${globalThis.location.origin}/overlay`);

      await waitFor(() => {
        expect(screen.getAllByText("URL kopiert!").length).toBeGreaterThan(0);
      });
    });

    it("shows the no-key hint when next_pokemon is unbound", async () => {
      useCounterStore.setState({
        appState: makeAppState({
          hotkeys: { increment: "", decrement: "", reset: "", next_pokemon: "" },
        }),
      });
      render(<HotkeyPage />);
      // The capture service settles a microtask after this render.
      await settle();
      expect(
        screen.getByText(
          'Tipp: Weise dem "Nächstes Pokémon"-Hotkey oben eine Taste zu, um live zu wechseln.',
        ),
      ).toBeInTheDocument();
    });

    it("shows the interpolated hint when next_pokemon is bound", async () => {
      useCounterStore.setState({
        appState: makeAppState({
          hotkeys: { increment: "", decrement: "", reset: "", next_pokemon: "Ctrl+N" },
        }),
      });
      render(<HotkeyPage />);
      // The capture service settles a microtask after this render.
      await settle();
      expect(
        screen.getByText(
          'Tipp: Mit dem Hotkey "Ctrl+N" (Nächstes Pokémon) wechselst du live ohne OBS neu zu laden.',
        ),
      ).toBeInTheDocument();
    });
  });
});
