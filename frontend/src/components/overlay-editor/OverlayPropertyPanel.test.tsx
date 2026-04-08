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
    fireEvent.change(bgAnimSelect, { target: { value: "waves" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ background_animation: "waves" }),
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

  // --- Position & size input changes ---

  it("calls updateSelectedEl when X input is changed for sprite", () => {
    const props = makeProps({ selectedEl: "sprite" });
    render(<OverlayPropertyPanel {...props} />);
    // NumInput renders a number input — find the one associated with X
    const xInputs = screen.getAllByRole("spinbutton");
    // X is the first, Y second, W third, H fourth
    fireEvent.change(xInputs[0], { target: { value: "50" } });
    expect(props.updateSelectedEl).toHaveBeenCalledWith({ x: 50 });
  });

  it("calls updateSelectedEl when Y input is changed for sprite", () => {
    const props = makeProps({ selectedEl: "sprite" });
    render(<OverlayPropertyPanel {...props} />);
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.change(inputs[1], { target: { value: "75" } });
    expect(props.updateSelectedEl).toHaveBeenCalledWith({ y: 75 });
  });

  it("calls updateSelectedEl when W input is changed for sprite", () => {
    const props = makeProps({ selectedEl: "sprite" });
    render(<OverlayPropertyPanel {...props} />);
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.change(inputs[2], { target: { value: "120" } });
    expect(props.updateSelectedEl).toHaveBeenCalledWith({ width: 120 });
  });

  it("calls updateSelectedEl when H input is changed for sprite", () => {
    const props = makeProps({ selectedEl: "sprite" });
    render(<OverlayPropertyPanel {...props} />);
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.change(inputs[3], { target: { value: "90" } });
    expect(props.updateSelectedEl).toHaveBeenCalledWith({ height: 90 });
  });

  // --- Canvas width/height slider changes ---

  it("calls onUpdate when canvas width slider is changed", () => {
    const props = makeProps({ selectedEl: "canvas" });
    render(<OverlayPropertyPanel {...props} />);
    // Canvas has width and height NumSliders — get the spinbutton inputs
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.change(inputs[0], { target: { value: "800" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ canvas_width: 800 }),
    );
  });

  it("calls onUpdate when canvas height slider is changed", () => {
    const props = makeProps({ selectedEl: "canvas" });
    render(<OverlayPropertyPanel {...props} />);
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.change(inputs[1], { target: { value: "600" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ canvas_height: 600 }),
    );
  });

  // --- Glow opacity and blur slider changes ---

  it("calls onUpdate when glow opacity slider is changed", () => {
    const settings = makeOverlaySettings({
      sprite: {
        ...makeOverlaySettings().sprite,
        show_glow: true,
        glow_opacity: 0.5,
      },
    });
    const props = makeProps({ selectedEl: "sprite", settings });
    render(<OverlayPropertyPanel {...props} />);
    // The glow opacity NumSlider contains a range input
    const sliders = screen.getAllByRole("slider");
    // Find the opacity slider (the first one after glow is enabled)
    fireEvent.change(sliders[0], { target: { value: "0.8" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sprite: expect.objectContaining({ glow_opacity: 0.8 }),
      }),
    );
  });

  it("calls onUpdate when glow blur slider is changed", () => {
    const settings = makeOverlaySettings({
      sprite: {
        ...makeOverlaySettings().sprite,
        show_glow: true,
        glow_blur: 10,
      },
    });
    const props = makeProps({ selectedEl: "sprite", settings });
    render(<OverlayPropertyPanel {...props} />);
    const sliders = screen.getAllByRole("slider");
    // Blur is the second slider
    fireEvent.change(sliders[1], { target: { value: "40" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sprite: expect.objectContaining({ glow_blur: 40 }),
      }),
    );
  });

  // --- Glow color swatch click ---

  it("calls openColorPicker when glow color swatch is clicked", () => {
    const settings = makeOverlaySettings({
      sprite: {
        ...makeOverlaySettings().sprite,
        show_glow: true,
        glow_color: "#ff0000",
      },
    });
    const props = makeProps({ selectedEl: "sprite", settings });
    render(<OverlayPropertyPanel {...props} />);
    const glowColorButton = screen.getByText(/Glow Farbe/).closest("button")!;
    fireEvent.click(glowColorButton);
    expect(props.openColorPicker).toHaveBeenCalledWith(
      "#ff0000",
      expect.any(Function),
      expect.objectContaining({ showOpacity: true }),
    );
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
    const colorButton = screen.getByText(/Farbe #ffffff/).closest("button")!;
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
      "none",
      "#000000",
      0,
      expect.any(Function),
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

  // --- Border width slider change ---

  it("calls onUpdate when border width slider is changed", () => {
    const settings = makeOverlaySettings({ show_border: true, border_width: 2 });
    const props = makeProps({ selectedEl: "canvas", settings });
    render(<OverlayPropertyPanel {...props} />);
    const borderWidthSlider = screen.getByLabelText(/Kontur Stärke/);
    fireEvent.change(borderWidthSlider, { target: { value: "5" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ border_width: 5 }),
    );
  });

  // --- Background color swatch click ---

  it("calls openColorPicker when background color swatch is clicked for canvas", () => {
    const props = makeProps({ selectedEl: "canvas" });
    render(<OverlayPropertyPanel {...props} />);
    // ColorSwatch uses title={label} — background color swatch title is the hex value
    const bgColorButton = screen.getByTitle("#000000");
    fireEvent.click(bgColorButton);
    expect(props.openColorPicker).toHaveBeenCalledWith(
      "#000000",
      expect.any(Function),
    );
  });

  // --- Border color swatch click ---

  it("calls openColorPicker when border color swatch is clicked", () => {
    const settings = makeOverlaySettings({ show_border: true, border_color: "#ffffff" });
    const props = makeProps({ selectedEl: "canvas", settings });
    render(<OverlayPropertyPanel {...props} />);
    // Border color swatch
    const borderColorButton = screen.getByText(/Kontur Farbe/).parentElement!.querySelector("button")!;
    fireEvent.click(borderColorButton);
    expect(props.openColorPicker).toHaveBeenCalledWith(
      "#ffffff",
      expect.any(Function),
    );
  });

  // --- Animation speed slider interaction ---

  it("calls onUpdate when animation speed slider is changed", () => {
    const settings = makeOverlaySettings({
      background_animation: "waves",
      background_animation_speed: 1,
    });
    const props = makeProps({ selectedEl: "canvas", settings });
    render(<OverlayPropertyPanel {...props} />);
    // Speed is one of the sliders — find via the label text
    const speedSlider = screen.getByTitle(/Geschwindigkeit/);
    fireEvent.change(speedSlider, { target: { value: "2" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ background_animation_speed: 2 }),
    );
  });

  // --- Show_label toggle ON ---

  it("calls onUpdate when show_label checkbox is toggled on", () => {
    const settings = makeOverlaySettings({
      counter: {
        ...makeOverlaySettings().counter,
        show_label: false,
      },
    });
    const props = makeProps({ selectedEl: "counter", settings });
    render(<OverlayPropertyPanel {...props} />);
    const labelCheckbox = screen.getByRole("checkbox", { name: /Label anzeigen/ });
    fireEvent.click(labelCheckbox);
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        counter: expect.objectContaining({ show_label: true }),
      }),
    );
  });

  // --- Text style editor for counter ---

  it("shows counter style editor when counter is selected", () => {
    const props = makeProps({ selectedEl: "counter" });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText("Zähler-Stil")).toBeInTheDocument();
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
    // Counter style is the first TextStyleEditor — its font selector
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

  // --- Position inputs for name element ---

  it("calls updateSelectedEl when X input is changed for name", () => {
    const props = makeProps({ selectedEl: "name" });
    render(<OverlayPropertyPanel {...props} />);
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.change(inputs[0], { target: { value: "150" } });
    expect(props.updateSelectedEl).toHaveBeenCalledWith({ x: 150 });
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

  // --- NumInput increment/decrement buttons ---

  it("calls updateSelectedEl when X increment button is clicked", () => {
    const props = makeProps({ selectedEl: "sprite" });
    render(<OverlayPropertyPanel {...props} />);
    // Each NumInput has a + button; click the first + (for X)
    const incrementButtons = screen.getAllByText("+");
    fireEvent.click(incrementButtons[0]);
    expect(props.updateSelectedEl).toHaveBeenCalledWith({ x: 11 });
  });

  it("calls updateSelectedEl when X decrement button is clicked", () => {
    const props = makeProps({ selectedEl: "sprite" });
    render(<OverlayPropertyPanel {...props} />);
    // The minus sign in NumInput is "−" (U+2212)
    const decrementButtons = screen.getAllByText("−");
    fireEvent.click(decrementButtons[0]);
    expect(props.updateSelectedEl).toHaveBeenCalledWith({ x: 9 });
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
      "solid",
      "#ff0000",
      3,
      expect.any(Function),
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
    const colorButton = screen.getByText(/Farbe \(/).closest("button")!;
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

  // --- Reactbits animation-specific settings ---

  it("shows aurora color inputs when rb-aurora animation is selected", () => {
    const settings = makeOverlaySettings({ background_animation: "rb-aurora" });
    const props = makeProps({ selectedEl: "canvas", settings });
    render(<OverlayPropertyPanel {...props} />);
    const colorInputs = screen.getAllByText(/Farbe/);
    expect(colorInputs.length).toBeGreaterThanOrEqual(3);
  });

  it("shows galaxy controls when rb-galaxy animation is selected", () => {
    const settings = makeOverlaySettings({ background_animation: "rb-galaxy" });
    const props = makeProps({ selectedEl: "canvas", settings });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText(/Dichte/)).toBeInTheDocument();
  });

  it("shows silk controls when rb-silk animation is selected", () => {
    const settings = makeOverlaySettings({ background_animation: "rb-silk" });
    const props = makeProps({ selectedEl: "canvas", settings });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText(/Skalierung/)).toBeInTheDocument();
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

  it("shows pixel blast controls when rb-pixelblast animation is selected", () => {
    const settings = makeOverlaySettings({ background_animation: "rb-pixelblast" });
    const props = makeProps({ selectedEl: "canvas", settings });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText(/Pixelgröße/)).toBeInTheDocument();
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
    expect(screen.getByText(/Umriss 3px #ff0000/)).toBeInTheDocument();
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

  // --- Shadow with gradient type ---

  it("shows gradient shadow swatch when shadow color type is gradient", () => {
    const settings = makeOverlaySettings({
      name: {
        ...makeOverlaySettings().name,
        style: {
          ...makeOverlaySettings().name.style,
          text_shadow: true,
          text_shadow_color_type: "gradient",
          text_shadow_gradient_stops: [
            { color: "#ff0000", position: 0 },
            { color: "#0000ff", position: 100 },
          ],
        },
      },
    });
    const props = makeProps({ selectedEl: "name", settings });
    render(<OverlayPropertyPanel {...props} />);
    // Shadow should show details with gradient applied
    expect(screen.getByText(/Schatten/)).toBeInTheDocument();
  });
});
