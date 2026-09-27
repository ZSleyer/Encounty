import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, settle, makeAppState, waitFor, fireEvent, within } from "../test-utils";
import { HotkeyPage } from "./HotkeyPage";
import { useCounterStore } from "../hooks/useCounterState";

const mockSend = vi.fn();

vi.mock("../hooks/useWebSocket", () => ({
  useWebSocket: vi.fn(() => ({ send: mockSend })),
}));

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
    mockSend.mockReset();
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
      // Should render the global hotkey cells (German default locale). The
      // per-hunt cells name their hunt, so this one is the global cell.
      expect(
        screen.getByRole("button", { name: "+1 Encounter: Keine Taste zugewiesen" }),
      ).toBeInTheDocument();
    });
  });

  it("shows loading spinner when no app state", async () => {
    useCounterStore.setState({ appState: null });
    const { container } = render(<HotkeyPage />);
    // The capture service settles a microtask after this render.
    await settle();
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  describe("section headers", () => {
    it("marks the global section with the global badge and its meaning", async () => {
      render(<HotkeyPage />);
      await settle();
      const section = screen.getByRole("region", { name: "Globale Hotkeys" });
      const badge = within(section).getByText("Global", { selector: "span" });
      expect(badge).toHaveAttribute("title", "Global: wirkt auf das aktive Ziel");
      expect(badge.querySelector("svg.lucide-globe")).not.toBeNull();
      expect(section).toHaveTextContent(
        "Wirken auf das aktive Ziel und folgen ihm, wenn du es wechselst.",
      );
    });

    it("marks the per-hunt section with the pinned badge", async () => {
      render(<HotkeyPage />);
      await settle();
      const section = screen.getByRole("region", { name: "Hotkeys pro Hunt" });
      const badge = within(section).getByText("Fest", { selector: "span" });
      expect(badge.querySelector("svg.lucide-pin")).not.toBeNull();
    });
  });

  describe("global target switch", () => {
    it("shows the current target and lists hunts and groups", async () => {
      useCounterStore.setState({
        appState: makeAppState({
          groups: [
            { id: "grp-1", name: "Kanto", color: "#00ff00", sort_order: 0, collapsed: false },
          ],
        }),
      });
      render(<HotkeyPage />);
      await settle();

      const select = screen.getByLabelText("Globale Hotkeys wirken auf") as HTMLSelectElement;
      expect(select.value).toBe("pokemon:poke-1");
      const options = within(select)
        .getAllByRole("option")
        .map((o) => o.textContent);
      expect(options).toEqual(["Kein Ziel", "Bisasam · SCARLET", "Glumanda · VIOLET", "Kanto"]);
    });

    it("sends the same messages as the sidebar when the target changes", async () => {
      useCounterStore.setState({
        appState: makeAppState({
          groups: [
            { id: "grp-1", name: "Kanto", color: "#00ff00", sort_order: 0, collapsed: false },
          ],
        }),
      });
      render(<HotkeyPage />);
      await settle();
      const select = screen.getByLabelText("Globale Hotkeys wirken auf");

      fireEvent.change(select, { target: { value: "pokemon:poke-2" } });
      expect(mockSend).toHaveBeenLastCalledWith("set_active", { pokemon_id: "poke-2" });
      fireEvent.change(select, { target: { value: "group:grp-1" } });
      expect(mockSend).toHaveBeenLastCalledWith("set_active_group", { group_id: "grp-1" });
      fireEvent.change(select, { target: { value: "" } });
      expect(mockSend).toHaveBeenLastCalledWith("set_active_group", { group_id: "" });
    });

    it("names the Next Pokémon key as the keyboard way to switch", async () => {
      useCounterStore.setState({
        appState: makeAppState({
          hotkeys: { increment: "", decrement: "", reset: "", next_pokemon: "Ctrl+N" },
        }),
      });
      render(<HotkeyPage />);
      await settle();
      const hint = screen.getByText(/Ziel per Tastatur wechseln/);
      expect(hint).toHaveTextContent("Global Ctrl+N");
    });

    it("asks to bind Next Pokémon while it is unbound", async () => {
      render(<HotkeyPage />);
      await settle();
      expect(
        screen.getByText(/Belege unten „Nächstes Pokémon", um das Ziel per Tastatur zu wechseln/),
      ).toBeInTheDocument();
    });
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
        screen.getByRole("button", { name: "+1 Encounter für Bisasam: Keine Taste zugewiesen" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "+1 Encounter für Glumanda: Keine Taste zugewiesen" }),
      ).toBeInTheDocument();
    });

    it("explains once how to record and clear a key", async () => {
      render(<HotkeyPage />);
      // The capture service settles a microtask after this render.
      await settle();
      expect(screen.getAllByText(/Klicke auf ein Feld/)).toHaveLength(1);
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
