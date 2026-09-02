/**
 * Overlay page tests: the odds and timer elements, meaning their visibility,
 * formatting and labels.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, makeAppState, makeOverlaySettings, makePokemon } from "../test-utils";
import { Overlay } from "./Overlay";
import { useCounterStore } from "../hooks/useCounterState";
import { getOddsPercent } from "../utils/odds";

describe("Overlay", () => {
  beforeEach(() => {
    useCounterStore.setState({
      appState: makeAppState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
  });

  // --- Odds element rendering ---

  describe("Odds element", () => {
    it("hides odds when odds.visible is false", () => {
      const base = makeOverlaySettings();
      const settings = makeOverlaySettings({
        odds: { ...base.odds, visible: false },
      });
      const pokemon = makePokemon({ game: "pokemon-scarlet" });
      const { container } = render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
      expect(container.textContent).not.toContain("1/4096");
    });

    it("renders fractional odds when visible with format=fractional", () => {
      const base = makeOverlaySettings();
      const settings = makeOverlaySettings({
        odds: { ...base.odds, visible: true, format: "fractional" },
      });
      const pokemon = makePokemon({ game: "pokemon-scarlet", encounters: 100 });
      render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
      expect(screen.getByText("1/4096")).toBeInTheDocument();
    });

    it("renders cumulative percent when format=percent", () => {
      const base = makeOverlaySettings();
      const settings = makeOverlaySettings({
        odds: { ...base.odds, visible: true, format: "percent" },
      });
      // 4096 encounters ≈ 63.2% cumulative at 1/4096
      const pokemon = makePokemon({ game: "pokemon-scarlet", encounters: 4096 });
      render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
      expect(screen.getByText("63.2%")).toBeInTheDocument();
    });

    it("renders odds label when show_label is true", () => {
      const base = makeOverlaySettings();
      const settings = makeOverlaySettings({
        odds: {
          ...base.odds,
          visible: true,
          show_label: true,
          label_text: "Chance:",
          format: "fractional",
        },
      });
      const pokemon = makePokemon({ game: "pokemon-scarlet" });
      render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
      expect(screen.getByText("Chance:")).toBeInTheDocument();
    });

    it("bases the percent on the encounters of all phases, like the statistics panel", () => {
      // 839 in the running phase plus 2000 from a finished phase, the same
      // fixture the statistics panel test uses to assert 50.0% at 1/4096.
      const parent = makePokemon({
        id: "poke-1",
        is_active: true,
        game: "pokemon-scarlet",
        hunt_type: "encounter",
        shiny_charm: false,
        encounters: 839,
      });
      const child = makePokemon({
        id: "phase-1",
        is_active: false,
        game: "pokemon-scarlet",
        hunt_type: "encounter",
        shiny_charm: false,
        encounters: 2000,
        phase_of: "poke-1",
        phase_number: 1,
        completed_at: "2024-06-19T10:00:00Z",
      });
      useCounterStore.setState({
        appState: makeAppState({ pokemon: [parent, child], active_id: "poke-1" }),
      });
      const base = makeOverlaySettings();
      const settings = makeOverlaySettings({
        odds: { ...base.odds, visible: true, format: "percent" },
      });
      render(<Overlay previewSettings={settings} />);

      // Pinned to the shared helper the statistics panel calls, so the OBS
      // source can never drift away from the dashboard.
      expect(screen.getByText("50.0%")).toBeInTheDocument();
      expect(screen.getByText(getOddsPercent(parent, 2839))).toBeInTheDocument();
    });

    it("does not render odds label when show_label is false", () => {
      const base = makeOverlaySettings();
      const settings = makeOverlaySettings({
        odds: {
          ...base.odds,
          visible: true,
          show_label: false,
          label_text: "Chance:",
          format: "fractional",
        },
      });
      const pokemon = makePokemon({ game: "pokemon-scarlet" });
      render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
      expect(screen.queryByText("Chance:")).not.toBeInTheDocument();
    });
  });

  // --- Timer element rendering ---

  describe("Timer element", () => {
    it("hides timer when timer.visible is false", () => {
      const base = makeOverlaySettings();
      const settings = makeOverlaySettings({
        timer: { ...base.timer, visible: false },
      });
      const pokemon = makePokemon({ timer_accumulated_ms: 61000 });
      const { container } = render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
      expect(container.textContent).not.toContain("00:01:01");
    });

    it("renders the accumulated timer value when visible", () => {
      const base = makeOverlaySettings();
      const settings = makeOverlaySettings({
        timer: { ...base.timer, visible: true },
      });
      const pokemon = makePokemon({ timer_accumulated_ms: 3661000 });
      render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
      expect(screen.getByText("01:01:01")).toBeInTheDocument();
    });

    it("renders the timer label when show_label is true", () => {
      const base = makeOverlaySettings();
      const settings = makeOverlaySettings({
        timer: { ...base.timer, visible: true, show_label: true, label_text: "Elapsed:" },
      });
      const pokemon = makePokemon({ timer_accumulated_ms: 0 });
      render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
      expect(screen.getByText("Elapsed:")).toBeInTheDocument();
    });
  });
});
