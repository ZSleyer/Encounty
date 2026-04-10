import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, makeAppState, makeOverlaySettings, makePokemon } from "../test-utils";
import { Overlay } from "./Overlay";
import { useCounterStore } from "../hooks/useCounterState";

vi.mock("../components/backgrounds/Aurora", () => ({ default: () => <div data-testid="bg-aurora" /> }));
vi.mock("../components/backgrounds/Galaxy", () => ({ default: () => <div data-testid="bg-galaxy" /> }));
vi.mock("../components/backgrounds/Silk", () => ({ default: () => <div data-testid="bg-silk" /> }));
vi.mock("../components/backgrounds/PixelBlast", () => ({ default: () => <div data-testid="bg-pixelblast" /> }));

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

  // --- Font/style rendering ---

  it("applies font-family from name style settings", () => {
    const settings = makeOverlaySettings({
      name: {
        ...makeOverlaySettings().name,
        style: {
          ...makeOverlaySettings().name.style,
          font_family: "monospace",
          font_size: 24,
          font_weight: 700,
        },
      },
    });
    const pokemon = makePokemon({ name: "Evoli" });
    render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
    const nameEl = screen.getByText("Evoli");
    expect(nameEl.style.fontFamily).toBe("monospace");
    expect(nameEl.style.fontSize).toBe("24px");
    expect(nameEl.style.fontWeight).toBe("700");
  });

  it("applies gradient text color when color_type is gradient", () => {
    const settings = makeOverlaySettings({
      name: {
        ...makeOverlaySettings().name,
        style: {
          ...makeOverlaySettings().name.style,
          color_type: "gradient" as const,
          gradient_stops: [
            { color: "#ff0000", position: 0 },
            { color: "#0000ff", position: 100 },
          ],
          gradient_angle: 90,
        },
      },
    });
    const pokemon = makePokemon({ name: "Pikachu" });
    render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
    const nameEl = screen.getByText("Pikachu");
    expect(nameEl.style.background).toContain("linear-gradient");
  });

  it("applies text shadow when text_shadow is enabled", () => {
    const settings = makeOverlaySettings({
      name: {
        ...makeOverlaySettings().name,
        style: {
          ...makeOverlaySettings().name.style,
          text_shadow: true,
          text_shadow_x: 2,
          text_shadow_y: 3,
          text_shadow_blur: 4,
          text_shadow_color: "#ff0000",
        },
      },
    });
    const pokemon = makePokemon({ name: "Mewtu" });
    render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
    const nameEl = screen.getByText("Mewtu");
    expect(nameEl.style.textShadow).toBe("2px 3px 4px #ff0000");
  });

  it("applies outline stroke when outline_type is solid", () => {
    const settings = makeOverlaySettings({
      name: {
        ...makeOverlaySettings().name,
        style: {
          ...makeOverlaySettings().name.style,
          outline_type: "solid" as const,
          outline_width: 3,
          outline_color: "#00ff00",
        },
      },
    });
    const pokemon = makePokemon({ name: "Gengar" });
    render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
    const nameEl = screen.getByText("Gengar");
    // Double width because fill covers the inner half via paint-order: stroke fill
    expect(nameEl.style.paintOrder).toBe("stroke fill");
  });

  // --- Title display ---

  it("renders pokemon title text when title is set", () => {
    const settings = makeOverlaySettings();
    const pokemon = makePokemon({ title: "Phase 2" });
    render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
    expect(screen.getByText("Phase 2")).toBeInTheDocument();
  });

  it("shows fallback title text in preview mode when no pokemon title", () => {
    const settings = makeOverlaySettings();
    const pokemon = makePokemon({ title: undefined });
    render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
    // In preview mode with no title, "Titel" is the fallback
    expect(screen.getByText("Titel")).toBeInTheDocument();
  });

  // --- Canvas sizing in non-preview mode ---

  it("sets canvas dimensions from settings when not in preview mode", () => {
    const state = makeAppState({
      settings: {
        ...makeAppState().settings,
        overlay: makeOverlaySettings({
          canvas_width: 500,
          canvas_height: 300,
        }),
      },
    });
    useCounterStore.setState({ appState: state });
    const { container } = render(<Overlay />);
    // The overlay-page wrapper contains the sized canvas div
    const canvasDiv = container.querySelector(".overlay-page > div");
    expect(canvasDiv).toBeInTheDocument();
    expect(canvasDiv?.getAttribute("style")).toContain("width: 500px");
    expect(canvasDiv?.getAttribute("style")).toContain("height: 300px");
  });

  // --- Border rendering ---

  it("renders border when show_border is true", () => {
    const settings = makeOverlaySettings({
      show_border: true,
      border_color: "#ff00ff",
      border_radius: 12,
    });
    const pokemon = makePokemon();
    const { container } = render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
    // The background div is the first child of the canvas div
    const bgDiv = container.querySelector("div > div > div");
    expect(bgDiv).toBeInTheDocument();
    expect(bgDiv?.getAttribute("style")).toContain("border-radius: 12px");
    // Browser serializes hex to rgb
    expect(bgDiv?.getAttribute("style")).toContain("rgb(255, 0, 255)");
  });

  it("renders no border when show_border is false", () => {
    const settings = makeOverlaySettings({
      show_border: false,
    });
    const pokemon = makePokemon();
    const { container } = render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
    const bgDiv = container.querySelector("div > div > div");
    expect(bgDiv).toBeInTheDocument();
    // jsdom serializes "none" as "medium" for border shorthand
    const style = bgDiv?.getAttribute("style") ?? "";
    expect(style).not.toContain("solid");
  });

  // --- Sprite glow ---

  it("renders sprite glow when show_glow is true", () => {
    const settings = makeOverlaySettings({
      sprite: {
        ...makeOverlaySettings().sprite,
        visible: true,
        show_glow: true,
        glow_color: "#ffff00",
        glow_opacity: 0.4,
        glow_blur: 15,
      },
    });
    const pokemon = makePokemon({ sprite_url: "http://example.com/pika.png" });
    const { container } = render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
    // The glow div has the background set to glow_color
    const glowDiv = Array.from(container.querySelectorAll("div")).find(
      (d) => d.style.background === "rgb(255, 255, 0)",
    );
    expect(glowDiv).toBeInTheDocument();
  });

  // --- Specific pokemon from store by ID ---

  it("renders a non-active pokemon when provided via previewPokemon", () => {
    // Verify a specific non-active pokemon is rendered when passed directly
    const glumanda = makePokemon({ id: "poke-2", name: "Glumanda", encounters: 7 });
    render(
      <Overlay previewSettings={makeOverlaySettings()} previewPokemon={glumanda} />,
    );
    expect(screen.getByText("Glumanda")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  // --- Fallback sprite ---

  it("uses fallback sprite URL when pokemon has no sprite_url", () => {
    const settings = makeOverlaySettings({
      sprite: { ...makeOverlaySettings().sprite, visible: true },
    });
    const pokemon = makePokemon({ sprite_url: "" });
    const { container } = render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
    const img = container.querySelector("img.pokemon-sprite");
    expect(img).toBeInTheDocument();
    // SPRITE_FALLBACK is used when sprite_url is empty
    expect(img?.getAttribute("src")).not.toBe("");
  });

  // --- Background animation ---

  it("applies CSS animation class for CSS-based background animation", () => {
    const settings = makeOverlaySettings({
      background_animation: "waves",
    });
    const pokemon = makePokemon();
    const { container } = render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
    const wavesDiv = container.querySelector(".canvas-waves");
    expect(wavesDiv).toBeInTheDocument();
  });

  it("applies custom animation speed", () => {
    const settings = makeOverlaySettings({
      background_animation: "waves",
      background_animation_speed: 2,
    });
    const pokemon = makePokemon();
    const { container } = render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
    const wavesDiv = container.querySelector(".canvas-waves");
    expect(wavesDiv).toBeInTheDocument();
    // Default duration for waves is 30s, divided by speed 2 = 15s
    expect((wavesDiv as HTMLElement).style.animationDuration).toBe("15s");
  });

  it("does not render animation div when background_animation is none", () => {
    const settings = makeOverlaySettings({
      background_animation: "none",
    });
    const pokemon = makePokemon();
    const { container } = render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
    expect(container.querySelector(".canvas-waves")).not.toBeInTheDocument();
    expect(container.querySelector(".canvas-gradient-shift")).not.toBeInTheDocument();
    expect(container.querySelector(".canvas-shimmer-bg")).not.toBeInTheDocument();
  });

  it("renders Suspense wrapper for reactbits animations", async () => {
    const settings = makeOverlaySettings({
      background_animation: "rb-aurora",
    });
    const pokemon = makePokemon();
    // Should not crash even though lazy components are mocked
    render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
    const auroraEl = await screen.findByTestId("bg-aurora");
    expect(auroraEl).toBeInTheDocument();
  });
});
