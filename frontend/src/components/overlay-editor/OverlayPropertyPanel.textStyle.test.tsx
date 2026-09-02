/**
 * Text style editor of the property panel: font, size, weight, alignment and
 * the colour, outline and shadow swatches.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, makeOverlaySettings } from "../../test-utils";
import { OverlayPropertyPanel } from "./OverlayPropertyPanel";
import type { OverlaySettings, OverlayElementBase } from "../../types";

type ElementKey = "sprite" | "name" | "title" | "counter" | "timer" | "odds" | "canvas";

/** Build default props with sensible mock callbacks. */
function makeProps(overrides?: {
  selectedEl?: ElementKey;
  settings?: OverlaySettings;
  readOnly?: boolean;
  embedded?: boolean;
  bgPreviewUrl?: string;
  bgUploading?: boolean;
  onBgUpload?: () => void;
  onBgRemove?: () => void;
}) {
  const settings = overrides?.settings ?? makeOverlaySettings();
  return {
    localSettings: settings,
    selectedEl: overrides?.selectedEl ?? ("sprite" as const),
    updateSelectedEl: vi.fn() as (patch: Partial<OverlayElementBase>) => void,
    onUpdate: vi.fn() as (s: OverlaySettings) => void,
    openColorPicker: vi.fn(),
    openOutlineEditor: vi.fn(),
    openShadowEditor: vi.fn(),
    openTextColorEditor: vi.fn(),
    fireTest: vi.fn(),
    readOnly: overrides?.readOnly,
    embedded: overrides?.embedded,
    bgPreviewUrl: overrides?.bgPreviewUrl,
    bgUploading: overrides?.bgUploading,
    onBgUpload: overrides?.onBgUpload,
    onBgRemove: overrides?.onBgRemove,
  };
}

describe("OverlayPropertyPanel", () => {
  // --- Text style font family change ---

  it("shows font family selector for name text style", () => {
    const props = makeProps({ selectedEl: "name" });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText("Schriftart")).toBeInTheDocument();
  });

  it("shows font weight selector for name text style", () => {
    const props = makeProps({ selectedEl: "name" });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText("Gewicht")).toBeInTheDocument();
  });

  it("shows text alignment buttons for name text style", () => {
    const props = makeProps({ selectedEl: "name" });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText("Ausrichtung")).toBeInTheDocument();
  });

  // --- Text style editor: font family change ---

  it("calls onUpdate when font family is changed for name text style", () => {
    const props = makeProps({ selectedEl: "name" });
    render(<OverlayPropertyPanel {...props} />);
    const fontSelect = screen.getByText("Schriftart").closest("label")!.querySelector("select")!;
    fireEvent.change(fontSelect, { target: { value: "Roboto" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.objectContaining({
          style: expect.objectContaining({ font_family: "Roboto" }),
        }),
      }),
    );
  });

  // --- Text style editor: font weight change ---

  it("calls onUpdate when font weight is changed for name text style", () => {
    const props = makeProps({ selectedEl: "name" });
    render(<OverlayPropertyPanel {...props} />);
    const weightSelect = screen.getByText("Gewicht").closest("label")!.querySelector("select")!;
    fireEvent.change(weightSelect, { target: { value: "700" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.objectContaining({
          style: expect.objectContaining({ font_weight: 700 }),
        }),
      }),
    );
  });

  // --- Text style editor: alignment button click ---

  it("calls onUpdate when text alignment is changed for name text style", () => {
    const props = makeProps({ selectedEl: "name" });
    render(<OverlayPropertyPanel {...props} />);
    // Click the center alignment button
    const alignButtons = screen.getByText("Ausrichtung").closest("div")!.querySelectorAll("button");
    // center is the second button (left=0, center=1, right=2)
    fireEvent.click(alignButtons[1]);
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.objectContaining({
          style: expect.objectContaining({ text_align: "center" }),
        }),
      }),
    );
  });

  it("calls onUpdate when right alignment is clicked for name text style", () => {
    const props = makeProps({ selectedEl: "name" });
    render(<OverlayPropertyPanel {...props} />);
    const alignButtons = screen.getByText("Ausrichtung").closest("div")!.querySelectorAll("button");
    fireEvent.click(alignButtons[2]);
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.objectContaining({
          style: expect.objectContaining({ text_align: "right" }),
        }),
      }),
    );
  });

  // --- Text color swatch click ---

  it("calls openTextColorEditor when text color swatch is clicked for name", () => {
    const props = makeProps({ selectedEl: "name" });
    render(<OverlayPropertyPanel {...props} />);
    // The color swatch shows the color label
    const colorButton = screen.getByTitle("Farbe #ffffff");
    fireEvent.click(colorButton);
    expect(props.openTextColorEditor).toHaveBeenCalledWith(
      "solid",
      "#ffffff",
      expect.any(Array),
      expect.any(Number),
      expect.any(Function),
    );
  });

  // --- Outline swatch click ---

  it("calls openOutlineEditor when outline swatch is clicked for name", () => {
    const props = makeProps({ selectedEl: "name" });
    render(<OverlayPropertyPanel {...props} />);
    // ColorSwatch uses title={label}, outline label uses "Umriss"
    const outlineButton = screen.getByTitle(/Umriss/);
    fireEvent.click(outlineButton);
    expect(props.openOutlineEditor).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "none",
        color: "#000000",
        width: 0,
        onConfirm: expect.any(Function),
      }),
    );
  });

  // --- Shadow swatch click ---

  it("calls openShadowEditor when shadow swatch is clicked for name", () => {
    const props = makeProps({ selectedEl: "name" });
    render(<OverlayPropertyPanel {...props} />);
    const shadowButton = screen.getByText(/Schatten \(/).closest("button")!;
    fireEvent.click(shadowButton);
    expect(props.openShadowEditor).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        color: "#000000",
        onConfirm: expect.any(Function),
      }),
    );
  });

  // --- Text style font size slider for name ---

  it("calls onUpdate when font size is changed for name text style", () => {
    const props = makeProps({ selectedEl: "name" });
    render(<OverlayPropertyPanel {...props} />);
    // The font size NumSlider has a range input with title containing the size label
    const sizeSlider = screen.getByTitle(/Größe/);
    fireEvent.change(sizeSlider, { target: { value: "24" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.objectContaining({
          style: expect.objectContaining({ font_size: 24 }),
        }),
      }),
    );
  });

  // --- Counter font family change ---

  it("calls onUpdate when font family is changed for counter text style", () => {
    const props = makeProps({ selectedEl: "counter" });
    render(<OverlayPropertyPanel {...props} />);
    // Counter style is the first TextStyleEditor, its font selector
    const fontSelects = screen.getAllByText("Schriftart");
    const fontSelect = fontSelects[0].closest("label")!.querySelector("select")!;
    fireEvent.change(fontSelect, { target: { value: "monospace" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        counter: expect.objectContaining({
          style: expect.objectContaining({ font_family: "monospace" }),
        }),
      }),
    );
  });

  // --- Title font family change ---

  it("calls onUpdate when font family is changed for title text style", () => {
    const props = makeProps({ selectedEl: "title" });
    render(<OverlayPropertyPanel {...props} />);
    const fontSelect = screen.getByText("Schriftart").closest("label")!.querySelector("select")!;
    fireEvent.change(fontSelect, { target: { value: "serif" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.objectContaining({
          style: expect.objectContaining({ font_family: "serif" }),
        }),
      }),
    );
  });

  // --- Label style text editor for counter ---

  it("calls onUpdate when label style font family is changed", () => {
    const settings = makeOverlaySettings({
      counter: {
        ...makeOverlaySettings().counter,
        show_label: true,
      },
    });
    const props = makeProps({ selectedEl: "counter", settings });
    render(<OverlayPropertyPanel {...props} />);
    // There are two TextStyleEditors when show_label is true: counter style + label style
    const fontSelects = screen.getAllByText("Schriftart");
    // The second one is the label style
    const labelFontSelect = fontSelects[1].closest("label")!.querySelector("select")!;
    fireEvent.change(labelFontSelect, { target: { value: "pokemon" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        counter: expect.objectContaining({
          label_style: expect.objectContaining({ font_family: "pokemon" }),
        }),
      }),
    );
  });

  // --- Outline swatch with solid outline ---

  it("calls openOutlineEditor with solid params when outline is solid", () => {
    const settings = makeOverlaySettings({
      name: {
        ...makeOverlaySettings().name,
        style: {
          ...makeOverlaySettings().name.style,
          outline_type: "solid" as const,
          outline_color: "#ff0000",
          outline_width: 3,
        },
      },
    });
    const props = makeProps({ selectedEl: "name", settings });
    render(<OverlayPropertyPanel {...props} />);
    const outlineButton = screen.getByTitle(/Umriss 3px/);
    fireEvent.click(outlineButton);
    expect(props.openOutlineEditor).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "solid",
        color: "#ff0000",
        width: 3,
        onConfirm: expect.any(Function),
      }),
    );
  });

  // --- Outline swatch with gradient outline ---

  it("calls openOutlineEditor with the stored gradient when outline is a gradient", () => {
    const stops = [
      { color: "#ff0000", position: 0 },
      { color: "#0000ff", position: 100 },
    ];
    const settings = makeOverlaySettings({
      name: {
        ...makeOverlaySettings().name,
        style: {
          ...makeOverlaySettings().name.style,
          outline_type: "gradient" as const,
          outline_width: 4,
          outline_gradient_stops: stops,
          outline_gradient_angle: 45,
        },
      },
    });
    const props = makeProps({ selectedEl: "name", settings });
    render(<OverlayPropertyPanel {...props} />);
    fireEvent.click(screen.getByTitle(/Umriss 4px/));
    expect(props.openOutlineEditor).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "gradient",
        width: 4,
        gradientStops: stops,
        gradientAngle: 45,
      }),
    );
  });

  // --- Shadow swatch with shadow enabled ---

  it("calls openShadowEditor with enabled params when shadow is on", () => {
    const settings = makeOverlaySettings({
      name: {
        ...makeOverlaySettings().name,
        style: {
          ...makeOverlaySettings().name.style,
          text_shadow: true,
          text_shadow_color: "#333333",
          text_shadow_blur: 4,
          text_shadow_x: 1,
          text_shadow_y: 1,
        },
      },
    });
    const props = makeProps({ selectedEl: "name", settings });
    render(<OverlayPropertyPanel {...props} />);
    const shadowButton = screen.getByText(/Schatten 4px/).closest("button")!;
    fireEvent.click(shadowButton);
    expect(props.openShadowEditor).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        color: "#333333",
        blur: 4,
        x: 1,
        y: 1,
      }),
    );
  });

  // --- Text color with gradient ---

  it("calls openTextColorEditor with gradient params when color_type is gradient", () => {
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
    const props = makeProps({ selectedEl: "name", settings });
    render(<OverlayPropertyPanel {...props} />);
    const colorButton = screen.getByTitle("Farbe (Verlauf)");
    fireEvent.click(colorButton);
    expect(props.openTextColorEditor).toHaveBeenCalledWith(
      "gradient",
      "#ffffff",
      [
        { color: "#ff0000", position: 0 },
        { color: "#0000ff", position: 100 },
      ],
      90,
      expect.any(Function),
    );
  });

  // --- Outline type solid branch ---

  it("shows outline color in swatch when outline type is solid", () => {
    const settings = makeOverlaySettings({
      name: {
        ...makeOverlaySettings().name,
        style: {
          ...makeOverlaySettings().name.style,
          outline_type: "solid",
          outline_color: "#ff0000",
          outline_width: 3,
        },
      },
    });
    const props = makeProps({ selectedEl: "name", settings });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText("Umriss 3px")).toBeInTheDocument();
    expect(screen.getByTitle("Umriss 3px #ff0000")).toBeInTheDocument();
  });

  // --- Shadow enabled branch ---

  it("shows shadow details in swatch when text shadow is enabled", () => {
    const settings = makeOverlaySettings({
      name: {
        ...makeOverlaySettings().name,
        style: {
          ...makeOverlaySettings().name.style,
          text_shadow: true,
          text_shadow_blur: 4,
          text_shadow_x: 2,
          text_shadow_y: 3,
        },
      },
    });
    const props = makeProps({ selectedEl: "name", settings });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText(/Schatten 4px 2,3/)).toBeInTheDocument();
  });

  // --- Outline type gradient branch ---

  it("shows the gradient marker in the outline swatch when outline type is gradient", () => {
    const settings = makeOverlaySettings({
      name: {
        ...makeOverlaySettings().name,
        style: {
          ...makeOverlaySettings().name.style,
          outline_type: "gradient",
          outline_width: 3,
          outline_gradient_stops: [
            { color: "#ff0000", position: 0 },
            { color: "#0000ff", position: 100 },
          ],
          outline_gradient_angle: 90,
        },
      },
    });
    const props = makeProps({ selectedEl: "name", settings });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText("Umriss 3px")).toBeInTheDocument();
    expect(screen.getByTitle("Umriss 3px (Verlauf)")).toBeInTheDocument();
  });
});
