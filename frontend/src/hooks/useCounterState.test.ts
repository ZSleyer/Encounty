import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useCounterStore, DetectorStatusEntry } from "./useCounterState";
import { AppState } from "../types";

/** Helper to reset the Zustand store to its initial state between tests. */
function resetStore() {
  useCounterStore.setState({
    appState: null,
    lastEncounterPokemonId: null,
    isConnected: false,
    detectorStatus: {},
  });
}

/** Minimal AppState fixture with two Pokemon. */
function makeAppState(activeId: string): AppState {
  return {
    pokemon: [
      {
        id: "poke-1",
        name: "Bisasam",
        canonical_name: "bulbasaur",
        sprite_url: "",
        sprite_type: "normal",
        encounters: 42,
        is_active: activeId === "poke-1",
        created_at: "2024-01-01T00:00:00Z",
        language: "de",
        game: "red",
        overlay_mode: "default",
      },
      {
        id: "poke-2",
        name: "Glumanda",
        canonical_name: "charmander",
        sprite_url: "",
        sprite_type: "shiny",
        encounters: 7,
        is_active: activeId === "poke-2",
        created_at: "2024-01-02T00:00:00Z",
        language: "de",
        game: "blue",
        overlay_mode: "default",
      },
    ],
    sessions: [],
    active_id: activeId,
    hotkeys: { increment: "", decrement: "", reset: "", next_pokemon: "" },
    settings: {} as AppState["settings"],
    data_path: "/tmp/encounty",
    license_accepted: true,
  };
}

describe("useCounterStore", () => {
  beforeEach(() => {
    resetStore();
  });

  // --- Initial state ---

  it("has null appState initially", () => {
    expect(useCounterStore.getState().appState).toBeNull();
  });

  it("has isConnected false initially", () => {
    expect(useCounterStore.getState().isConnected).toBe(false);
  });

  // --- setAppState ---

  it("setAppState replaces appState", () => {
    const state = makeAppState("poke-1");
    useCounterStore.getState().setAppState(state);
    expect(useCounterStore.getState().appState).toBe(state);
  });

  // --- setConnected ---

  it("setConnected updates isConnected", () => {
    useCounterStore.getState().setConnected(true);
    expect(useCounterStore.getState().isConnected).toBe(true);

    useCounterStore.getState().setConnected(false);
    expect(useCounterStore.getState().isConnected).toBe(false);
  });

  // --- getActivePokemon ---

  it("getActivePokemon returns null when no appState", () => {
    expect(useCounterStore.getState().getActivePokemon()).toBeNull();
  });

  it("getActivePokemon returns the correct Pokemon when active_id matches", () => {
    useCounterStore.getState().setAppState(makeAppState("poke-2"));
    const active = useCounterStore.getState().getActivePokemon();
    expect(active).not.toBeNull();
    expect(active!.id).toBe("poke-2");
    expect(active!.name).toBe("Glumanda");
  });

  it("getActivePokemon returns null when active_id matches no Pokemon", () => {
    useCounterStore.getState().setAppState(makeAppState("nonexistent"));
    expect(useCounterStore.getState().getActivePokemon()).toBeNull();
  });

  // --- flashPokemon ---

  describe("flashPokemon", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("sets lastEncounterPokemonId immediately", () => {
      useCounterStore.getState().flashPokemon("poke-1");
      expect(useCounterStore.getState().lastEncounterPokemonId).toBe("poke-1");
    });

    it("clears lastEncounterPokemonId after 400ms", () => {
      useCounterStore.getState().flashPokemon("poke-1");
      vi.advanceTimersByTime(399);
      expect(useCounterStore.getState().lastEncounterPokemonId).toBe("poke-1");

      vi.advanceTimersByTime(1);
      expect(useCounterStore.getState().lastEncounterPokemonId).toBeNull();
    });
  });

  // --- setDetectorStatus / clearDetectorStatus ---

  describe("detector status", () => {
    const entry: DetectorStatusEntry = {
      state: "idle",
      confidence: 0.85,
      poll_ms: 200,
    };

    it("setDetectorStatus adds an entry for a Pokemon", () => {
      useCounterStore.getState().setDetectorStatus("poke-1", entry);
      expect(useCounterStore.getState().detectorStatus["poke-1"]).toEqual(entry);
    });

    it("clearDetectorStatus removes the entry for a Pokemon", () => {
      useCounterStore.getState().setDetectorStatus("poke-1", entry);
      useCounterStore.getState().clearDetectorStatus("poke-1");
      expect(useCounterStore.getState().detectorStatus["poke-1"]).toBeUndefined();
    });

    it("clearDetectorStatus does not affect other entries", () => {
      const entry2: DetectorStatusEntry = { state: "match_active", confidence: 0.99, poll_ms: 100 };
      useCounterStore.getState().setDetectorStatus("poke-1", entry);
      useCounterStore.getState().setDetectorStatus("poke-2", entry2);
      useCounterStore.getState().clearDetectorStatus("poke-1");

      expect(useCounterStore.getState().detectorStatus["poke-1"]).toBeUndefined();
      expect(useCounterStore.getState().detectorStatus["poke-2"]).toEqual(entry2);
    });
  });
});
