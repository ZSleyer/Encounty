/**
 * Sprite rows of the property panel: the glow settings and the sprite's own
 * animation channels.
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
  it("shows sprite-specific controls when sprite is selected", () => {
    const props = makeProps({ selectedEl: "sprite" });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText("Glow")).toBeInTheDocument();
    expect(screen.getByLabelText("Dauerhaft")).toBeInTheDocument();
    expect(screen.getByLabelText("Bei Encounter")).toBeInTheDocument();
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

  it("calls onUpdate when glow checkbox is toggled", () => {
    const props = makeProps({ selectedEl: "sprite" });
    render(<OverlayPropertyPanel {...props} />);
    const glowCheckbox = screen.getByRole("checkbox", { name: "Glow" });
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
    const select = screen.getByLabelText("Dauerhaft");
    fireEvent.change(select, { target: { value: "float" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sprite: expect.objectContaining({ idle_animation: "float" }),
      }),
    );
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
    expect(screen.getByText("Weichzeichnen")).toBeInTheDocument();
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
    const select = screen.getByLabelText("Bei Encounter");
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
    const select = screen.getByLabelText("Beim Zurückzählen");
    fireEvent.change(select, { target: { value: "shake" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sprite: expect.objectContaining({ trigger_decrement: "shake" }),
      }),
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
    // The glow opacity slider works in whole percent and stores the fraction
    const sliders = screen.getAllByRole("slider");
    fireEvent.change(sliders[0], { target: { value: "80" } });
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
});
