/**
 * Canvas rows of the property panel: size, background fill and image, border
 * and the animated background.
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
  it("shows canvas width and height sliders when canvas is selected", () => {
    const props = makeProps({ selectedEl: "canvas" });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText(/Breite/)).toBeInTheDocument();
    expect(screen.getByText(/Höhe/)).toBeInTheDocument();
  });

  it("shows background animation select when canvas is selected", () => {
    const props = makeProps({ selectedEl: "canvas" });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText(/Hintergrund-Animation/)).toBeInTheDocument();
  });

  it("shows background color controls for canvas", () => {
    const props = makeProps({ selectedEl: "canvas" });
    render(<OverlayPropertyPanel {...props} />);
    // "Hintergrund" appears as both the bg color label and bg animation label
    const matches = screen.getAllByText(/Hintergrund/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("shows border outline checkbox for canvas", () => {
    const props = makeProps({ selectedEl: "canvas" });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText(/Kontur/)).toBeInTheDocument();
  });

  it("shows border color and width when show_border is true", () => {
    const settings = makeOverlaySettings({ show_border: true });
    const props = makeProps({ selectedEl: "canvas", settings });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText(/Kontur Farbe/)).toBeInTheDocument();
    expect(screen.getByText(/Kontur Stärke/)).toBeInTheDocument();
  });

  it("does not show border color when show_border is false", () => {
    const settings = makeOverlaySettings({ show_border: false });
    const props = makeProps({ selectedEl: "canvas", settings });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.queryByText(/Kontur Farbe/)).not.toBeInTheDocument();
  });

  it("calls onUpdate when border outline checkbox is toggled for canvas", () => {
    const props = makeProps({ selectedEl: "canvas" });
    render(<OverlayPropertyPanel {...props} />);
    const checkboxes = screen.getAllByRole("checkbox");
    // The border outline checkbox
    const borderCheckbox = checkboxes.find(
      (cb) => !cb.closest("label")?.textContent?.includes("Glow"),
    )!;
    fireEvent.click(borderCheckbox);
    expect(props.onUpdate).toHaveBeenCalledWith(expect.objectContaining({ show_border: true }));
  });

  // --- Background image section ---

  it("shows upload button when onBgUpload is provided for canvas", () => {
    const props = makeProps({
      selectedEl: "canvas",
      onBgUpload: vi.fn(),
    });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText(/Hochladen/)).toBeInTheDocument();
  });

  it("does not show upload button when onBgUpload is not provided", () => {
    const props = makeProps({ selectedEl: "canvas" });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.queryByText(/Hochladen/)).not.toBeInTheDocument();
  });

  it("shows uploading state when bgUploading is true", () => {
    const props = makeProps({
      selectedEl: "canvas",
      onBgUpload: vi.fn(),
      bgUploading: true,
    });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText("...")).toBeInTheDocument();
  });

  it("calls onBgUpload when upload button is clicked", () => {
    const onBgUpload = vi.fn();
    const props = makeProps({
      selectedEl: "canvas",
      onBgUpload,
    });
    render(<OverlayPropertyPanel {...props} />);
    fireEvent.click(screen.getByText(/Hochladen/));
    expect(onBgUpload).toHaveBeenCalled();
  });

  it("shows remove button when background_image is set", () => {
    const onBgRemove = vi.fn();
    const settings = makeOverlaySettings({ background_image: "bg.png" });
    const props = makeProps({
      selectedEl: "canvas",
      settings,
      onBgUpload: vi.fn(),
      onBgRemove,
    });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText(/Entfernen/)).toBeInTheDocument();
  });

  it("calls onBgRemove when remove button is clicked", () => {
    const onBgRemove = vi.fn();
    const settings = makeOverlaySettings({ background_image: "bg.png" });
    const props = makeProps({
      selectedEl: "canvas",
      settings,
      onBgUpload: vi.fn(),
      onBgRemove,
    });
    render(<OverlayPropertyPanel {...props} />);
    fireEvent.click(screen.getByText(/Entfernen/));
    expect(onBgRemove).toHaveBeenCalled();
  });

  it("shows background image preview when bgPreviewUrl is set", () => {
    const settings = makeOverlaySettings({ background_image: "bg.png" });
    const props = makeProps({
      selectedEl: "canvas",
      settings,
      onBgUpload: vi.fn(),
      bgPreviewUrl: "http://localhost/bg.png",
    });
    render(<OverlayPropertyPanel {...props} />);
    // The image fit selector is shown when both background_image and bgPreviewUrl exist
    expect(screen.getByText("Cover")).toBeInTheDocument();
  });

  // --- Background animation speed ---

  it("shows animation speed slider when background animation is not none", () => {
    const settings = makeOverlaySettings({ background_animation: "waves" });
    const props = makeProps({ selectedEl: "canvas", settings });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText(/Geschwindigkeit/)).toBeInTheDocument();
  });

  it("does not show animation speed slider when background animation is none", () => {
    const settings = makeOverlaySettings({ background_animation: "none" });
    const props = makeProps({ selectedEl: "canvas", settings });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.queryByText(/Geschwindigkeit/)).not.toBeInTheDocument();
  });

  // --- Background image fit selector ---

  it("changes background image fit when selector is changed", () => {
    const settings = makeOverlaySettings({ background_image: "bg.png" });
    const props = makeProps({
      selectedEl: "canvas",
      settings,
      onBgUpload: vi.fn(),
      bgPreviewUrl: "http://localhost/bg.png",
    });
    render(<OverlayPropertyPanel {...props} />);
    const fitSelect = screen.getByDisplayValue("Cover");
    fireEvent.change(fitSelect, { target: { value: "contain" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ background_image_fit: "contain" }),
    );
  });

  // --- Opacity and blur sliders for canvas ---

  it("shows opacity slider for canvas background", () => {
    const props = makeProps({ selectedEl: "canvas" });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText("Deckkraft")).toBeInTheDocument();
    expect(screen.getByLabelText("Deckkraft (%)")).toHaveValue(100);
  });

  it("shows blur slider for canvas", () => {
    const props = makeProps({ selectedEl: "canvas" });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText("Weichzeichnen")).toBeInTheDocument();
    expect(screen.getByLabelText("Weichzeichnen (px)")).toHaveValue(0);
  });

  it("shows border radius slider for canvas", () => {
    const props = makeProps({ selectedEl: "canvas" });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText("Ecken abrunden")).toBeInTheDocument();
    expect(screen.getByLabelText("Ecken abrunden (px)")).toHaveValue(0);
  });

  // --- Background animation select change ---

  it("calls onUpdate when background animation is changed", () => {
    const props = makeProps({ selectedEl: "canvas" });
    render(<OverlayPropertyPanel {...props} />);
    const selects = screen.getAllByRole("combobox");
    // The bg animation select is the first combobox in canvas view
    const bgAnimSelect = selects[0];
    fireEvent.change(bgAnimSelect, { target: { value: "waves" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ background_animation: "waves" }),
    );
  });

  // --- Opacity slider interaction ---

  it("calls onUpdate when opacity slider is changed for canvas", () => {
    const props = makeProps({ selectedEl: "canvas" });
    render(<OverlayPropertyPanel {...props} />);
    const opacityInput = screen.getByLabelText("Deckkraft (%)");
    fireEvent.change(opacityInput, { target: { value: "50" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ background_opacity: 0.5 }),
    );
  });

  // --- Blur slider interaction ---

  it("calls onUpdate when blur slider is changed for canvas", () => {
    const props = makeProps({ selectedEl: "canvas" });
    render(<OverlayPropertyPanel {...props} />);
    const blurInput = screen.getByLabelText("Weichzeichnen (px)");
    fireEvent.change(blurInput, { target: { value: "10" } });
    expect(props.onUpdate).toHaveBeenCalledWith(expect.objectContaining({ blur: 10 }));
  });

  // --- Border radius slider interaction ---

  it("calls onUpdate when border radius slider is changed", () => {
    const props = makeProps({ selectedEl: "canvas" });
    render(<OverlayPropertyPanel {...props} />);
    const radiusInput = screen.getByLabelText("Ecken abrunden (px)");
    fireEvent.change(radiusInput, { target: { value: "15" } });
    expect(props.onUpdate).toHaveBeenCalledWith(expect.objectContaining({ border_radius: 15 }));
  });

  // --- Canvas width/height slider changes ---

  it("calls onUpdate when canvas width slider is changed", () => {
    const props = makeProps({ selectedEl: "canvas" });
    render(<OverlayPropertyPanel {...props} />);
    // Canvas has width and height NumSliders, get the spinbutton inputs
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.change(inputs[0], { target: { value: "800" } });
    expect(props.onUpdate).toHaveBeenCalledWith(expect.objectContaining({ canvas_width: 800 }));
  });

  it("calls onUpdate when canvas height slider is changed", () => {
    const props = makeProps({ selectedEl: "canvas" });
    render(<OverlayPropertyPanel {...props} />);
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.change(inputs[1], { target: { value: "600" } });
    expect(props.onUpdate).toHaveBeenCalledWith(expect.objectContaining({ canvas_height: 600 }));
  });

  // --- Border width slider change ---

  it("calls onUpdate when border width slider is changed", () => {
    const settings = makeOverlaySettings({ show_border: true, border_width: 2 });
    const props = makeProps({ selectedEl: "canvas", settings });
    render(<OverlayPropertyPanel {...props} />);
    const borderWidthInput = screen.getByLabelText("Kontur Stärke (px)");
    fireEvent.change(borderWidthInput, { target: { value: "5" } });
    expect(props.onUpdate).toHaveBeenCalledWith(expect.objectContaining({ border_width: 5 }));
  });

  // --- Background color swatch click ---

  it("calls openColorPicker when background color swatch is clicked for canvas", () => {
    const props = makeProps({ selectedEl: "canvas" });
    render(<OverlayPropertyPanel {...props} />);
    // ColorSwatch shows the label first and keeps the hex as muted detail
    const bgColorButton = screen.getByTitle("Farbe #000000");
    fireEvent.click(bgColorButton);
    expect(props.openColorPicker).toHaveBeenCalledWith("#000000", expect.any(Function));
  });

  // --- Border color swatch click ---

  it("calls openColorPicker when border color swatch is clicked", () => {
    const settings = makeOverlaySettings({ show_border: true, border_color: "#ffffff" });
    const props = makeProps({ selectedEl: "canvas", settings });
    render(<OverlayPropertyPanel {...props} />);
    // Border color swatch
    const borderColorButton = screen.getByText("Kontur Farbe").closest("button")!;
    fireEvent.click(borderColorButton);
    expect(props.openColorPicker).toHaveBeenCalledWith("#ffffff", expect.any(Function));
  });

  // --- Animation speed slider interaction ---

  it("calls onUpdate when animation speed slider is changed", () => {
    const settings = makeOverlaySettings({
      background_animation: "waves",
      background_animation_speed: 1,
    });
    const props = makeProps({ selectedEl: "canvas", settings });
    render(<OverlayPropertyPanel {...props} />);
    // Speed is one of the sliders, find via the label text
    const speedSlider = screen.getByTitle(/Geschwindigkeit/);
    fireEvent.change(speedSlider, { target: { value: "2" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ background_animation_speed: 2 }),
    );
  });

  it("shows waves controls when waves animation is selected", () => {
    const settings = makeOverlaySettings({ background_animation: "waves" });
    const props = makeProps({ selectedEl: "canvas", settings });
    render(<OverlayPropertyPanel {...props} />);
    // Two "Deckkraft" labels expected: canvas background opacity + waves opacity
    expect(screen.getAllByText(/Deckkraft/).length).toBeGreaterThanOrEqual(2);
  });

  it("shows gradient controls when gradient-shift animation is selected", () => {
    const settings = makeOverlaySettings({ background_animation: "gradient-shift" });
    const props = makeProps({ selectedEl: "canvas", settings });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getAllByText(/Farbe/).length).toBeGreaterThanOrEqual(4);
  });

  it("shows shimmer controls when shimmer-bg animation is selected", () => {
    const settings = makeOverlaySettings({ background_animation: "shimmer-bg" });
    const props = makeProps({ selectedEl: "canvas", settings });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText(/Intensität/)).toBeInTheDocument();
  });
});
