import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "../test-utils";
import { Overlay } from "./Overlay";
import { useCounterStore } from "../hooks/useCounterState";
import { makeAppState, makeOverlaySettings, makePokemon } from "../test-utils";

describe("Overlay", () => {
  beforeEach(() => {
    useCounterStore.setState({
      appState: makeAppState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
  });

  it("renders waiting state when no app state", () => {
    useCounterStore.setState({ appState: null });
    render(<Overlay />);
    expect(screen.getByText("Warten auf Daten...")).toBeInTheDocument();
  });

  it("renders the active pokemon name from store", () => {
    render(<Overlay />);
    expect(screen.getByText("Bisasam")).toBeInTheDocument();
  });

  it("renders in preview mode with previewSettings and previewPokemon", () => {
    const pokemon = makePokemon({ name: "Pikachu", encounters: 99 });
    render(
      <Overlay
        previewSettings={makeOverlaySettings()}
        previewPokemon={pokemon}
      />,
    );
    expect(screen.getByText("Pikachu")).toBeInTheDocument();
    expect(screen.getByText("99")).toBeInTheDocument();
  });

  it("shows placeholder when previewSettings given but no pokemon", () => {
    useCounterStore.setState({ appState: null });
    render(<Overlay previewSettings={makeOverlaySettings()} />);
    expect(screen.getByText(/Kein aktives/)).toBeInTheDocument();
  });
});
