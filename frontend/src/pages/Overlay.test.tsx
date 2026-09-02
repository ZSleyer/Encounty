/**
 * Overlay page tests: base rendering of the live and preview overlay, plus the
 * visibility toggles and the counter label.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, makeAppState, makeOverlaySettings, makePokemon } from "../test-utils";
import { Overlay } from "./Overlay";
import { useCounterStore } from "../hooks/useCounterState";

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
    render(<Overlay previewSettings={makeOverlaySettings()} previewPokemon={pokemon} />);
    expect(screen.getByText("Pikachu")).toBeInTheDocument();
    expect(screen.getByText("99")).toBeInTheDocument();
  });

  it("shows placeholder when previewSettings given but no pokemon", () => {
    useCounterStore.setState({ appState: null });
    render(<Overlay previewSettings={makeOverlaySettings()} />);
    expect(screen.getByText(/Kein aktives/)).toBeInTheDocument();
  });

  // --- Element visibility toggling ---

  it("hides sprite when sprite.visible is false", () => {
    const settings = makeOverlaySettings({
      sprite: {
        ...makeOverlaySettings().sprite,
        visible: false,
      },
    });
    const pokemon = makePokemon({ name: "Pikachu", sprite_url: "http://example.com/pika.png" });
    render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows sprite when sprite.visible is true", () => {
    const settings = makeOverlaySettings({
      sprite: {
        ...makeOverlaySettings().sprite,
        visible: true,
      },
    });
    const pokemon = makePokemon({ name: "Pikachu", sprite_url: "http://example.com/pika.png" });
    const { container } = render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
    // img has alt="" so it gets role="presentation" — use querySelector
    const img = container.querySelector("img.pokemon-sprite");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "http://example.com/pika.png");
  });

  it("hides name element when name.visible is false", () => {
    const settings = makeOverlaySettings({
      name: {
        ...makeOverlaySettings().name,
        visible: false,
      },
    });
    const pokemon = makePokemon({ name: "Glurak" });
    render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
    expect(screen.queryByText("Glurak")).not.toBeInTheDocument();
  });

  it("hides counter when counter.visible is false", () => {
    const settings = makeOverlaySettings({
      counter: {
        ...makeOverlaySettings().counter,
        visible: false,
      },
    });
    const pokemon = makePokemon({ encounters: 123 });
    render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
    expect(screen.queryByText("123")).not.toBeInTheDocument();
  });

  it("hides title when title.visible is false", () => {
    const settings = makeOverlaySettings({
      title: {
        ...makeOverlaySettings().title,
        visible: false,
      },
    });
    const pokemon = makePokemon({ title: "My Hunt" });
    render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
    expect(screen.queryByText("My Hunt")).not.toBeInTheDocument();
  });

  // --- Timer element visibility ---

  it("hides timer when timer.visible is false", () => {
    const settings = makeOverlaySettings({
      timer: {
        ...makeOverlaySettings().timer,
        visible: false,
      },
    });
    const pokemon = makePokemon({ timer_accumulated_ms: 90000000 });
    render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
    expect(screen.queryByText("25:00:00")).not.toBeInTheDocument();
  });

  it("shows timer when timer.visible is true", () => {
    const settings = makeOverlaySettings({
      timer: {
        ...makeOverlaySettings().timer,
        visible: true,
      },
    });
    const pokemon = makePokemon({ timer_accumulated_ms: 90000000 });
    render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
    expect(screen.getByText("25:00:00")).toBeInTheDocument();
  });

  it("shows timer label when timer.show_label is true", () => {
    const settings = makeOverlaySettings({
      timer: {
        ...makeOverlaySettings().timer,
        visible: true,
        show_label: true,
        label_text: "Hunt Time:",
      },
    });
    const pokemon = makePokemon({ timer_accumulated_ms: 3600000 });
    render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
    expect(screen.getByText("Hunt Time:")).toBeInTheDocument();
    expect(screen.getByText("01:00:00")).toBeInTheDocument();
  });

  it("hides timer label when timer.show_label is false", () => {
    const settings = makeOverlaySettings({
      timer: {
        ...makeOverlaySettings().timer,
        visible: true,
        show_label: false,
        label_text: "Hunt Time:",
      },
    });
    const pokemon = makePokemon({ timer_accumulated_ms: 3600000 });
    render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
    expect(screen.queryByText("Hunt Time:")).not.toBeInTheDocument();
  });

  // --- Counter label ---

  it("shows counter label text when show_label is true", () => {
    const settings = makeOverlaySettings({
      counter: {
        ...makeOverlaySettings().counter,
        show_label: true,
        label_text: "Total:",
      },
    });
    const pokemon = makePokemon({ encounters: 55 });
    render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
    expect(screen.getByText("Total:")).toBeInTheDocument();
    expect(screen.getByText("55")).toBeInTheDocument();
  });

  it("hides counter label when show_label is false", () => {
    const settings = makeOverlaySettings({
      counter: {
        ...makeOverlaySettings().counter,
        show_label: false,
        label_text: "Total:",
      },
    });
    const pokemon = makePokemon({ encounters: 55 });
    render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
    expect(screen.queryByText("Total:")).not.toBeInTheDocument();
  });
});
