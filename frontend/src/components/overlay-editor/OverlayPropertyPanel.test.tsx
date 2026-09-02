/**
 * Property panel shell: the heading of the selected layer, the position and
 * size inputs, the embedded styling and the tutorial anchors.
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
    expect(screen.queryByText("Dauerhaft")).not.toBeInTheDocument();
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

  // --- Position & size input changes ---

  it("calls updateSelectedEl when X input is changed for sprite", () => {
    const props = makeProps({ selectedEl: "sprite" });
    render(<OverlayPropertyPanel {...props} />);
    // NumInput renders a number input, find the one associated with X
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

  // --- Position inputs for name element ---

  it("calls updateSelectedEl when X input is changed for name", () => {
    const props = makeProps({ selectedEl: "name" });
    render(<OverlayPropertyPanel {...props} />);
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.change(inputs[0], { target: { value: "150" } });
    expect(props.updateSelectedEl).toHaveBeenCalledWith({ x: 150 });
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

  // --- Tutorial anchors ---
  // The walkthrough finds its targets by attribute, so a renamed or dropped
  // anchor is only noticed at runtime unless it is asserted here.

  it("anchors the text style tutorial step on a value layer", () => {
    const props = makeProps({ selectedEl: "counter" });
    const { container } = render(<OverlayPropertyPanel {...props} />);
    expect(container.querySelector("[data-tutorial='text-style']")).toBeInTheDocument();
  });

  it("anchors the affix tutorial step on a value layer", () => {
    const props = makeProps({ selectedEl: "counter" });
    const { container } = render(<OverlayPropertyPanel {...props} />);
    const affixes = container.querySelector("[data-tutorial='affixes']");
    expect(affixes).toBeInTheDocument();
    expect(affixes).toHaveTextContent("Text davor & danach");
  });

  it("anchors the sprite cycling tutorial step on the sprite layer", () => {
    const props = makeProps({ selectedEl: "sprite" });
    const { container } = render(<OverlayPropertyPanel {...props} />);
    const cycle = container.querySelector("[data-tutorial='sprite-cycle']");
    expect(cycle).toBeInTheDocument();
    expect(cycle).toHaveTextContent("Phase-Targets durchwechseln");
  });
});
