import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  makeAppState,
  makeOverlaySettings,
  makePokemon,
} from "../test-utils";
import { Overlay } from "./Overlay";
import { useCounterStore } from "../hooks/useCounterState";
import type { LabeledTextElement, TextStyle } from "../types";
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

  // --- Text outline layers ---

  /** Overlay settings whose name element carries the given style overrides. */
  function settingsWithNameStyle(overrides: Partial<TextStyle>) {
    const base = makeOverlaySettings();
    return makeOverlaySettings({
      name: { ...base.name, style: { ...base.name.style, ...overrides } },
    });
  }

  /** Renders the name element with the given style and returns both layers. */
  function renderNameWithStyle(overrides: Partial<TextStyle>) {
    const { container } = render(
      <Overlay
        previewSettings={settingsWithNameStyle(overrides)}
        previewPokemon={makePokemon({ name: "Gengar" })}
      />,
    );
    return {
      container,
      stroke: container.querySelector<HTMLElement>(".overlay-text-stroke"),
      fill: container.querySelector<HTMLElement>(".overlay-text-fill"),
    };
  }

  const SOLID_OUTLINE: Partial<TextStyle> = {
    outline_type: "solid" as const,
    outline_width: 3,
    outline_color: "#00ff00",
  };

  const GRADIENT_OUTLINE: Partial<TextStyle> = {
    outline_type: "gradient" as const,
    outline_width: 3,
    outline_color: "#00ff00",
    outline_gradient_stops: [
      { color: "#ff0000", position: 0 },
      { color: "#0000ff", position: 100 },
    ],
    outline_gradient_angle: 45,
  };

  const GRADIENT_FILL: Partial<TextStyle> = {
    color_type: "gradient" as const,
    gradient_stops: [
      { color: "#111111", position: 0 },
      { color: "#222222", position: 100 },
    ],
    gradient_angle: 90,
  };

  it("renders a single span without outline layers when outline_type is none", () => {
    const { container, stroke, fill } = renderNameWithStyle({ outline_type: "none" });
    expect(stroke).toBeNull();
    expect(fill).toBeNull();
    expect(container.querySelector("[aria-hidden='true']")).toBeNull();
    expect(screen.getByText("Gengar")).toBeInTheDocument();
  });

  it("renders no outline for an outline_width of zero", () => {
    const { stroke } = renderNameWithStyle({ ...SOLID_OUTLINE, outline_width: 0 });
    expect(stroke).toBeNull();
  });

  it("renders no outline for an unknown outline_type", () => {
    const { stroke, fill } = renderNameWithStyle({
      // A value stored by a future or foreign version must not break rendering.
      outline_type: "engraved" as unknown as TextStyle["outline_type"],
      outline_width: 4,
    });
    expect(stroke).toBeNull();
    expect(fill).toBeNull();
    expect(screen.getByText("Gengar")).toBeInTheDocument();
  });

  it("paints a solid outline on a stroke layer below a solid fill layer", () => {
    const { stroke, fill } = renderNameWithStyle(SOLID_OUTLINE);
    // Double width because the fill layer covers the inner half of the stroke.
    expect(stroke?.style.webkitTextStroke).toBe("6px #00ff00");
    expect(stroke?.style.paintOrder).toBe("stroke fill");
    expect(stroke?.style.webkitTextFillColor).toBe("transparent");
    expect(stroke?.style.backgroundImage).toBe("");
    expect(fill?.style.color).toBe("rgb(255, 255, 255)");
    expect(fill?.style.position).toBe("absolute");
  });

  it("keeps a gradient fill visible above a solid outline", () => {
    const { stroke, fill } = renderNameWithStyle({ ...SOLID_OUTLINE, ...GRADIENT_FILL });
    // The stroke layer must not carry the fill gradient: it would be covered by
    // the opaque stroke anyway and the fill layer above owns the interior.
    expect(stroke?.style.webkitTextStroke).toBe("6px #00ff00");
    expect(stroke?.style.backgroundImage).toBe("");
    expect(fill?.style.backgroundImage).toBe(
      "linear-gradient(90deg, rgb(17, 17, 17) 0%, rgb(34, 34, 34) 100%)",
    );
    expect(fill?.style.webkitBackgroundClip).toBe("text");
    expect(fill?.style.webkitTextFillColor).toBe("transparent");
  });

  it("paints a gradient outline through a transparent stroke", () => {
    const { stroke, fill } = renderNameWithStyle(GRADIENT_OUTLINE);
    // A transparent stroke still widens the background-clip region, so the
    // gradient fills the widened silhouette and becomes the outline.
    expect(stroke?.style.webkitTextStroke).toBe("6px transparent");
    expect(stroke?.style.backgroundImage).toBe(
      "linear-gradient(45deg, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)",
    );
    expect(stroke?.style.webkitBackgroundClip).toBe("text");
    expect(stroke?.style.webkitTextFillColor).toBe("transparent");
    expect(fill?.style.color).toBe("rgb(255, 255, 255)");
  });

  it("combines a gradient fill with a gradient outline", () => {
    const { stroke, fill } = renderNameWithStyle({ ...GRADIENT_OUTLINE, ...GRADIENT_FILL });
    expect(stroke?.style.backgroundImage).toBe(
      "linear-gradient(45deg, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)",
    );
    expect(fill?.style.backgroundImage).toBe(
      "linear-gradient(90deg, rgb(17, 17, 17) 0%, rgb(34, 34, 34) 100%)",
    );
    expect(stroke?.style.webkitTextStroke).toBe("6px transparent");
  });

  it("falls back to the outline color when a gradient outline lacks stops", () => {
    const { stroke } = renderNameWithStyle({
      ...GRADIENT_OUTLINE,
      outline_gradient_stops: [{ color: "#ff0000", position: 0 }],
    });
    expect(stroke?.style.webkitTextStroke).toBe("6px #00ff00");
    expect(stroke?.style.backgroundImage).toBe("");
  });

  it("announces outlined text only once", () => {
    render(
      <Overlay
        previewSettings={settingsWithNameStyle(SOLID_OUTLINE)}
        previewPokemon={makePokemon({ name: "Gengar" })}
      />,
    );
    const nodes = screen.getAllByText("Gengar");
    expect(nodes).toHaveLength(2);
    const announced = nodes.filter((el) => !el.closest("[aria-hidden='true']"));
    expect(announced).toHaveLength(1);
  });

  it("reserves room around the glyphs so a thick outline is not clipped", () => {
    const { stroke } = renderNameWithStyle({ ...SOLID_OUTLINE, outline_width: 10 });
    const wrapper = stroke?.parentElement;
    // Effective stroke is 20px and sits half outside the glyph box.
    expect(wrapper?.style.padding).toBe("10px");
    expect(wrapper?.style.margin).toBe("-10px");
    expect(wrapper?.style.position).toBe("relative");
  });

  it("places the glyphs independently of the outline width", () => {
    // The positioned box does not clip, so padding there would only indent the
    // text by an outline-dependent amount and make it jump whenever the outline
    // changes. Position must depend on x/y alone.
    const positionedBox = (outlineWidth: number) => {
      const { stroke, container } = renderNameWithStyle(
        outlineWidth === 0
          ? { outline_type: "none" }
          : { ...SOLID_OUTLINE, outline_width: outlineWidth },
      );
      const node = stroke ?? container.querySelector<HTMLElement>("span");
      return node?.closest<HTMLElement>("div[style*='position: absolute']");
    };

    for (const width of [0, 4, 10]) {
      const box = positionedBox(width);
      expect(box?.style.padding).toBe("");
      expect(box?.style.paddingLeft).toBe("");
    }
  });

  it("gives the clipping digit wrappers room for the stroke in slot mode", () => {
    const base = makeOverlaySettings();
    const settings = makeOverlaySettings({
      counter: {
        ...base.counter,
        trigger_enter: "slot",
        style: { ...base.counter.style, ...SOLID_OUTLINE, outline_width: 10 },
      },
    });
    const { container } = render(
      <Overlay previewSettings={settings} previewPokemon={makePokemon({ encounters: 42 })} />,
    );
    const strokes = container.querySelectorAll<HTMLElement>(".overlay-text-stroke");
    expect(strokes.length).toBeGreaterThan(0);
    for (const strokeLayer of strokes) {
      const wrapper = strokeLayer.parentElement;
      const clipper = wrapper?.parentElement;
      expect(clipper?.style.overflow).toBe("hidden");
      // The clipper must reserve at least what the stroke layer sticks out.
      const clipperPad = Number.parseFloat(clipper?.style.padding ?? "0");
      const wrapperPad = Number.parseFloat(wrapper?.style.padding ?? "0");
      expect(clipperPad).toBeGreaterThanOrEqual(wrapperPad);
    }
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

  // --- Odds element rendering ---

  describe("Odds element", () => {
    it("hides odds when odds.visible is false", () => {
      const base = makeOverlaySettings();
      const settings = makeOverlaySettings({
        odds: { ...base.odds, visible: false },
      });
      const pokemon = makePokemon({ game: "pokemon-scarlet" });
      const { container } = render(
        <Overlay previewSettings={settings} previewPokemon={pokemon} />,
      );
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
      const { container } = render(
        <Overlay previewSettings={settings} previewPokemon={pokemon} />,
      );
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

  // --- Phasing elements (phase, total_counter, total_timer) ---

  describe("Phasing elements", () => {
    /**
     * Reads one of the three phasing elements out of the fixture. They are
     * optional on OverlaySettings because settings stored before the feature
     * existed do not carry them, so spreading them needs a non-optional value.
     */
    function baseLabeled(
      key: "phase" | "total_counter" | "total_timer",
    ): LabeledTextElement {
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
        <Overlay
          previewSettings={settings}
          previewPokemon={parent}
          previewPokemonList={list}
        />,
      );
    }

    it("hides the phase element when phase.visible is false", () => {
      renderPhased(
        makeOverlaySettings({
          phase: { ...baseLabeled("phase"), visible: false, show_label: true, label_text: "Phase:" },
        }),
      );
      expect(screen.queryByText("3")).not.toBeInTheDocument();
      expect(screen.queryByText("Phase:")).not.toBeInTheDocument();
    });

    it("renders the running phase number as max child number plus one", () => {
      renderPhased(
        makeOverlaySettings({ phase: { ...baseLabeled("phase"), visible: true } }),
      );
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
          phase: { ...baseLabeled("phase"), visible: true, show_label: false, label_text: "Phase:" },
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

  // --- Sprite cycling through the phase targets ---

  describe("Sprite cycling", () => {
    const huntSprite = "http://example.com/hunt.png";
    const targetSprite = "http://example.com/target.png";

    function makeCyclingPokemon() {
      return makePokemon({
        sprite_url: huntSprite,
        phase_targets: [
          { canonical_name: "zigzagoon", name: "Zigzachs", sprite_url: targetSprite },
        ],
      });
    }

    function cyclingSettings(enabled: boolean, transition?: string, intervalMs = 3000) {
      const base = makeOverlaySettings();
      return makeOverlaySettings({
        sprite: {
          ...base.sprite,
          visible: true,
          cycle_phase_targets: enabled,
          cycle_interval_ms: intervalMs,
          cycle_transition: transition,
        },
      });
    }

    /**
     * Renders a cycling overlay, advances past one swap and hands back both
     * slots in the order [incoming, outgoing].
     */
    function swapOnce(transition?: string, intervalMs = 3000) {
      vi.useFakeTimers();
      const { container } = render(
        <Overlay
          previewSettings={cyclingSettings(true, transition, intervalMs)}
          previewPokemon={makeCyclingPokemon()}
        />,
      );
      act(() => {
        vi.advanceTimersByTime(intervalMs);
      });
      const slots = [...container.querySelectorAll("img.pokemon-sprite")] as HTMLElement[];
      // Slot 0 starts in front, so after exactly one swap slot 1 is the
      // incoming one and slot 0 the outgoing one.
      return { incoming: slots[1], outgoing: slots[0] };
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it("falls back to the box sprite when the stored URL fails to load", () => {
      // A form whose stored URL was baked wrong (or whose host dropped the
      // file) used to leave the overlay blank, because it is the one surface
      // without an onError chain.
      const pokemon = makePokemon({
        sprite_url: "http://example.com/gone.gif",
        canonical_name: "zigzagoon-galar",
        sprite_type: "shiny",
      });
      const { container } = render(
        <Overlay previewSettings={cyclingSettings(false)} previewPokemon={pokemon} />,
      );
      const slot = container.querySelector("img.pokemon-sprite") as HTMLImageElement;
      expect(slot).toHaveAttribute("src", "http://example.com/gone.gif");

      act(() => {
        fireEvent.error(slot);
      });
      expect(slot.getAttribute("src")).toContain("/shiny/zigzagoon-galar.png");

      // And the placeholder as the last resort, never an empty slot.
      act(() => {
        fireEvent.error(slot);
      });
      expect(slot.getAttribute("src")).toContain("data:image/svg+xml");
    });

    it("falls back per phase target, not for the whole cycle", () => {
      vi.useFakeTimers();
      const pokemon = makePokemon({
        sprite_url: huntSprite,
        canonical_name: "bulbasaur",
        sprite_type: "shiny",
        phase_targets: [
          {
            canonical_name: "zigzagoon-galar",
            name: "Galar-Zigzachs",
            sprite_url: "http://example.com/gone.gif",
          },
        ],
      });
      const { container } = render(
        <Overlay previewSettings={cyclingSettings(true)} previewPokemon={pokemon} />,
      );
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      const incoming = [...container.querySelectorAll("img.pokemon-sprite")][1] as HTMLImageElement;
      act(() => {
        fireEvent.error(incoming);
      });
      expect(incoming.getAttribute("src")).toContain("/shiny/zigzagoon-galar.png");

      // Back at the hunt sprite the chain starts over: the target's failure
      // must not push the hunt's own sprite down a step.
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(container.querySelector("img.pokemon-sprite")).toHaveAttribute("src", huntSprite);
    });

    it("crossfades to the next sprite when the interval elapses", () => {
      vi.useFakeTimers();
      const { container } = render(
        <Overlay previewSettings={cyclingSettings(true)} previewPokemon={makeCyclingPokemon()} />,
      );
      const slots = [...container.querySelectorAll("img.pokemon-sprite")];
      const wrapper = slots[0]?.parentElement;
      // Two stacked slots so the outgoing sprite stays on screen while the
      // incoming one fades in. Only the hunt sprite is visible at rest.
      expect(slots).toHaveLength(2);
      expect(slots[0]).toHaveAttribute("src", huntSprite);
      expect(slots[0]).toHaveStyle({ opacity: "1" });
      expect(slots[1]).toHaveStyle({ opacity: "0" });

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      // Same DOM nodes, the slots only swap contents and opacity: feeding the
      // cycle index into the wrapper key would restart the trigger animation on
      // every tick, and remounting the image would blink instead of fade.
      const after = [...container.querySelectorAll("img.pokemon-sprite")];
      expect(after[0]).toBe(slots[0]);
      expect(after[1]).toBe(slots[1]);
      expect(after[0]?.parentElement).toBe(wrapper);
      expect(after[1]).toHaveAttribute("src", targetSprite);
      expect(after[1]).toHaveStyle({ opacity: "1" });
      expect(after[0]).toHaveStyle({ opacity: "0" });
    });

    it("fades no longer than half the cycle interval", () => {
      vi.useFakeTimers();
      const settings = cyclingSettings(true);
      const { container } = render(
        <Overlay
          previewSettings={makeOverlaySettings({
            ...settings,
            sprite: { ...settings.sprite, cycle_interval_ms: 300 },
          })}
          previewPokemon={makeCyclingPokemon()}
        />,
      );
      // A fast cycle must not leave both sprites at partial opacity for longer
      // than it shows either one on its own.
      const slot = container.querySelector("img.pokemon-sprite");
      expect(slot).toHaveStyle({ transition: "opacity 150ms ease-in-out" });
    });

    it("returns to the hunt sprite after a full cycle", () => {
      vi.useFakeTimers();
      const { container } = render(
        <Overlay previewSettings={cyclingSettings(true)} previewPokemon={makeCyclingPokemon()} />,
      );
      act(() => {
        vi.advanceTimersByTime(6000);
      });
      expect(container.querySelector("img.pokemon-sprite")).toHaveAttribute("src", huntSprite);
    });

    it("keeps the hunt sprite when cycling is disabled", () => {
      vi.useFakeTimers();
      const { container } = render(
        <Overlay previewSettings={cyclingSettings(false)} previewPokemon={makeCyclingPokemon()} />,
      );
      act(() => {
        vi.advanceTimersByTime(9000);
      });
      expect(container.querySelector("img.pokemon-sprite")).toHaveAttribute("src", huntSprite);
    });

    it("keeps the hunt sprite when the hunt has no phase targets", () => {
      vi.useFakeTimers();
      const pokemon = makePokemon({ sprite_url: huntSprite, phase_targets: [] });
      const { container } = render(
        <Overlay previewSettings={cyclingSettings(true)} previewPokemon={pokemon} />,
      );
      act(() => {
        vi.advanceTimersByTime(9000);
      });
      expect(container.querySelector("img.pokemon-sprite")).toHaveAttribute("src", huntSprite);
    });

    // --- Transitions ---

    it("swaps in one frame with the none transition", () => {
      const { incoming, outgoing } = swapOnce("none");
      expect(incoming).toHaveAttribute("src", targetSprite);
      expect(incoming.style.opacity).toBe("1");
      expect(incoming.style.transition).toBe("none");
      expect(incoming.style.animation).toBe("");
      expect(outgoing.style.opacity).toBe("0");
      expect(outgoing.style.transition).toBe("none");
    });

    it("crossfades with the fade transition", () => {
      const { incoming, outgoing } = swapOnce("fade");
      expect(incoming.style.opacity).toBe("1");
      expect(incoming.style.transition).toBe("opacity 400ms ease-in-out");
      expect(incoming.style.animation).toBe("");
      expect(outgoing.style.opacity).toBe("0");
      expect(outgoing.style.transition).toBe("opacity 400ms ease-in-out");
    });

    it("reveals the incoming sprite left to right with wipe-lr", () => {
      const { incoming, outgoing } = swapOnce("wipe-lr");
      // Opacity 1 throughout, so the clip path is a wipe and not a fade.
      expect(incoming.style.opacity).toBe("1");
      expect(incoming.style.animation).toBe("overlay-sprite-wipe-lr 400ms ease-in-out both");
      // The outgoing sprite stays visible underneath for the whole wipe and is
      // only cut away afterwards; sprites are transparent, so leaving it up
      // would show two of them at once.
      expect(outgoing.style.opacity).toBe("0");
      expect(outgoing.style.transition).toBe("opacity 0s linear 400ms");
      expect(outgoing.style.animation).toBe("");
    });

    it("reveals the incoming sprite right to left with wipe-rl", () => {
      const { incoming, outgoing } = swapOnce("wipe-rl");
      expect(incoming.style.opacity).toBe("1");
      expect(incoming.style.animation).toBe("overlay-sprite-wipe-rl 400ms ease-in-out both");
      expect(outgoing.style.opacity).toBe("0");
      expect(outgoing.style.transition).toBe("opacity 0s linear 400ms");
    });

    it("stacks the incoming slot above the outgoing one while wiping", () => {
      const { incoming, outgoing } = swapOnce("wipe-lr");
      // A wipe that ran behind the sprite it replaces would reveal nothing, so
      // the front slot has to paint above the other one either way round.
      expect(Number(incoming.style.zIndex)).toBeGreaterThan(Number(outgoing.style.zIndex));
    });

    it("does not wipe the first sprite in, there is nothing to wipe over", () => {
      vi.useFakeTimers();
      const { container } = render(
        <Overlay
          previewSettings={cyclingSettings(true, "wipe-lr")}
          previewPokemon={makeCyclingPokemon()}
        />,
      );
      const first = container.querySelector("img.pokemon-sprite") as HTMLElement;
      expect(first.style.animation).toBe("");
    });

    it("caps the wipe at half the cycle interval too", () => {
      const { incoming, outgoing } = swapOnce("wipe-lr", 300);
      expect(incoming.style.animation).toBe("overlay-sprite-wipe-lr 150ms ease-in-out both");
      expect(outgoing.style.transition).toBe("opacity 0s linear 150ms");
    });

    it("falls back to the crossfade for a stored value this build has no effect for", () => {
      // An overlay written by a newer version, or one saved before the setting
      // existed, must still cycle instead of rendering nothing.
      for (const stored of ["", "wipe-diagonal", undefined]) {
        const { incoming, outgoing } = swapOnce(stored);
        expect(incoming.style.transition).toBe("opacity 400ms ease-in-out");
        expect(incoming.style.opacity).toBe("1");
        expect(outgoing.style.opacity).toBe("0");
      }
    });
  });
});
