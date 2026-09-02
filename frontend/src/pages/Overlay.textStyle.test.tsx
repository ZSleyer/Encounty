/**
 * Overlay page tests: font and colour rendering of the text elements, the
 * stroke-and-fill outline layers and the title display.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, makeAppState, makeOverlaySettings, makePokemon } from "../test-utils";
import { Overlay } from "./Overlay";
import { useCounterStore } from "../hooks/useCounterState";
import type { TextStyle } from "../types";

describe("Overlay", () => {
  beforeEach(() => {
    useCounterStore.setState({
      appState: makeAppState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
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
});
