import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, makeOverlaySettings, userEvent } from "../../test-utils";
import { OverlayPropertyPanel } from "./OverlayPropertyPanel";
import type { OverlaySettings, OverlayElementBase } from "../../types";

type ElementKey = "sprite" | "name" | "title" | "counter" | "canvas";

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
  it("renders the label for the selected sprite element", () => {
    const props = makeProps({ selectedEl: "sprite" });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText("Sprite")).toBeInTheDocument();
  });

  it("renders the label for the selected name element", () => {
    const props = makeProps({ selectedEl: "name" });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText("Name")).toBeInTheDocument();
  });

  it("renders the label for the selected counter element", () => {
    const props = makeProps({ selectedEl: "counter" });
    render(<OverlayPropertyPanel {...props} />);
    // The panel heading shows the element label in uppercase
    const headings = screen.getAllByText(/Zähler/);
    expect(headings.length).toBeGreaterThanOrEqual(1);
  });

  it("displays position inputs (X, Y, W, H)", () => {
    const props = makeProps({ selectedEl: "sprite" });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText("X")).toBeInTheDocument();
    expect(screen.getByText("Y")).toBeInTheDocument();
    expect(screen.getByText("W")).toBeInTheDocument();
    expect(screen.getByText("H")).toBeInTheDocument();
  });

  it("shows sprite-specific controls when sprite is selected", () => {
    const props = makeProps({ selectedEl: "sprite" });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText("Glow")).toBeInTheDocument();
    expect(screen.getByLabelText("Idle Animation")).toBeInTheDocument();
    expect(screen.getByLabelText("Trigger Animation")).toBeInTheDocument();
  });

  it("shows text style editor when name element is selected", () => {
    const props = makeProps({ selectedEl: "name" });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText("Text-Stil")).toBeInTheDocument();
  });

  it("shows counter-specific controls when counter is selected", () => {
    const props = makeProps({ selectedEl: "counter" });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText(/Label anzeigen/)).toBeInTheDocument();
  });

  it("shows label text input when show_label is true", () => {
    const settings = makeOverlaySettings({
      counter: {
        ...makeOverlaySettings().counter,
        show_label: true,
        label_text: "Encounters:",
      },
    });
    const props = makeProps({ selectedEl: "counter", settings });
    render(<OverlayPropertyPanel {...props} />);
    const input = screen.getByPlaceholderText("Label-Text");
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue("Encounters:");
  });

  it("fires the test callback when Test button is clicked for sprite", () => {
    const props = makeProps({ selectedEl: "sprite" });
    render(<OverlayPropertyPanel {...props} />);
    const testButtons = screen.getAllByText("Test");
    fireEvent.click(testButtons[0]);
    expect(props.fireTest).toHaveBeenCalledWith("sprite");
  });

  it("fires the decrement test callback when decrement Test button is clicked for sprite", () => {
    const props = makeProps({ selectedEl: "sprite" });
    render(<OverlayPropertyPanel {...props} />);
    const testButtons = screen.getAllByText("Test");
    fireEvent.click(testButtons[1]);
    expect(props.fireTest).toHaveBeenCalledWith("sprite", true);
  });

  it("fires the test callback when Test button is clicked for counter", () => {
    const props = makeProps({ selectedEl: "counter" });
    render(<OverlayPropertyPanel {...props} />);
    const testButtons = screen.getAllByText("Test");
    fireEvent.click(testButtons[0]);
    expect(props.fireTest).toHaveBeenCalledWith("counter");
  });

  it("calls onUpdate when glow checkbox is toggled", () => {
    const props = makeProps({ selectedEl: "sprite" });
    render(<OverlayPropertyPanel {...props} />);
    const glowCheckbox = screen.getByRole("checkbox");
    fireEvent.click(glowCheckbox);
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sprite: expect.objectContaining({ show_glow: true }),
      }),
    );
  });

  it("calls onUpdate when idle animation is changed for sprite", () => {
    const props = makeProps({ selectedEl: "sprite" });
    render(<OverlayPropertyPanel {...props} />);
    const select = screen.getByLabelText("Idle Animation");
    fireEvent.change(select, { target: { value: "float" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sprite: expect.objectContaining({ idle_animation: "float" }),
      }),
    );
  });

  it("shows title-specific controls when title is selected", () => {
    const props = makeProps({ selectedEl: "title" });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText("Titel-Stil")).toBeInTheDocument();
  });

  // --- Canvas element ---

  it("renders canvas label when canvas is selected", () => {
    const props = makeProps({ selectedEl: "canvas" });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText("Canvas")).toBeInTheDocument();
  });

  it("does not show position inputs (X, Y, W, H) when canvas is selected", () => {
    const props = makeProps({ selectedEl: "canvas" });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.queryByText("X")).not.toBeInTheDocument();
    expect(screen.queryByText("Y")).not.toBeInTheDocument();
  });

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
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ show_border: true }),
    );
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

  // --- Sprite glow expanded ---

  it("shows glow color and opacity controls when glow is enabled", () => {
    const settings = makeOverlaySettings({
      sprite: {
        ...makeOverlaySettings().sprite,
        show_glow: true,
      },
    });
    const props = makeProps({ selectedEl: "sprite", settings });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText(/Glow Farbe/)).toBeInTheDocument();
    expect(screen.getByText("Blur")).toBeInTheDocument();
  });

  it("does not show glow details when glow is disabled", () => {
    const settings = makeOverlaySettings({
      sprite: {
        ...makeOverlaySettings().sprite,
        show_glow: false,
      },
    });
    const props = makeProps({ selectedEl: "sprite", settings });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.queryByText(/Glow Farbe/)).not.toBeInTheDocument();
  });

  // --- Sprite trigger animation change ---

  it("calls onUpdate when trigger animation is changed for sprite", () => {
    const props = makeProps({ selectedEl: "sprite" });
    render(<OverlayPropertyPanel {...props} />);
    const select = screen.getByLabelText("Trigger Animation");
    fireEvent.change(select, { target: { value: "pop" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sprite: expect.objectContaining({ trigger_enter: "pop" }),
      }),
    );
  });

  it("calls onUpdate when decrement animation is changed for sprite", () => {
    const props = makeProps({ selectedEl: "sprite" });
    render(<OverlayPropertyPanel {...props} />);
    const select = screen.getByLabelText("Trigger Animation (Verringern)");
    fireEvent.change(select, { target: { value: "shake" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sprite: expect.objectContaining({ trigger_decrement: "shake" }),
      }),
    );
  });

  // --- Name element animations ---

  it("calls onUpdate when idle animation is changed for name", () => {
    const props = makeProps({ selectedEl: "name" });
    render(<OverlayPropertyPanel {...props} />);
    const select = screen.getByLabelText("Idle Animation");
    fireEvent.change(select, { target: { value: "breathe" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.objectContaining({ idle_animation: "breathe" }),
      }),
    );
  });

  it("calls onUpdate when trigger animation is changed for name", () => {
    const props = makeProps({ selectedEl: "name" });
    render(<OverlayPropertyPanel {...props} />);
    const select = screen.getByLabelText("Trigger Animation");
    fireEvent.change(select, { target: { value: "pop" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.objectContaining({ trigger_enter: "pop" }),
      }),
    );
  });

  it("fires test callback for name element", () => {
    const props = makeProps({ selectedEl: "name" });
    render(<OverlayPropertyPanel {...props} />);
    const testButtons = screen.getAllByText("Test");
    fireEvent.click(testButtons[0]);
    expect(props.fireTest).toHaveBeenCalledWith("name");
  });

  it("fires decrement test callback for name element", () => {
    const props = makeProps({ selectedEl: "name" });
    render(<OverlayPropertyPanel {...props} />);
    const testButtons = screen.getAllByText("Test");
    fireEvent.click(testButtons[1]);
    expect(props.fireTest).toHaveBeenCalledWith("name", true);
  });

  // --- Title element animations ---

  it("calls onUpdate when idle animation is changed for title", () => {
    const props = makeProps({ selectedEl: "title" });
    render(<OverlayPropertyPanel {...props} />);
    const select = screen.getByLabelText("Idle Animation");
    fireEvent.change(select, { target: { value: "glow" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.objectContaining({ idle_animation: "glow" }),
      }),
    );
  });

  it("fires test callback for title element", () => {
    const props = makeProps({ selectedEl: "title" });
    render(<OverlayPropertyPanel {...props} />);
    const testButtons = screen.getAllByText("Test");
    fireEvent.click(testButtons[0]);
    expect(props.fireTest).toHaveBeenCalledWith("title");
  });

  it("fires decrement test callback for title element", () => {
    const props = makeProps({ selectedEl: "title" });
    render(<OverlayPropertyPanel {...props} />);
    const testButtons = screen.getAllByText("Test");
    fireEvent.click(testButtons[1]);
    expect(props.fireTest).toHaveBeenCalledWith("title", true);
  });

  // --- Counter element animations ---

  it("calls onUpdate when idle animation is changed for counter", () => {
    const props = makeProps({ selectedEl: "counter" });
    render(<OverlayPropertyPanel {...props} />);
    const select = screen.getByLabelText("Idle Animation");
    fireEvent.change(select, { target: { value: "shimmer" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        counter: expect.objectContaining({ idle_animation: "shimmer" }),
      }),
    );
  });

  it("calls onUpdate when trigger animation is changed for counter", () => {
    const props = makeProps({ selectedEl: "counter" });
    render(<OverlayPropertyPanel {...props} />);
    const select = screen.getByLabelText("Trigger Animation");
    fireEvent.change(select, { target: { value: "slot" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        counter: expect.objectContaining({ trigger_enter: "slot" }),
      }),
    );
  });

  it("fires decrement test callback for counter element", () => {
    const props = makeProps({ selectedEl: "counter" });
    render(<OverlayPropertyPanel {...props} />);
    const testButtons = screen.getAllByText("Test");
    fireEvent.click(testButtons[1]);
    expect(props.fireTest).toHaveBeenCalledWith("counter", true);
  });

  // --- Counter show_label toggle ---

  it("calls onUpdate when show_label checkbox is toggled off", () => {
    const settings = makeOverlaySettings({
      counter: {
        ...makeOverlaySettings().counter,
        show_label: true,
      },
    });
    const props = makeProps({ selectedEl: "counter", settings });
    render(<OverlayPropertyPanel {...props} />);
    // Find the show_label checkbox by its label text
    const labelCheckbox = screen.getByRole("checkbox", { name: /Label anzeigen/ });
    fireEvent.click(labelCheckbox);
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        counter: expect.objectContaining({ show_label: false }),
      }),
    );
  });

  it("hides label text input when show_label is false", () => {
    const settings = makeOverlaySettings({
      counter: {
        ...makeOverlaySettings().counter,
        show_label: false,
      },
    });
    const props = makeProps({ selectedEl: "counter", settings });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.queryByPlaceholderText("Label-Text")).not.toBeInTheDocument();
  });

  it("shows label style editor when show_label is true", () => {
    const settings = makeOverlaySettings({
      counter: {
        ...makeOverlaySettings().counter,
        show_label: true,
      },
    });
    const props = makeProps({ selectedEl: "counter", settings });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText("Label-Stil")).toBeInTheDocument();
  });

  // --- Counter label text input ---

  it("calls onUpdate when label text is changed", async () => {
    const user = userEvent.setup();
    const settings = makeOverlaySettings({
      counter: {
        ...makeOverlaySettings().counter,
        show_label: true,
        label_text: "",
      },
    });
    const props = makeProps({ selectedEl: "counter", settings });
    render(<OverlayPropertyPanel {...props} />);
    const input = screen.getByPlaceholderText("Label-Text");
    await user.type(input, "E");
    expect(props.onUpdate).toHaveBeenCalled();
  });

  // --- Element does not bleed controls across types ---

  it("does not show sprite glow when name is selected", () => {
    const props = makeProps({ selectedEl: "name" });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.queryByText("Glow")).not.toBeInTheDocument();
  });

  it("does not show counter show_label when sprite is selected", () => {
    const props = makeProps({ selectedEl: "sprite" });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.queryByText(/Label anzeigen/)).not.toBeInTheDocument();
  });

  it("does not show text style editor for sprite", () => {
    const props = makeProps({ selectedEl: "sprite" });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.queryByText("Text-Stil")).not.toBeInTheDocument();
    expect(screen.queryByText("Zähler-Stil")).not.toBeInTheDocument();
  });

  it("does not show sprite controls for canvas", () => {
    const props = makeProps({ selectedEl: "canvas" });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.queryByText("Glow")).not.toBeInTheDocument();
    expect(screen.queryByText("Idle Animation")).not.toBeInTheDocument();
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

  // --- Embedded mode ---

  it("does not add the outer card styling when embedded is true", () => {
    const props = makeProps({ selectedEl: "sprite", embedded: true });
    const { container } = render(<OverlayPropertyPanel {...props} />);
    const panel = container.querySelector("[data-tutorial='properties']");
    expect(panel?.className).toContain("flex-1");
    expect(panel?.className).not.toContain("bg-bg-secondary");
  });

  it("adds the outer card styling when embedded is not set", () => {
    const props = makeProps({ selectedEl: "sprite" });
    const { container } = render(<OverlayPropertyPanel {...props} />);
    const panel = container.querySelector("[data-tutorial='properties']");
    expect(panel?.className).toContain("bg-bg-secondary");
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
    expect(screen.getByText(/Deckkraft.*100%/)).toBeInTheDocument();
  });

  it("shows blur slider for canvas", () => {
    const props = makeProps({ selectedEl: "canvas" });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText(/Blur.*0px/)).toBeInTheDocument();
  });

  it("shows border radius slider for canvas", () => {
    const props = makeProps({ selectedEl: "canvas" });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText(/Radius.*0px/)).toBeInTheDocument();
  });

  // --- Background animation select change ---

  it("calls onUpdate when background animation is changed", () => {
    const props = makeProps({ selectedEl: "canvas" });
    render(<OverlayPropertyPanel {...props} />);
    const selects = screen.getAllByRole("combobox");
    // The bg animation select is the first combobox in canvas view
    const bgAnimSelect = selects[0];
    fireEvent.change(bgAnimSelect, { target: { value: "particles" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ background_animation: "particles" }),
    );
  });

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

  // --- Counter decrement animation change ---

  it("calls onUpdate when decrement animation is changed for counter", () => {
    const props = makeProps({ selectedEl: "counter" });
    render(<OverlayPropertyPanel {...props} />);
    const select = screen.getByLabelText("Trigger Animation (Verringern)");
    fireEvent.change(select, { target: { value: "flash" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        counter: expect.objectContaining({ trigger_decrement: "flash" }),
      }),
    );
  });

  // --- Name decrement animation change ---

  it("calls onUpdate when decrement animation is changed for name", () => {
    const props = makeProps({ selectedEl: "name" });
    render(<OverlayPropertyPanel {...props} />);
    const select = screen.getByLabelText("Trigger Animation (Verringern)");
    fireEvent.change(select, { target: { value: "bounce" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.objectContaining({ trigger_decrement: "bounce" }),
      }),
    );
  });

  // --- Title decrement animation change ---

  it("calls onUpdate when decrement animation is changed for title", () => {
    const props = makeProps({ selectedEl: "title" });
    render(<OverlayPropertyPanel {...props} />);
    const select = screen.getByLabelText("Trigger Animation (Verringern)");
    fireEvent.change(select, { target: { value: "tada" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.objectContaining({ trigger_decrement: "tada" }),
      }),
    );
  });

  // --- Title trigger animation change ---

  it("calls onUpdate when trigger animation is changed for title", () => {
    const props = makeProps({ selectedEl: "title" });
    render(<OverlayPropertyPanel {...props} />);
    const select = screen.getByLabelText("Trigger Animation");
    fireEvent.change(select, { target: { value: "slide-in" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.objectContaining({ trigger_enter: "slide-in" }),
      }),
    );
  });

  // --- Opacity slider interaction ---

  it("calls onUpdate when opacity slider is changed for canvas", () => {
    const props = makeProps({ selectedEl: "canvas" });
    render(<OverlayPropertyPanel {...props} />);
    const opacitySlider = screen.getByLabelText(/Deckkraft/);
    fireEvent.change(opacitySlider, { target: { value: "0.5" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ background_opacity: 0.5 }),
    );
  });

  // --- Blur slider interaction ---

  it("calls onUpdate when blur slider is changed for canvas", () => {
    const props = makeProps({ selectedEl: "canvas" });
    render(<OverlayPropertyPanel {...props} />);
    const blurSlider = screen.getByLabelText(/Blur/);
    fireEvent.change(blurSlider, { target: { value: "10" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ blur: 10 }),
    );
  });

  // --- Border radius slider interaction ---

  it("calls onUpdate when border radius slider is changed", () => {
    const props = makeProps({ selectedEl: "canvas" });
    render(<OverlayPropertyPanel {...props} />);
    const radiusSlider = screen.getByLabelText(/Radius/);
    fireEvent.change(radiusSlider, { target: { value: "15" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ border_radius: 15 }),
    );
  });
});
