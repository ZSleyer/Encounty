import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, makeOverlaySettings } from "../../test-utils";
import { OverlayPropertyPanel } from "./OverlayPropertyPanel";
import type { OverlaySettings, OverlayElementBase } from "../../types";

/** Build default props with sensible mock callbacks. */
function makeProps(overrides?: {
  selectedEl?: "sprite" | "name" | "title" | "counter";
  settings?: OverlaySettings;
}) {
  const settings = overrides?.settings ?? makeOverlaySettings();
  return {
    localSettings: settings,
    selectedEl: overrides?.selectedEl ?? "sprite" as const,
    updateSelectedEl: vi.fn() as (patch: Partial<OverlayElementBase>) => void,
    onUpdate: vi.fn() as (s: OverlaySettings) => void,
    openColorPicker: vi.fn(),
    openOutlineEditor: vi.fn(),
    openShadowEditor: vi.fn(),
    openTextColorEditor: vi.fn(),
    fireTest: vi.fn(),
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
    const testButton = screen.getByText("Test");
    fireEvent.click(testButton);
    expect(props.fireTest).toHaveBeenCalledWith("sprite");
  });

  it("fires the test callback when Test button is clicked for counter", () => {
    const props = makeProps({ selectedEl: "counter" });
    render(<OverlayPropertyPanel {...props} />);
    const testButton = screen.getByText("Test");
    fireEvent.click(testButton);
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
});
