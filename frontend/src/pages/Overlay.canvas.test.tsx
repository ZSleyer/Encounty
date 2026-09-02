/**
 * Overlay page tests: the canvas itself, meaning its size, border, sprite glow,
 * sprite fallback and background animations.
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
    render(<Overlay previewSettings={makeOverlaySettings()} previewPokemon={glumanda} />);
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

  it("renders no animation for an unknown background_animation value", () => {
    // Profiles saved before an animation was removed can still carry its key.
    const settings = makeOverlaySettings({
      background_animation: "rb-galaxy",
    });
    const pokemon = makePokemon();
    const { container } = render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
    expect(container.querySelector(".canvas-waves")).not.toBeInTheDocument();
    expect(container.querySelector(".canvas-gradient-shift")).not.toBeInTheDocument();
    expect(container.querySelector(".canvas-shimmer-bg")).not.toBeInTheDocument();
  });

  it("does not render the animation div when the canvas is hidden", () => {
    const settings = makeOverlaySettings({
      hidden: true,
      background_animation: "waves",
    });
    const pokemon = makePokemon({ name: "Pikachu" });
    const { container } = render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
    expect(container.querySelector(".canvas-waves")).not.toBeInTheDocument();
    expect(container.querySelector(".canvas-gradient-shift")).not.toBeInTheDocument();
    expect(container.querySelector(".canvas-shimmer-bg")).not.toBeInTheDocument();
    // Hiding the canvas must not hide the layers that carry their own visible flag.
    expect(screen.getByText("Pikachu")).toBeInTheDocument();
  });

  it("renders the animation div when the canvas is not hidden", () => {
    const settings = makeOverlaySettings({
      hidden: false,
      background_animation: "waves",
    });
    const pokemon = makePokemon();
    const { container } = render(<Overlay previewSettings={settings} previewPokemon={pokemon} />);
    expect(container.querySelector(".canvas-waves")).toBeInTheDocument();
  });
});
