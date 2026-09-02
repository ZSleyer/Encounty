/**
 * Overlay page tests: the phasing elements (phase, total_counter, total_timer)
 * and the totals they derive from the whole phase chain.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, makeAppState, makeOverlaySettings, makePokemon } from "../test-utils";
import { Overlay } from "./Overlay";
import { useCounterStore } from "../hooks/useCounterState";
import type { LabeledTextElement } from "../types";

describe("Overlay", () => {
  beforeEach(() => {
    useCounterStore.setState({
      appState: makeAppState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
  });

  // --- Phasing elements (phase, total_counter, total_timer) ---

  describe("Phasing elements", () => {
    /**
     * Reads one of the three phasing elements out of the fixture. They are
     * optional on OverlaySettings because settings stored before the feature
     * existed do not carry them, so spreading them needs a non-optional value.
     */
    function baseLabeled(key: "phase" | "total_counter" | "total_timer"): LabeledTextElement {
      const element = makeOverlaySettings()[key];
      if (!element) throw new Error(`overlay fixture is missing ${key}`);
      return element;
    }

    /** Hunt with two finished phases: 30 + 12 encounters, 1h + 30min of timer. */
    function makePhasedHunt() {
      const parent = makePokemon({
        id: "hunt-1",
        encounters: 5,
        timer_accumulated_ms: 600000,
      });
      const list = [
        parent,
        makePokemon({
          id: "child-1",
          phase_of: "hunt-1",
          phase_number: 1,
          encounters: 30,
          timer_accumulated_ms: 3600000,
        }),
        makePokemon({
          id: "child-2",
          phase_of: "hunt-1",
          phase_number: 2,
          encounters: 12,
          timer_accumulated_ms: 1800000,
        }),
      ];
      return { parent, list };
    }

    function renderPhased(settings: ReturnType<typeof makeOverlaySettings>) {
      const { parent, list } = makePhasedHunt();
      return render(
        <Overlay previewSettings={settings} previewPokemon={parent} previewPokemonList={list} />,
      );
    }

    it("hides the phase element when phase.visible is false", () => {
      renderPhased(
        makeOverlaySettings({
          phase: {
            ...baseLabeled("phase"),
            visible: false,
            show_label: true,
            label_text: "Phase:",
          },
        }),
      );
      expect(screen.queryByText("3")).not.toBeInTheDocument();
      expect(screen.queryByText("Phase:")).not.toBeInTheDocument();
    });

    it("renders the running phase number as max child number plus one", () => {
      renderPhased(makeOverlaySettings({ phase: { ...baseLabeled("phase"), visible: true } }));
      expect(screen.getByText("3")).toBeInTheDocument();
    });

    it("renders the phase label when show_label is true", () => {
      renderPhased(
        makeOverlaySettings({
          phase: { ...baseLabeled("phase"), visible: true, show_label: true, label_text: "Phase:" },
        }),
      );
      expect(screen.getByText("Phase:")).toBeInTheDocument();
    });

    it("does not render the phase label when show_label is false", () => {
      renderPhased(
        makeOverlaySettings({
          phase: {
            ...baseLabeled("phase"),
            visible: true,
            show_label: false,
            label_text: "Phase:",
          },
        }),
      );
      expect(screen.queryByText("Phase:")).not.toBeInTheDocument();
    });

    it("hides the total counter when total_counter.visible is false", () => {
      const { container } = renderPhased(
        makeOverlaySettings({ total_counter: { ...baseLabeled("total_counter"), visible: false } }),
      );
      expect(container.textContent).not.toContain("47");
    });

    it("renders own encounters plus those of every phase", () => {
      renderPhased(
        makeOverlaySettings({ total_counter: { ...baseLabeled("total_counter"), visible: true } }),
      );
      // 5 of the running phase + 30 + 12 of the finished ones
      expect(screen.getByText("47")).toBeInTheDocument();
    });

    it("renders the total counter label when show_label is true", () => {
      renderPhased(
        makeOverlaySettings({
          total_counter: {
            ...baseLabeled("total_counter"),
            visible: true,
            show_label: true,
            label_text: "Total:",
          },
        }),
      );
      expect(screen.getByText("Total:")).toBeInTheDocument();
    });

    it("does not render the total counter label when show_label is false", () => {
      renderPhased(
        makeOverlaySettings({
          total_counter: {
            ...baseLabeled("total_counter"),
            visible: true,
            show_label: false,
            label_text: "Total:",
          },
        }),
      );
      expect(screen.queryByText("Total:")).not.toBeInTheDocument();
    });

    it("hides the total timer when total_timer.visible is false", () => {
      const { container } = renderPhased(
        makeOverlaySettings({ total_timer: { ...baseLabeled("total_timer"), visible: false } }),
      );
      expect(container.textContent).not.toContain("01:40:00");
    });

    it("renders own timer plus that of every phase", () => {
      renderPhased(
        makeOverlaySettings({ total_timer: { ...baseLabeled("total_timer"), visible: true } }),
      );
      // 10min of the running phase + 60min + 30min of the finished ones
      expect(screen.getByText("01:40:00")).toBeInTheDocument();
    });

    it("adds the running timer segment on top of the phase totals", () => {
      const settings = makeOverlaySettings({
        total_timer: { ...baseLabeled("total_timer"), visible: true },
      });
      const started = new Date(Date.now() - 5000).toISOString();
      const parent = makePokemon({
        id: "hunt-1",
        timer_accumulated_ms: 600000,
        timer_started_at: started,
      });
      const child = makePokemon({
        id: "child-1",
        phase_of: "hunt-1",
        phase_number: 1,
        timer_accumulated_ms: 3600000,
      });
      render(
        <Overlay
          previewSettings={settings}
          previewPokemon={parent}
          previewPokemonList={[parent, child]}
        />,
      );
      // 60min of the phase + 10min accumulated + the 5s that are still running
      expect(screen.getByText("01:10:05")).toBeInTheDocument();
    });

    it("renders the total timer label when show_label is true", () => {
      renderPhased(
        makeOverlaySettings({
          total_timer: {
            ...baseLabeled("total_timer"),
            visible: true,
            show_label: true,
            label_text: "Total Time:",
          },
        }),
      );
      expect(screen.getByText("Total Time:")).toBeInTheDocument();
    });

    it("does not render the total timer label when show_label is false", () => {
      renderPhased(
        makeOverlaySettings({
          total_timer: {
            ...baseLabeled("total_timer"),
            visible: true,
            show_label: false,
            label_text: "Total Time:",
          },
        }),
      );
      expect(screen.queryByText("Total Time:")).not.toBeInTheDocument();
    });
  });
});
